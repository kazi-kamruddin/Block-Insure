# Block-Insure

Block-Insure is a thesis prototype for blockchain-backed insurance claims,
multi-oracle verification, fraud-risk scoring, auditor voting, and on-chain
settlement.

The base `InsuranceManager` contract is paired with a dedicated
`ClaimAdjudicator` that snapshots four auditors, enforces fixed quorum rules,
stores versioned decisions, and holds pull-payment settlement allocations. It
is also paired with a deployable
`PolicyBenefitsManager` extension for beneficiary designation, death benefits,
surrender values, maturity benefits, versioned terms, and separately funded
benefit settlement. The normal local deployment installs and synchronizes both
modules.

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
local role accounts, and assigns the configured Admin, four Auditors, and Oracle
roles. It also funds a 1 ETH local settlement reserve. It creates **no
policies, claims, appeals, evidence, oracle logs, or
synthetic user activity**. It does rebuild the synthetic healthcare registry
baseline and commits its Merkle root on the fresh local chain, so newly created
claims can be verified by the oracle from the first run.

The clean role baseline is exactly one Admin, four Auditors, and two Oracle
wallets. Auditor reputation is not seeded; it is derived automatically from
finalized review outcomes. Every manual review snapshots exactly four active
auditors. Three approvals allocate payout automatically; two rejections reject
immediately, and an expired review rejects for insufficient quorum. Local
Hardhat auditor accounts fill any unconfigured third/fourth slots. The two oracle workers use separate registry
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

Keep the Hardhat-node terminal open. For separate application terminals, start
each remaining service with:

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

Alternatively, once a local deployment exists and that same Hardhat node is
still running, start the application processes with prefixed logs in one
terminal. The launcher detects and reuses the existing chain instead of trying
to bind a second process to port 8545:

```powershell
npm run preflight
npm run dev:all
```

Open separate browser profiles (or separate browsers) and connect MetaMask to
the local Hardhat network (`http://127.0.0.1:8545`, chain ID `31337`). Import
the accounts corresponding to the configured `ADMIN_PRIVATE_KEY` and
`AUDITOR_WALLET_ADDRESS` values for the Admin and Auditor profiles. Use any
other funded Hardhat account for the policyholder profile; its first login is
created as a normal `USER`. Do not run `demo:populate` or
`loadtest:claims` when you want an empty simulation.

Administrators cannot approve, reject, settle, close, or decide appeals. Exact
oracle success allocates a payout automatically. Oracle failure can be routed
to manual review immediately by an operator and becomes permissionlessly
routable after the SLA. A valid underfunded claim enters `FUNDING_REQUIRED`
instead of being rejected; once funded, anyone can activate the allocation and
the claimant withdraws it.

Claim and appeal evidence is encrypted in the browser with AES-256-GCM before
upload. Pinata, MongoDB, and the blockchain receive only encrypted bytes and
their hash/CID. The random AES key is encapsulated for the uploader's versioned
Recrypt identity. An owner can grant an assigned auditor a proxy
re-encryption transform key; the backend transforms the encrypted key capsule
without learning the AES key or document plaintext, and the recipient decrypts
in the browser. Private evidence identities live in IndexedDB, with an
encrypted recovery backup derived from a wallet signature. Access grants and
key retrievals are recorded in the evidence-access log, while the raw AES key
is never persisted in IPFS, MongoDB, or the blockchain. Production deployments
must protect the proxy signing key with managed KMS/HSM custody and an explicit
release policy.

The normal claim allowance is controlled by `CLAIMS_PER_WALLET_24H`. Set it to
`0` to disable the daily allowance locally, or opt into the authenticated local
reset control with `DEV_ALLOW_CLAIM_LIMIT_RESET=true`. Never enable the reset
control in production.

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
npm run coverage
npm run test:stateful
# Optional: requires slither-analyzer to be installed separately
npm run analyze:slither
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
npm run generate:datasets
npm run freeze:model
npm run evaluate:phase5
npm run metrics:collect
npm run loadtest:claims
npm run analyze:auditors
npm run charts:generate
```

The Phase 5 commands generate four seeded synthetic registry profiles, freeze
and hash the Bernoulli model artifact, run grouped/temporal evaluation, and
write machine-readable research metrics. These commands intentionally generate
synthetic data and/or test claims. They are separate from the clean local
simulation workflow above.

The admin **Thesis Results** dashboard reads generated artifacts from
`backEnd/evaluation-results`.

## Documentation

- [Current protocol security verification](docs/security-verification.md)
- [Current protocol migration manifest](docs/protocol-v2-migration.json)
- Historical research notes retained for provenance:
  [Section 1](docs/section-1-system-design.md),
  [Section 2](docs/section-2-oracle-security-fraud-model.md), and
  [Section 3](docs/section-3-fraud-model-report-quality.md).
