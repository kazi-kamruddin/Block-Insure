# Deployment Guide

## Deployment boundary

Block-Insure is a research prototype. Deploy it with synthetic or consented test
data on a public testnet such as Sepolia. It is not audited or licensed for
mainnet funds, real insurance issuance, or real patient records.

The production topology contains five long-running services:

1. Caddy terminates HTTPS and routes browser/API traffic.
2. Nginx serves the React single-page application.
3. The Express backend connects to MongoDB, Pinata, and the blockchain RPC.
4. Oracle worker one maintains its own persistent event cursor.
5. Oracle worker two maintains an independent cursor and registry snapshot.

MongoDB, the blockchain RPC, Pinata, DNS, and wallet custody remain external.
The provided Compose file does not create insecure local replacements for them.

## External prerequisites

- A Linux host with Docker Engine and the Docker Compose plugin.
- A domain whose `A`/`AAAA` record points to that host; ports 80 and 443 open.
- A MongoDB deployment restricted to the application host where possible.
- A Sepolia HTTPS/WSS RPC endpoint.
- A Pinata project/JWT used only by this deployment.
- Distinct funded testnet wallets for the deployer/admin, bank, evidence signer,
  two oracles, claim officer, four auditors, five hospitals, and demo users.

Never use Hardhat's public development keys on a public network. Keep private
keys in the deployment host's secret store and rotate them after a demonstration
if they were imported into a browser wallet.

## 1. Verify the source release

From the repository root:

```powershell
npm run install:all
npm run verify:all
npm run release:check:template
```

The contract verifier enforces a stricter 24,448-byte maintenance ceiling for
`InsuranceManager`, below Ethereum's 24,576-byte EIP-170 limit.

## 2. Deploy the contracts

Copy `contracts/.env.example` to `contracts/.env` and set an HTTPS Sepolia
`RPC_URL`, a funded `ADMIN_PRIVATE_KEY`, and deliberately small testnet reserve
values. Then run:

```powershell
npm run deploy:sepolia
```

The script writes `contracts/deployments/sepolia-11155111.json`. Non-local
deployment never rewrites application `.env` files. Preserve that manifest with
the release record and map its components into the deployment environment:

| Manifest component | Deployment variables |
| --- | --- |
| `InsuranceManager` | `VITE_CONTRACT_ADDRESS`, `CONTRACT_ADDRESS` |
| `ClaimAdjudicator` | `VITE_CLAIM_ADJUDICATOR_ADDRESS` |
| `PolicyEconomics` | `VITE_POLICY_ECONOMICS_ADDRESS` |
| `EvidenceRegistry` | `EVIDENCE_REGISTRY_ADDRESS`, `VITE_EVIDENCE_REGISTRY_ADDRESS` |
| `HospitalVerificationRegistry` | `HOSPITAL_VERIFICATION_REGISTRY_ADDRESS`, `VITE_HOSPITAL_VERIFICATION_REGISTRY_ADDRESS` |
| `BankIdentityRegistry` | `BANK_IDENTITY_REGISTRY_ADDRESS`, `VITE_BANK_IDENTITY_REGISTRY_ADDRESS` |
| `ProtocolDeploymentRegistry` | `PROTOCOL_DEPLOYMENT_REGISTRY_ADDRESS`, `VITE_PROTOCOL_DEPLOYMENT_REGISTRY_ADDRESS` |
| `PolicyBenefitsManager` | `POLICY_BENEFITS_ADDRESS`, `VITE_POLICY_BENEFITS_ADDRESS` |

Use the deployment receipt blocks for `CONTRACT_DEPLOYMENT_BLOCK`,
`VITE_CONTRACT_DEPLOYMENT_BLOCK`, `ORACLE_START_BLOCK`, and the corresponding
policy-benefits block variables.

Grant the two oracle wallets, claim officer, four auditors, five hospital
wallets, and bank wallet only after confirming every address out of band. The
role bootstrap is idempotent, but a public-network run must use the explicit
wallet values in `deploy/production.env`; local fallback identities are forbidden
by the release checker.

## 3. Prepare production configuration

Copy the template without committing the result:

```powershell
Copy-Item deploy/production.env.example deploy/production.env
npm --prefix backEnd run keys:pre:generate
```

Store the generated JSON as `PRE_PROXY_SIGNING_KEYS_JSON`. Treat it like a
private key: do not paste it into tickets, screenshots, Git, or presentation
slides. Use independent random secrets of at least 32 characters for
`JWT_SECRET`, `BANK_OTP_SECRET`, and `ORACLE_API_KEY`.

Set all contract addresses, deployment blocks, external URLs, and actor wallets.
`BANK_PRIVATE_KEY` must control `BANK_WALLET_ADDRESS`. The five hospital wallets
and three demo-account owners are comma-separated in their declared order.

For the thesis deployment, `ENABLE_SIMULATED_HOSPITAL_API=true` exposes the
clearly labelled hybrid/synthetic registry endpoints. Set it to `false` when
those demonstration endpoints are not intended to exist.

Run the fail-fast consistency gate:

```powershell
npm run release:check
```

This rejects localhost RPCs, chain ID 31337, HTTP public origins, weak secrets,
invalid/mismatched addresses, shared signing keys, unsafe development flags, and
missing release files.

After reviewing the configured addresses, initialize public-testnet roles and
the synthetic showcase registry:

```powershell
npm run deploy:roles
npm run deploy:seed:synthetic
npm run deploy:push:merkle
```

These commands write MongoDB state and send public-testnet transactions. Run
them once from a controlled operator machine; each command revalidates the
production environment before doing any work.

## 4. Build and start

```powershell
docker compose --env-file deploy/production.env -f deploy/compose.production.yml build
docker compose --env-file deploy/production.env -f deploy/compose.production.yml up -d
docker compose --env-file deploy/production.env -f deploy/compose.production.yml ps
```

Caddy obtains and renews TLS certificates for `PUBLIC_HOST`. The backend is not
published directly; `/api/*` and the explicitly enabled `/mock/*` routes pass
through the HTTPS gateway. Oracle cursors and Caddy state use named volumes.

## 5. Post-deployment acceptance

Verify these without exposing secrets:

```text
https://<PUBLIC_HOST>/healthz
https://<PUBLIC_HOST>/health/live
https://<PUBLIC_HOST>/health/ready
https://<PUBLIC_HOST>/api
```

The backend container's `/health/live` reports process liveness while
`/health/ready` returns HTTP 503 if MongoDB is unavailable. Check container logs
for both independent oracle heartbeats, then confirm the Admin Role Health page
shows no Mongo/on-chain mismatch.

Complete one low-value policy and claim on Sepolia, verify the transaction links,
and confirm Pinata upload, two-oracle processing, auditor fallback, and settlement
before sharing the URL.

## Rollback and recovery

- Application rollback: deploy the previous source revision with the same
  contract addresses and persistent volumes.
- Oracle recovery: retain each oracle volume; cursor identity prevents reuse
  against a different chain or coordinator.
- Contract rollback: contracts are not upgradeable. Deploy a new protocol set,
  update the deployment manifest, and migrate only through an explicitly reviewed
  procedure.
- Secret exposure: stop services, rotate the affected credential or wallet, revoke
  obsolete roles, and rebuild the frontend if a public `VITE_*` value changed.
