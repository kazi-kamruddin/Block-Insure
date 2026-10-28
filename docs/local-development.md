# Local development

## Prerequisites

Use Node.js 24, npm, and a reachable MongoDB instance. The complete application
also needs a local Hardhat chain, configured development actors, and the
cryptographic/evidence-provider settings described in the environment examples.
Docker is optional if MongoDB is already available.

Run `npm run install:all` from the repository root to install all workspaces from
their lockfiles. Create private copies of these templates only when the target
file does not already exist:

| Template | Private target |
| --- | --- |
| `backEnd/.env.example` | `backEnd/.env` |
| `frontEnd/.env.example` | `frontEnd/.env` |
| `contracts/.env.example` | `contracts/.env` |
| `oracle/.env.example` | `oracle/.env` |
| `oracle/.env.oracle2.example` | `oracle/.env.oracle2` |
| `e2e/.env.example` | `e2e/.env` for browser testing |

Configure the actors and service settings privately. Use separate development
wallets for the roles, including two Oracle identities and four auditors. Keep
the Oracle API key and chain configuration consistent across services. Configure
the proxy-signing and evidence-storage settings before testing encrypted uploads.
Never overwrite an existing configuration as an installation step.

```powershell
npm run preflight:manual
```

This reads configuration without starting services, resetting data, or sending
email. Presence checks do not prove credentials or connectivity.

## Fresh local baseline

Start the chain in a separate terminal and keep it running:

```powershell
npm run dev:chain
```

In the application terminal, explicitly select a disposable loopback database.
The example assumes MongoDB listens on port 27017; substitute the loopback port
you actually configured. Process-level overrides leave saved `.env` values
unchanged.

```powershell
$env:MONGODB_URI='mongodb://127.0.0.1:27017/block_insure_demo_dev'
$env:RPC_URL='http://127.0.0.1:8545'
$env:CHAIN_ID='31337'
$env:BLOCKCHAIN_RUNTIME_ENABLED='true'
$env:ORACLE_WORKER_ENABLED='true'
$env:INDEXER_ENABLED='true'
$env:INDEXER_CONFIRMATIONS='0'
$env:FORCE_PUBLIC_DNS='false'
npm run preflight:manual
```

Confirm the database target is loopback before running:

```powershell
npm run dev:bootstrap
```

This explicitly resets application data in the selected database, deploys
contracts, prepares development roles and reserves, and publishes the initial
registry. It creates a clean baseline rather than user policies or claims.
Never run it against a database you need to preserve.

For the optional hybrid registry, obtain and prepare the source files described
in [the dataset guide](../backEnd/datasets/hybrid-v1/README.md), then use
`npm run dev:hybrid` instead of `dev:bootstrap`. Hybrid setup also resets the
selected disposable database. Large source and generated dataset files are
excluded from Git.

## Daily resume

With a valid existing chain and matching database selection:

```powershell
npm run dev
```

`dev:all` is equivalent. Restart application services in the same terminal to
retain process-level database overrides. A new terminal needs the same
overrides. Hardhat loses chain state when its process stops; deployment JSON
alone is not sufficient to resume that state.

Check the services with `npm run preflight:manual -- --local`. Open
`http://localhost:5173` after readiness succeeds. Configure the browser wallet
for RPC `http://127.0.0.1:8545`, chain ID `31337`, and the intended development
account. `npm run preflight:metamask` checks its configured actor identities.
Do not use Oracle workers as browser-wallet identities.

## Email and evidence

Local OTP delivery can use `simulation`. To test real delivery, configure the
backend's `OTP_DELIVERY_MODE=brevo`, private API key, and verified sender. Restart
the application while retaining its database overrides. The API service owns
email credentials; the frontend and Oracles do not need them.

In My profile, save the intended recipient, request a code, and confirm it.
Real manual bank-payment codes require that verified profile, an eligible policy,
and a linked simulated bank account. Wait at least one minute between code
requests. A provider acceptance response does not establish mailbox receipt or
premium payment; verify the inbox and the resulting confirmed transaction.
Simulation never verifies ownership of a real mailbox.

Premium collection opens 30 days before the next fixed installment due date.
Requesting an OTP immediately after purchase is correctly refused. The OTP binds
the installment and quote; a wallet or EFT payment invalidates a stale challenge.
The gateway signer needs test ETH for both settlement and gas. Inspect its funding
status on the Banking page. See [the payment rules](financial-and-provider-workflows.md).

Hospital staff use `/hospital/login` without MetaMask. Provision staff from
**Administration → Hospital Staff** after ordinary administrator SIWE sign-in.
Share credentials privately; no default staff password is seeded. Staff maintain
source records and publication runs automatically. The legacy hospital-wallet
attestation screen is retired.

Evidence is encrypted in the browser before upload. Preserve the browser's
evidence identity and its encrypted recovery backup when reusing a wallet.

## Checks

Compile contracts before artifact checks on a fresh installation:

```powershell
npm --prefix contracts run compile
npm run doctor
npm run verify:all
```

`verify:all` includes hybrid dataset validation and needs the separately prepared
dataset. The subsystem test commands in the root README can run independently.
See [browser testing](../e2e/README.md) for the isolated end-to-end campaign.

The Phase 1 changes require a new local deployment and a separately selected
database. An old saved manifest does not represent a running compatible chain.
Keep Atlas and existing snapshots intact; do not run `setup:local` against them.
For disposable verification, use the explicit loopback database described in the
browser-testing guide and `npm run test:phase1`.
