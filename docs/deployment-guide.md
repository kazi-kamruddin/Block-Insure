# Deployment Guide

The current release uses `BLOCK_INSURE_COMPLETION_PHASE2_V3` and packaged
`xgboost-protocol-v4.json`. It requires a fresh compatible contract set and separate
application database; no proxy upgrade or automatic historical-data migration is
provided. Preserve old environment files, evidence, indexes and manifests.
Review access now includes bounded preparation and operator activation. Run the
evidence-access and anchor reconcilers with coordinated operator signing; preserve
their MongoDB state and encrypted signing configuration across restarts. Death and
maturity publication is disabled; the retained cancellation refund uses a separate
vault. See [workflow boundaries](evidence-review-and-recovery.md).

Build and installation verification use Node 24.16.0. See
[the release campaign](release-verification.md) for current source-bound checks,
image probes and the distinction between preview and full runtime readiness.

Choose the immutable `CALENDAR_PROFILE` before bootstrap: `QUARTERLY` or the
separately labelled `ACCELERATED_TESTNET` payment demo. The network examples select
the latter. Its periods/advance/grace are 10/8/2 minutes; it is not real-world
pricing or a timing switch for existing policies. Read back the actual schedule
and selected implementation. See [payment profiles](financial-and-provider-workflows.md).
Nginx and Caddy pins are 1.30.6 and 2.11.7. Self-hosted worker readiness bases are
`https://<PUBLIC_HOST>/oracle-one` and `/oracle-two`; their read-only health servers
are proxied without publishing container ports or administration endpoints.

This guide covers the self-hosted container topology. For local setup, see
[local development](local-development.md). A hosted preview can instead use
[the Vercel/Render configuration](free-tier-staging-deployment.md).

Keep the selected chain, deployed contracts, model identity, roles, registry
commitments, API and both Oracle workers consistent. Restarting services does
not migrate an existing on-chain model default or restore a lost local chain.

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
  two oracles, claim officer, four auditors, and demo users. Hospital staff use
  administrator-provisioned credentials and require no blockchain wallet.

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

Grant the two oracle wallets, claim officer, four auditors and bank wallet
only after confirming every address out of band. The
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
`BANK_PRIVATE_KEY` must control `BANK_WALLET_ADDRESS` and be funded for test-ETH
settlement and gas. The three demo-account owners are comma-separated in their
declared order. Hospital-wallet variables are optional historical metadata;
provision actual staff through Administration after launch.

This release changes installment/payment entry points and Oracle commitment
encoding. Deploy the contracts and workers together to a new environment, with
the correct positive manager creation block. Do not activate it over an older
coordinator or database without an explicit migration. The legacy hospital
registry is marked inactive in the deployment directory. See
[financial and provider workflows](financial-and-provider-workflows.md).

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

- Application rollback: use only a source revision compatible with the deployed
  protocol, model dispatch and stored evidence schema. An older release cannot
  simply reuse these contract addresses and persistent volumes. Preserve the
  matching archived stack for its own deployment.
- Oracle recovery: retain each oracle volume; cursor identity prevents reuse
  against a different chain or coordinator.
- Contract rollback: contracts are not upgradeable. Deploy a new protocol set,
  update the deployment manifest, and migrate only through an explicitly reviewed
  procedure.
- Secret exposure: stop services, rotate the affected credential or wallet, revoke
  obsolete roles, and rebuild the frontend if a public `VITE_*` value changed.


### Historical indexing after a restart

The indexer resumes from its deployment-scoped MongoDB checkpoint. It scans all missed contract event ranges, storing headers for event-bearing blocks and range endpoints rather than every empty block. A fresh endpoint hash check precedes checkpoint advancement; detected reorganizations rewind and replay the affected interval. Existing dense block records and checkpoints remain compatible and need no reset or migration.

Measure catch-up by checkpoint block height, not the number of IndexedBlock documents: new markers are sparse. Initial readiness remains unavailable until startup initialization finishes. Runtime catch-up duration depends on missed range, event density and RPC limits. A free Render service can sleep without inbound requests; completed checkpoints persist in Atlas. Do not disable indexing, move the start block or clear Atlas as a speed workaround.

Catch-up logs identify the fixed target and report checkpoint progress every ten ranges and at completion. With an RPC verified to accept that range, `INDEXER_CHUNK_SIZE=2000` reduces range-query overhead; the supported limit remains 2000 and the default remains 500. Confirm the provider supports this setting before using it. The checkpoint and current range endpoint are both rechecked before committing, and a missing checkpoint header fails without treating temporary RPC unavailability as a reorganization.

### Expired Oracle requests on hosted workers

If a worker repeatedly fails `estimateGas` for `commitOracleResult`, inspect the
decoded request ID, current block, recorded deadlines, fulfillment, eligibility
and commitments. An expired commit cannot be repaired by increasing gas. A failed
estimate itself sends no transaction.

For an unfulfilled request past its reveal deadline, the existing Admin claim
page offers **Resolve Oracle Timeout**. Confirm the correct network and claim,
then resolve once and retain its receipt. Reconcile an uncertain response against
the existing request before retrying. This is a paid testnet transaction that
finalizes the timeout and permits the normal manual-review path; it does not
retry or approve the expired Oracle request.

The current worker advances its scan cursor only after successful event handling.
An expired unfulfilled request can block that range until timeout resolution.
After resolving, verify both cursors advance beyond the request block and recent
polls recover. `ready` alone does not prove either worker reached chain head.
Do not clear cursors, skip history, reset the database or redeploy contracts.

Free hosting may sleep or restart during request windows; that is an availability
limit. Preserve failures separately from successful fallback tests. The initial
cause of a missed window requires timestamped logs. Worker source changes also
affect the frozen protocol package identity, so operational recovery must not
silently replace the evaluator pinned by existing requests.
