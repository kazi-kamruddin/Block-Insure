# Block-Insure

Block-Insure is a thesis prototype for blockchain-backed insurance claims,
multi-oracle verification, explainable fraud-risk scoring, independent auditor
review, hospital-owned attestations, bank-managed premium payments, and on-chain
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
- `frontEnd`: React dashboards for policyholders, administrators, auditors,
  hospitals, and banks.
- `oracle`: Two configurable oracle-node processes.
- `docs`: Design decisions, limitations, and thesis methodology notes.

## Local Services

### Clean local simulation

Use this workflow for a fresh simulation. It deliberately removes only
Block-Insure runtime data from the configured MongoDB database, deploys a new
local contract, creates **one** `Health Basic` package, funds the configured
local role accounts, and assigns one Admin, four Auditors, five Hospitals, one
Bank, and two Oracle identities. It also funds a 1 ETH local settlement reserve. It creates **no
policies, claims, appeals, evidence, oracle logs, or
synthetic user activity**. It does rebuild the synthetic healthcare registry
baseline and commits its Merkle root on the fresh local chain, so newly created
claims can be verified by the oracle from the first run.

The clean role baseline is exactly one Admin, four Auditors, five Hospitals,
one Bank, and two Oracle wallets. Auditor reputation is not seeded; it is derived automatically from
finalized review outcomes. Every manual review snapshots exactly four active
auditors. Three approvals allocate payout automatically; two rejections reject
immediately, and an expired review rejects for insufficient quorum. Local
Hardhat auditor accounts fill any unconfigured third/fourth slots. The two oracle workers use separate registry
collections, but clean setup gives both the same committed baseline so valid
claims can reach quorum. Research scripts may deliberately introduce divergent
data, but the clean workflow never does.

For a fresh one-terminal development stack, configure the `.env` files once
and run:

```powershell
npm run dev:bootstrap
```

The managed launcher starts Hardhat when needed, waits for RPC readiness,
runs the clean deployment workflow only when no valid deployment exists, then
starts and health-checks the backend, frontend, and both oracle workers. Ctrl+C
stops every process started by the launcher. Because bootstrap invokes the
clean setup when deployment is absent, it may reset only the configured local
Block-Insure database.

To reuse an already running and deployed local chain without resetting data:

```powershell
npm run dev:all
```

### Hybrid healthcare-claims simulation

To run the same claimant, admin, auditor, oracle, and settlement workflows with
the hybrid registry, place the four required public CSV files under
`backEnd/datasets/hybrid-v1/raw/` and run:

```powershell
npm run dev:hybrid
```

This validates the prepared hybrid artifacts before resetting local state,
preserves five runtime-aligned compatibility presets required by the claim UI, loads
4,995 deterministic public-secondary-derived registry rows (5,000 total),
deploys the local contracts, commits the resulting registry Merkle root, and
verifies that both Mongo registry snapshots match the on-chain commitment.
Run `npm --prefix backEnd run build:hybrid` first when the raw CSVs change. The
source `PotentialFraud` value remains a weak provider-risk label; only controlled
Block-Insure scenario injection supplies claim-level attack truth.
The original synthetic-only workflow remains available through
`npm run dev:bootstrap`. See
[the hybrid dataset contract](backEnd/datasets/hybrid-v1/README.md) for its
splits, provenance fields, normalization, generated outputs, and limitations.

The manual multi-terminal workflow remains available for debugging:

```powershell
npm --prefix contracts run node
# In another terminal:
npm run setup:local
# Then start services separately or run npm run dev:all.
```

Open separate browser profiles (or separate browsers) and connect MetaMask to
the local Hardhat network (`http://127.0.0.1:8545`, chain ID `31337`). Import
the accounts corresponding to the configured `ADMIN_PRIVATE_KEY` and
`AUDITOR_WALLET_ADDRESS` values for the Admin and Auditor profiles. Use any
other funded Hardhat account for the policyholder profile; its first login is
created as a normal `USER`. Do not run `demo:populate` or
`loadtest:claims` when you want an empty simulation.

Before opening the profiles, run `npm run preflight:metamask`. It validates the
live services, chain, deployment, roles, and balances, then prints only the
public address expected in each browser profile. See
[`docs/manual-metamask-rehearsal-2026-09-01.md`](docs/manual-metamask-rehearsal-2026-09-01.md)
for the complete multi-terminal sequence and MetaMask prompt checklist.

After `dev:hybrid` reports ready, `npm run test:e2e` checks every public and
role-isolated top-level page. `npm run test:e2e:workflow` runs four state-changing
demonstrations: approved automatic/manual bank payments, bank rejection and
policyholder cancellation, automatic two-Oracle approval, and Oracle failure
resolved by three assigned Auditors. The claim journeys finish with claimant
withdrawal and `SETTLED` status. After a clean setup, `npm run test:e2e:all` runs
the complete ordered browser regression, including state-dependent workspace
showcases and reversible hospital-record maintenance.
`demo:populate` is a legacy synthetic-only fixture and must not be used to verify
the hybrid registry because it replaces the runtime registry records.

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

