# Part 1: application stabilization

Implementation review: 23–24 October 2026. Verification results are recorded
separately in `verification-results/part1-stabilization-2026-10-24.json`.

## Daily development

Keep the local chain running in its own terminal:

```powershell
npm run dev:chain
```

When a valid deployment already exists on that running chain:

```powershell
npm run dev
```

`dev` and `dev:all` verify and reuse the deployment. They do not reset MongoDB
or redeploy contracts. They fail before launching workers if the configured
on-chain model identity differs from the frozen local artifact; publication of a
new model is an explicit administrator action, never an automatic startup write.
The launcher starts the backend without a file watcher
to avoid automatic restarts while verification is running; restart it after
backend changes. Frontend development retains Vite's refresh behavior.

Hardhat keeps its chain in memory. Restarting the chain loses its deployment;
the launcher fails with recovery instructions rather than silently replacing it.
There is no implemented disk persistence or automatic recovery of that chain.

`dev:bootstrap` explicitly passes `--reset`; `dev:hybrid` explicitly passes
`--reset --hybrid`. These are destructive setup commands for disposable databases,
subject to the existing database-name and host checks. They are not daily resume
commands. `dev:e2e-isolated` retains an explicit clean hybrid setup.

The local deployment manifest supplies generated component addresses to all
launcher children. Explicit process overrides take precedence, including isolated
tests. Existing `.env` files remain supported for secrets and standalone commands;
the deployment scripts maintain those compatibility copies. Render does not load
this local launcher or its manifest and continues using hosted configuration.

## Prepared regression environment

The resource-limited container `block-insure-part1-mongo` uses `mongo:8.0`,
0.75 CPU, 768 MB memory, and loopback port `27019`. Its test database is
`block_insure_e2e`. It does not connect to Atlas.

After starting that existing container:

```powershell
$env:E2E_MONGODB_URI='mongodb://127.0.0.1:27019/block_insure_e2e'
$env:E2E_RPC_PROXY='true'
npm run test:stabilization
```

The runner requires an explicit local database; it no longer creates MongoDB
processes automatically. Each stage starts and stops its owned Hardhat, API,
Vite, Pinata simulator and two Oracle processes. RPC recovery uses port `18545`.
Tests use one browser worker; backend and Oracle unit-test files also execute
serially by default to reduce CPU spikes. Time-travel finality scenarios receive separate
deployments. The showcase stage follows the claim workflow on the same deployment
because it inspects the claims that workflow creates.

These stacks write manifests and keys under ignored `tmp/stabilization-*`
directories. They do not overwrite normal environment files or the saved local
deployment manifest. The test-only submission rate limit supports repeated
multi-role scenarios; the application's default limit remains unchanged.

Storage recovery tests use a newly named local `stabilization_storage_*_test`
database and remove only that database after completing:

```powershell
npm run test:stabilization:storage
```

Do not run compiler-heavy mutation campaigns alongside browser workflows.
Run targeted checks first and the full campaign at a stable checkpoint.

The legacy `@unfinished` filenames remain opt-in in the ordinary E2E command.
The stabilization campaign includes their benefit, isolation, finality and RPC
cases explicitly, with the fresh deployments those scenarios require. Passing
this campaign does not imply that all specs can share one time-warped chain.

## Data and inference

The current Kaggle provider-risk benchmark remains the research source. Downloaded
Synthea files are ignored local references and are not part of runtime inference.

Runtime extraction ignores evaluation labels, `fraudSignals`, injected velocity
flags, injected near-duplicate flags and synthetic noise markers. Preserved
`observableHistory` captures source history before experimental mutation and is
included in the canonical Merkle leaf. Missing history is treated as unavailable,
not reconstructed from potentially injected flags. Old generated runtime rows
without this field therefore do not contribute those history features. Rebuilding
source artifacts can populate it; historical numerical results remain historical.

The runtime artifact is versioned `observable-runtime-v2`; Backend and Oracle
loaders check that version and artifact identity. This changes inference inputs
without asserting new training, calibration accuracy or real-world fraud results.
Contracts must be configured with the corresponding model identity before use.
Local setup publishes it. Updating hosted workers/model configuration is a separate
deployment step; hosted dormant flags were not activated by this work.

## Read projections

Claim and policy snapshots are derived from confirmed indexed events. Only
entities touched by new events are fetched, with at most four concurrent entity
reads. Settlement quotes and purchased economic terms are stored with claim
snapshots, avoiding repeated per-claim RPC queries in portfolio summaries.

Snapshots are deployment-scoped and versioned by block. Their separate checkpoint
advances after writes and canonical-hash verification. Interrupted refreshes retry;
a detected reorganization rebuilds the affected deployment's derived snapshots.
Raw events, independent hospital records, evidence, mandates and user data are
not discarded by that repair. Policy time-dependent status is evaluated at the
projection checkpoint's timestamp. Projection results can lag chain tip by the
configured confirmations; chain balances and enforcement remain authoritative.

Wallet claim/policy lookup uses indexed event identities. Claim timelines read
indexed events, verify their block hashes and enforce a 1,000-event export limit.
Generic chunked history helpers remain for compatibility with other research and
payment-history consumers; this is not a promise that every historical RPC path
has been eliminated.

## User experience and boundaries

- Optional profile editing at `/user/profile` permits only contact fields; it
  cannot change roles, wallets or verification status and does not implement KYC.
- The manual-payment inbox explicitly identifies simulated delivery and preserves
  the existing demo OTP autofill workflow.
- Evidence preview uses the existing authorization, integrity and decryption path.
  PDF/PNG/JPEG previews open in a native dialog, supporting Escape and focus return;
  object URLs are revoked after closing. Other types remain downloadable.
- Benefits navigation links death-benefit claimants to policy management for
  surrender, maturity and beneficiary maintenance.
- Reputation describes agreement with quorum outcomes, not established fraud
  accuracy or clinical expertise. Voting thresholds remain unchanged.
- A hospital finding, model risk estimate or failed Oracle integrity check is
  not itself a final fraud verdict. The existing application-level Oracle
  agreement, auditor quorum and funded pull-payment transitions remain the
  decision and settlement boundaries; blockchain consensus is a separate layer.
- Notification update failures produce actionable feedback rather than unhandled
  promise rejections.

The manuscript, advanced ML methods and journal protocol extensions remain later
work. Historical research outputs must not be described as fresh measurements of
this runtime revision.

## What this does not establish

- Hardhat/fixture execution is not a deployed public-network test or a real bank
  transfer. Hosted services were not reconfigured or activated.
- The profile is optional contact information, not KYC; the OTP inbox is a clearly
  labelled simulation, not SMS/email delivery.
- Read projections are rebuildable query aids, not authorization or money-transfer
  authorities. Recovery tests exercise interrupted writes and canonical replay;
  they are not a distributed multi-writer or production-load certification.
- Historical mutation/research artifacts retain their original execution dates.
  Refreshing the research inventory never reruns or upgrades those measurements.
