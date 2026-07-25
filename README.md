# Block-Insure

Block-Insure is a thesis prototype for blockchain-backed insurance claims,
multi-oracle verification, fraud-risk scoring, auditor voting, and on-chain
settlement.

## Project Layout

- `contracts`: Solidity contract, deployment scripts, and Hardhat tests.
- `backEnd`: Express API, MongoDB models, fraud model, and evaluation scripts.
- `frontEnd`: React dashboards for users, admins, and auditors.
- `oracle`: Two configurable oracle-node processes.
- `docs`: Design decisions, limitations, and thesis methodology notes.

## Local Services

### Clean local simulation

Use this workflow for a fresh simulation. It deliberately removes only
Block-Insure runtime data from the configured MongoDB database, deploys a new
local contract, creates **one** `Health Basic` package, funds the configured
local role accounts, and assigns the configured Admin, Auditor, and Oracle
roles. It also funds a 1 ETH local settlement reserve. It creates **no
policies, claims, appeals, evidence, oracle logs, or
synthetic user activity**. It does rebuild the synthetic healthcare registry
baseline and commits its Merkle root on the fresh local chain, so newly created
claims can be verified by the oracle from the first run.

The clean role baseline is exactly one Admin, one Auditor, and two Oracle
wallets. Auditor reputation is not seeded; it remains uninitialized until the
Auditor casts a real vote. The two oracle workers use separate registry
collections, but clean setup gives both the same committed baseline so valid
claims can reach quorum. Research scripts may deliberately introduce divergent
data, but the clean workflow never does.

Start a fresh Hardhat chain in the first terminal:

```powershell
npm --prefix contracts run node
```

Once it reports that it is listening on port 8545, run this once from the
repository root in a second terminal:

```powershell
npm run setup:local
```

The command finishes with a clean-start verification. It must report one
package and zero purchased policies/claims before you start the application.
The deploy step also synchronizes the new contract address into the backend,
frontend, and both oracle environment files.

Then start each service in its own terminal:

```powershell
cd contracts
npm run node
```

```powershell
cd backEnd
npm run dev
```

```powershell
cd frontEnd
npm run dev
```

```powershell
cd oracle
npm run dev
# In another terminal:
npm run dev:oracle2
```

Open separate browser profiles (or separate browsers) and connect MetaMask to
the local Hardhat network (`http://127.0.0.1:8545`, chain ID `31337`). Import
the accounts corresponding to the configured `ADMIN_PRIVATE_KEY` and
`AUDITOR_WALLET_ADDRESS` values for the Admin and Auditor profiles. Use any
other funded Hardhat account for the policyholder profile; its first login is
created as a normal `USER`. Do not run `demo:populate` or
`loadtest:claims` when you want an empty simulation.

Admin claim decisions are signed by the connected Admin browser wallet. The
backend verifies the confirmed transaction and records the same initiating
wallet in its audit log. High-value settlements retain a separate explicit
approval step, but the single configured Admin can approve and execute them in
the local thesis workflow.

Claim and appeal evidence is encrypted in the browser with AES-256-GCM before
upload. Pinata, MongoDB, and the blockchain receive only encrypted bytes and
their hash/CID. The decryption key stays in that browser profile's local
storage, so preserve the policyholder profile if you want to use the
**Download decrypted** control later. Clearing browser storage deliberately
destroys that local key.

The detailed synthetic hospital verification endpoint is not public. Oracle
workers authenticate with `ORACLE_API_KEY`, and the response exposed to oracle
logs contains a limited record commitment instead of patient and diagnosis
fields.

## Verification

Run the complete repository verification from the project root:

```powershell
npm run verify:all
```

Or run individual checks:

```powershell
cd contracts
npm test
```

```powershell
cd backEnd
npm test
npm run evaluate:risk:synthetic
npm run charts:generate
```

```powershell
cd frontEnd
npm run lint
npm run build
```

```powershell
cd oracle
npm test
```

## Research Studies

With MongoDB, the backend, and the local blockchain running:

```powershell
cd backEnd
npm run seed:mock
npm run train:model
npm run evaluate:risk
npm run loadtest:claims
npm run analyze:auditors
npm run charts:generate
```

These commands intentionally generate synthetic data and/or test claims. They
are separate from the clean local simulation workflow above.

The admin **Thesis Results** dashboard reads generated artifacts from
`backEnd/evaluation-results`.

## Documentation

- [Section 1: Smart Contract and System Design](docs/section-1-system-design.md)
- [Section 2: Oracle, Security, and Fraud Model](docs/section-2-oracle-security-fraud-model.md)
- [Section 3: Fraud Model and Report Quality](docs/section-3-fraud-model-report-quality.md)