## Deployment

For the no-cost, sleep-when-idle Vercel + Render + Atlas staging path, including
an explicit off-chain preview phase and two restart-safe hosted Oracle web
services, use the
[free-tier staging guide](docs/free-tier-staging-deployment.md). This staging
path is separate from the single-host Compose bundle below and does not alter
the local `dev:hybrid` workflow.

The tracked production bundle runs the frontend, backend, two independent oracle
workers, and an automatic-TLS gateway while keeping MongoDB, Pinata, blockchain
RPC, and wallet custody external. Start with the
[deployment guide](docs/deployment-guide.md); do not deploy the prototype to
mainnet or use real patient/insurance data.

Validate the release structure without secrets:

```powershell
npm run release:check:template
```

After creating the ignored `deploy/production.env`, validate every production
URL, chain, address, identity, and secret relationship with:

```powershell
npm run release:check
```

## Verification

Run the complete repository verification from the project root:

```powershell
npm run verify:all
```

This continues through every offline subsystem and writes a structured result
to `verification-results/phase5-verification.json`. To include local
environment/ABI/address synchronization, run:

```powershell
npm run verify:full
```

For a fast prerequisite and artifact diagnosis:

```powershell
npm run doctor
```

On a fresh checkout, install every workspace from its lock file with
`npm run install:all`.

Or run individual checks:

```powershell
cd contracts
npm test
npm run coverage
npm run test:stateful
npm run test:mutations
# Optional: requires slither-analyzer to be installed separately. If it is not
# on PATH, point the runner at the executable for the current PowerShell window:
$env:SLITHER_BIN = "E:\path\to\slither.exe"
npm run analyze:slither
```

```powershell
cd backEnd
npm test
npm run research:baseline
npm run research:phase34
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

The reproducible offline fraud/triage study does not require MongoDB or a
running blockchain:

```powershell
cd backEnd
npm run research:baseline
```

That command regenerates and verifies the seeded datasets, freezes the
capacity/cost triage policy against the existing model, runs schema-v4 grouped,
provider-held-out and temporal evaluation, regenerates charts, and writes a
research manifest. Runtime-dependent studies remain separate:

```powershell
cd backEnd
npm run seed:mock
npm run metrics:collect
npm run loadtest:claims
npm run analyze:auditors
```

The schema-v4 evaluation uses connected claimant-provider grouping, calibration
inside training partitions, a strict 64/16/20 temporal fit/calibration/test
split, explicit provider holdout, component-bootstrap intervals, grouped
out-of-fold ablations, model baselines, and cost/capacity frontiers. The runtime
triage policy can defer probabilistic risk to manual review but cannot reject a
claim without an authoritative integrity failure.

The hybrid study consumes all 558,211 unique public-secondary claims offline,
trains and tests the separate `provider-risk-real-v1.0.0` weak-label model on
provider-disjoint partitions, and evaluates the existing protocol model against
paired controlled attacks. It does not relabel provider risk as confirmed claim
fraud. Reproduce the hybrid evaluation and 5,000-row Merkle benchmark with:

```powershell
cd backEnd
npm run evaluate:hybrid
npm run benchmark:hybrid
```

Generate the paper-facing JSON, CSV tables, SVG figures, and assurance summary
after regenerating and verifying the research artifacts:

```powershell
npm run research:paper-evidence
```

The paper-evidence command writes its generated tables, figures, and section map
to the ignored local `paper-evidence/` directory. Generated paper PDFs and source
archives live in the ignored local `output/` directory and are not included in a
fresh clone. See [repository artifact storage](docs/repository-artifacts.md).

The admin **Thesis Results** dashboard reads generated artifacts from
`backEnd/evaluation-results`.

The advisory reserve and confidential-evidence studies can be regenerated
together without a running blockchain or MongoDB:

```powershell
npm run research:phase34
```

This produces seeded frequency–severity reserve stress results, real
AES-GCM/Recrypt/Merkle lifecycle measurements, adversarial evidence checks,
four SVG figures, and an updated research manifest. Run `npm run research:all`
from the repository root to reproduce every Phase 0–4 research artifact and
assurance campaign. Research artifacts use atomic replacement, so interruption
cannot replace a valid JSON file with a partially written one.

## Documentation

- [Deployment guide](docs/deployment-guide.md)
- [Current protocol security and operational verification](docs/phase-5-operational-hardening.md)
- [Supervisor showcase guide](docs/supervisor-showcase-guide.md)
- [Current protocol migration manifest](docs/protocol-v2-migration.json)
- [Phase 0/1/2 research and assurance implementation](docs/phase-0-1-2-research-assurance.md)
- [Phase 3/4 reserve and evidence research](docs/phase-3-4-reserve-evidence-research.md)
- Six-page thesis paper: local `output/pdf/block-insure-six-page-paper.pdf` (ignored)
- [Current portable project context](reference/context%20Block_Insure%2013oct.md) (local, ignored by Git)
- Historical deep technical reference: local `reference/block-insure-deep-technical-reference.md` (ignored)
