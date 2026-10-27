# Block-Insure

Block-Insure is a blockchain-based insurance thesis prototype with role-based
workspaces for policyholders, administrators, auditors, hospitals, and banks.
It combines on-chain policy and claim management with encrypted evidence,
hospital-registry verification, two Oracle workers, and explainable risk scoring.

The project uses simulated banking and healthcare records for development and
evaluation. It is not a production insurance service or a clinical fraud detector.

## Features

- Policy purchase, premium payments, standing bank instructions, and statements.
- Claims and corrected appeals with browser-encrypted supporting documents.
- Hospital attestations and verification against committed Merkle registry roots.
- Two Oracle workers with request-bound, versioned risk assessments.
- Manual review with a four-auditor snapshot: three approvals allocate a payout,
  two rejections reject, and an expired review rejects without sufficient quorum.
- Pull-payment settlement: recipients withdraw allocated payouts.
- Beneficiary, surrender, and maturity benefits with eligibility checks.
- Wallet-based SIWE login, role isolation, and email confirmation/OTP support.

Model scores support claim routing; they do not establish fraud or bypass
eligibility, auditor quorum, reserves, or payout-withdrawal rules. Fresh
deployments use the packaged XGBoost routing model. Existing requests retain
their captured model version.

## Architecture

| Directory | Contents |
| --- | --- |
| `contracts/` | Solidity contracts, Hardhat deployment scripts, and contract tests |
| `backEnd/` | Express API, MongoDB models, cryptographic services, and model integration |
| `frontEnd/` | React dashboards, wallet integration, and client-side evidence encryption |
| `oracle/` | Independent Oracle workers, proof verification, and model dispatch |
| `e2e/` | Playwright browser tests and isolated test-wallet helpers |
| `scripts/` | Startup, configuration, packaging, and verification tools |
| `deploy/` | Container definitions and deployment environment templates |
| `docs/` | Public setup, deployment, and repository guidance |

The stack uses Solidity/Hardhat, Node.js/Express, MongoDB, React/Vite,
Tailwind CSS, Ethers, and IronCore Recrypt.

## Local development

Use **Node.js 24**, npm, and a reachable MongoDB instance. Follow the
[local development guide](docs/local-development.md) to create private
configuration, select a disposable database, and start the stack safely.

Install dependencies from the repository root:

```powershell
npm run install:all
```

After configuration, daily startup against an existing valid local chain is:

```powershell
npm run dev
```

Fresh setup uses `dev:bootstrap`; it resets the configured application database
and deploys a new local baseline. Select a disposable loopback database first.
The hybrid dataset workflow is optional and requires separately supplied source
files. Both workflows are described in the local guide.

The frontend runs at `http://localhost:5173`, the API at
`http://localhost:5000`, and the local blockchain uses chain ID `31337`.
Hardhat state is in memory; saved deployment addresses do not restore a stopped
chain. Keep its terminal running when restarting application services.

## Verification

```powershell
npm run preflight:manual
npm run doctor
npm run verify:all
```

`preflight:manual` checks configuration without starting services or sending
email. `doctor` checks local configuration and artifact integrity. `verify:all`
runs the subsystem verification sequence; its hybrid-data check requires the
separately prepared dataset. Individual checks are also available:

```powershell
npm --prefix contracts test
npm --prefix backEnd test
npm --prefix oracle test
npm --prefix frontEnd run lint
npm --prefix frontEnd run build
```

Browser workflows require a prepared local stack. See the
[browser testing guide](e2e/README.md) for isolated databases, synthetic external
services, and production-build checks. Tests and configuration are versioned;
generated reports and local execution records are ignored.

## Deployment and configuration

- [Self-hosted testnet deployment](docs/deployment-guide.md)
- [Hosted preview configuration](docs/free-tier-staging-deployment.md)
- [Dataset requirements](backEnd/datasets/hybrid-v1/README.md)
- [Repository contents and generated files](docs/repository-artifacts.md)

Each service has an environment example. Keep private keys, database credentials,
provider tokens, and real `.env` files out of Git and frontend `VITE_*` values.
Hosted services need their own configuration; local environment edits do not
configure hosting platforms. A hosted off-chain preview cannot complete
blockchain transactions until its shared chain and services are configured.

## Scope

Bank balances and transfers are simulated. Email verification proves access to
the configured mailbox, not legal identity. Hospital-registry commitments and
Oracle agreement depend on the configured data sources and trust model.
Research results use controlled scenarios and weak provider labels; they do not
establish natural-fraud accuracy or clinical validity. Use synthetic test data
and development/testnet funds.

## License

See [LICENSE](LICENSE).
