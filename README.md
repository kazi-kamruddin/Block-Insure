<div align="center">

# Block-Insure

**A transparent path from policy to payout.**

A blockchain and machine-learning thesis prototype for healthcare insurance.

**[Live Demo](https://block-insure.vercel.app/)** · **[Features](#features)** · **[Architecture](#architecture)** · **[Getting Started](#local-development)** · **[Verification](#verification)**

`Solidity` · `React` · `Node.js` · `MongoDB` · `XGBoost`

</div>

---

## Overview

Block-Insure is a blockchain-based insurance thesis prototype with role-based
workspaces for policyholders, administrators, auditors, hospitals, and banks.
It combines on-chain policy and claim management with encrypted evidence,
hospital-registry verification, two Oracle workers, and explainable risk scoring.

The project uses simulated banking and healthcare records for development and
evaluation. It is not a production insurance service or a clinical fraud detector.

Oracle restart recovery uses bounded historical scanning and a separately verified
operational release while preserving the frozen request-pinned evaluator. See
[Oracle recovery and compatibility](docs/oracle-backlog-recovery.md) for local
verification, configuration and the recorded hosted rollout.

Protocol v5 adds version-bound appeal proof for direct and relayed transactions
while retaining frozen XGBoost inference and historical request validators. See
[sponsored appeal compatibility](docs/sponsored-appeal-compatibility.md) for local
evidence and the completed Base rollout/default-activation record. The hosted
demonstration uses Base Sepolia (84532); Ethereum Sepolia is a separate, completed
measurement deployment. Do not repeat activation or deploy contracts to start a demo.

For a hosted walkthrough, check service readiness and public RPC capacity before
starting timed claims. Real wallet and mailbox acceptance is separate from
automated browser tests. Local execution records and operator notes are kept
outside the public repository.

## Features

| Area | What the prototype provides |
| --- | --- |
| **Policies and premiums** | Review issued terms, purchase coverage, pay installments and view statements. |
| **Simulated banking** | Authorize a manual OTP payment or set up a standing EFT instruction against a simulated balance. |
| **Claims and evidence** | Submit an encrypted invoice and supporting files, track a claim and recover an interrupted submission or appeal. |
| **Hospital records** | Maintain institution-scoped synthetic records through an ordinary staff login; publish versioned commitments for matching. |
| **Oracle verification** | Two workers verify committed records and execute the request-pinned XGBoost routing pipeline. |
| **Auditor review** | The claimant authorizes the assigned four-person panel; three approvals approve, two rejections reject, and insufficient quorum at expiry rejects. |
| **Settlement** | Approved, funded payouts and eligible cancellation refunds are allocated for the recipient to withdraw. |
| **Access and recovery** | Wallet sign-in for signing roles, hospital staff accounts, email confirmation and encrypted evidence-key recovery. |

Premium collection uses fixed installment periods shared by wallet, OTP and
EFT payments. Simulated BDT debits settle funded test ETH atomically, with durable
pending-operation recovery. Purchase documents reflect published contract rules
and bind their hash to the issued policy. See
[financial and provider workflows](docs/financial-and-provider-workflows.md) for
the supported rules, trust boundaries and new-deployment requirements.

A separately deployed **accelerated testnet payment demo** uses 10-minute periods,
an 8-minute advance window and 2-minute collection grace. The quarterly product
remains available and tested. Purchase documents and payment views show the actual
immutable profile; claim and review deadlines are unchanged.

Reviewers receive one batch authorization for the fixed evidence set and can
subsequently decrypt while the claimant is offline. Appeal registration and ordered
evidence anchoring recover interrupted operations. Death and maturity products are
disabled in this release. See [evidence, review and recovery](docs/evidence-review-and-recovery.md)
for lifecycle rules and privacy limits.

Automated verification covers transaction reconciliation, encrypted evidence
recovery, reviewer access, payment settlement and selected failure cases. Results
depend on the environment and do not establish production readiness.

Model scores support claim routing; they do not establish fraud or bypass
eligibility, auditor quorum, reserves, or payout-withdrawal rules. Fresh
deployments use the packaged XGBoost routing model. Existing requests retain
their captured model version.

## Architecture

```text
 Policyholder / Admin / Auditors             Hospital staff
          React + wallet                      Staff portal
                |                                  |
                +----------- Express API ----------+
                       |          |          |
                  MongoDB   Encrypted files   Hospital records
                       |                     |
                 Smart contracts <---- Two Oracle workers
                       |
                Funded withdrawal
```

The Oracles share a configured record source and model. Their agreement confirms
the implemented verification process; it does not independently establish that
the hospital record or uploaded document is medically true.

### Technology stack

| Layer | Technologies |
| --- | --- |
| **Frontend** | React, Vite, Tailwind CSS, Ethers |
| **Backend and data** | Node.js, Express, MongoDB |
| **Contracts** | Solidity, Hardhat, OpenZeppelin |
| **Oracle and risk routing** | Dual Oracle workers, Merkle commitments, XGBoost |
| **Evidence privacy** | Client-side encryption and IronCore Recrypt |
| **Verification** | Playwright, contract and backend tests |

### Project structure

| Directory | Contents |
| --- | --- |
| `contracts/` | Solidity contracts, Hardhat deployment scripts, and contract tests |
| `backEnd/` | Express API, MongoDB models, cryptographic services, and model integration |
| `frontEnd/` | React dashboards, wallet integration, and client-side evidence encryption |
| `oracle/` | Two Oracle workers, proof verification, and model dispatch |
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

The financial/provider regression command is `npm run test:phase1`; the integrated
evidence/recovery campaign is `npm run test:phase2`. Their isolated
database requirements and stage selection are described in the browser testing
guide. It includes hospital login without a wallet, issued terms, coordinated
payments, claim processing and recovery of persisted gateway transactions.

Historical research artifacts retain their original source scope. The
[reviewed source transition](docs/research-source-transition-v5.json) records
changed runtime bindings without rewriting historical results. A passing repository
check does not revalidate those measurements for the current release.

The bounded final campaign is `npm run test:release`, with an explicitly selected
disposable loopback MongoDB. It records the candidate source, staged checks,
recovery outcomes and current local measurements. `npm run test:release:images`
checks the locally built release images with temporary synthetic installation
resources. See [release verification and acceptance](docs/release-verification.md),
[static-analysis interpretation](docs/release-static-review.md) and
[the current authority map](docs/current-system-architecture.md).

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

The Node deployment recipes target 24.16.0. `deploy:testnet` validates a separately
selected bootstrap file without sending transactions by default; `--probe` reads
the target and `--apply` explicitly deploys to a fresh output directory. Full
configuration/readiness checks and actual-user acceptance follow deployment.
`preflight:hosted:full` checks compatible code/wiring and active worker readiness;
the original preview preflight deliberately permits dormant workers. A passing
local campaign or preview is not proof of public-testnet or hosted acceptance.

## Scope

BDT balances, bank ownership and conversion are simulated; the gateway settles
actual test ETH. Email verification proves access to
the configured mailbox, not legal identity. Hospital-registry commitments and
Oracle agreement depend on the configured data sources and trust model.
Research results use controlled scenarios and weak provider labels; they do not
establish natural-fraud accuracy or clinical validity. Use synthetic test data
and development/testnet funds.

## License

See [LICENSE](LICENSE).
