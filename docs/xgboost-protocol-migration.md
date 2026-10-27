# XGBoost protocol migration and operator handoff

Review date: **27 October 2026, Asia/Dhaka**. Baseline `b661ead` plus the current
uncommitted migration. No Git staging, commit, push or hosted activation is part
of this work. This document supersedes the earlier NB-default architecture only
for requests explicitly bound to the new protocol identity.

## 1. Model arrangement

The complete portable XGBoost pipeline (observable binary/continuous inputs,
graph/temporal context, calibration, diagnosis-conditioned OOD, conformal outputs
and exact SHAP) is the default **risk-based Oracle routing model** for newly
deployed configurations. Each worker verifies the committed full registry root,
constructs the same time-bounded prior context and computes the pipeline locally.
The backend recomputes accepted decision receipts before durable storage.

`backEnd/artifacts/xgboost-protocol-v1.json` binds the unchanged evaluated model
bundle, source manifest, selected policy, threshold and routing implementation
to a bytes32 identity. The contract's existing per-request model-version field
and exact commit/reveal hashes are reused. No Solidity/ABI, quorum, reserve or
withdrawal rule changes are needed.

NB/LR remain comparators. Workers retain the exact frozen NB implementation for
requests whose model identity is historical NB. This is backward compatibility,
not an automatic switch back when XGBoost fails. Existing deployments resume
without changing their default; the launcher warns when that default is NB.
Fresh deployment explicitly publishes the XGBoost identity.

## 2. Decision policy

| Condition | Outcome |
| --- | --- |
| Missing/invalid proof, wrong patient/hospital/invoice, invalid record or existing mandatory rule | Automatic verification cannot succeed; existing manual/failure path remains |
| Complete committed context and score below frozen threshold, no mandatory rule | Worker may verify; exact two-worker agreement still required |
| Score at or above threshold | Manual-review recommendation, not a fraud verdict |
| OOD warning or ambiguous conformal set alone | Display uncertainty; no additional unconditional review gate |
| Context/artifact/inference unavailable | Never substitute zero risk or NB; record failure outcome when possible, otherwise retry/timeout |
| Different worker results | Exact-result conflict; existing human-review path |
| Unrecognized model identity | Refuse evaluation; do not guess a compatible model |

"Manual" preserves the current contract lifecycle: Oracle failure/conflict/
timeout records `ORACLE_FAILED` and sets manual-review eligibility. An authorized
actor opens the four-Auditor review after the configured routing delay. The new
model does not bypass that delay, open a review on its own or invent a new state.

The preserved operating point is **0.086932212** (86,932,212 integer billionths),
selected in the earlier validation-only balanced policy experiment. It is not an
8.69% validated real-fraud probability or a newly optimized threshold. The 30%
validation comparison budget is not a live queue ceiling. Recall/shift/engineered
label limitations remain exactly those recorded in the Phase 3 study.

Unavailable assessment storage is signed and keyed by chain, coordinator,
request block, request/version/model and worker. The first accepted decision is
reused across retries/restarts before commit/reveal. A transient recovery must
not replace the value of an existing commitment. A total API outage can prevent
receipt recovery: the worker must retry or let the existing timeout be finalized,
never submit a different result or pretend the request was processed.

## 3. Package checks and deliberate updates

```powershell
node scripts/packageXgboostAdvisory.js --check
npm run protocol:check
```

When intentionally revising code/model/policy, review the change and run the
affected tests, then explicitly repackage in order:

```powershell
node scripts/packageXgboostAdvisory.js
node scripts/packageProtocolModel.js
```

These commands write local metadata; they do **not** retrain, publish on chain,
redeploy or update any existing request. Never repackage simply to hide a hash
mismatch. New retrained models need versioned archives and request dispatch
support before changing the active identity. Keep prior models available while
their requests can still require processing. The present dispatcher supports
the named NB and XGBoost-v1 configurations, not arbitrary future artifacts.

No periodic/online retraining is implemented or desired here. Hospital records
without labels support integrity/context, not ground-truth training. Monitor
distribution/workload/history availability, then evaluate updates offline with
trustworthy outcomes or clearly labelled controlled studies. Do not turn model
predictions/Auditor agreement into independent fraud labels.

## 4. Existing deployment: dry run, apply and rollback

Deploy matching API and both workers first. Keep the old model available until
old requests have finished. Review explicit RPC/private signer configuration and
the selected manifest. The script loads backend `.env` privately, with shell
values taking precedence. It never resets or deploys contracts.

```powershell
# Read-only on the selected network; no signer transaction.
npm run protocol:migrate -- --manifest contracts/deployments/localhost-31337.json

# Only after the dry-run identity/network review and transaction authorization:
npm run protocol:migrate -- --manifest contracts/deployments/localhost-31337.json --apply --expect <observed-current-identity>

# Read-only rollback plan; --apply and matching --expect are still required to send.
npm run protocol:migrate -- --manifest contracts/deployments/localhost-31337.json --rollback
```

For public networks choose their actual manifest and matching HTTPS `RPC_URL`.
`--expect` prevents applying a plan prepared against a different observed
default; it is an operator guard, not an atomic Solidity compare-and-swap.
Do not allow concurrent admin model publications. This changes only the default
for future requests. An existing XGBoost request remains XGBoost after rollback.
Keep version-capable workers running for it. Unknown identities are refused.

## 5. Monitoring and interpretation

Authenticated Admin endpoint: `GET /api/oracle/monitoring`. It reads at most
1,001 deployment-scoped log rows, reports the latest 1,000 and whether truncated,
and groups workers by request/version to avoid counting two workers as two claims.
It exposes score histogram/means, observed review outcomes, missing prior-history,
OOD/conformal warnings, inference/context failures and worker disagreements.
Recent/earlier half means are descriptive shift indicators, not significance
tests or estimates of fraud accuracy. Logs carry receipt-validated transaction
identities; observational metadata remains an application record, not medical truth.

There are no patient records/keys in the aggregate. There is no automatic
threshold change, email alert or model promotion. Review counts are Oracle
routing observations, not a measured human review queue. Missing logs or a
bounded/truncated window limits coverage and must remain visible.

## 6. Email completion — user steps

The implemented flow is wallet login → My profile → save recipient → request
email verification → confirm received code → Banking manual payment OTP. Gmail
plus aliases are accepted as distinct saved address strings and can share one
inbox; they are not independent people/mailboxes. Account/sender/API-key setup
and actual receipt require the user. Keep Brevo credentials backend-only.

Follow [manual next steps](manual-next-steps.md) for real delivery and error/
expiry/replay checks. The local automated campaign forces simulation; delivery
unit tests mock HTTP. No real email is sent by these checks. Production simulation
is rejected, and Brevo failure never falls back to an on-screen code.

## 7. L1 and L2 preparation

The prepared networks are Ethereum Sepolia (11155111) and Base Sepolia (84532).
This is two independent EVM deployments, not a bridge/split-chain architecture.
Network IDs and testnet purpose were checked against
[Ethereum networks](https://ethereum.org/developers/docs/networks/) and
[Base chain IDs](https://docs.base.org/base-chain/api-reference/ethereum-json-rpc-api/eth_chainId).
Actual availability, faucets/provider limits and fee details must be rechecked
before public execution. No paid subscription or mainnet deployment is required.

Use `deploy/sepolia.env.example` / `deploy/base-sepolia.env.example` as private
operator-setting inventories. They are not automatically loaded by the CLI.
Populate shell/secret-store values privately. `RPC_URL` must match the chosen
network for backend/worker/check/measurement scripts; `SEPOLIA_RPC_URL` and
`BASE_SEPOLIA_RPC_URL` are network-specific Hardhat overrides.

After actual authorization/account funding, the deployment commands are:

```powershell
npm run deploy:sepolia
npm run deploy:base-sepolia
```

Choose one at a time. Each writes a separate network/chain manifest, including
the default model identity; non-local deployment does not rewrite application
`.env` files. Explicitly use the smaller example premium/coverage/reserve values;
local `.env` values can override defaults and otherwise consume unnecessary
test tokens. Fund/authorize all required demo roles/Oracles and the manager reserve
deliberately; deployment alone does not complete those steps. Never use public
Hardhat development keys on testnets. Preserve the local chain configuration.
Deployment and public migration writes refuse the first 20 known default local
accounts and require the selected test chain; this is a guard against accidental
reuse, not proof that an arbitrary private key is securely held.

## 8. Actual receipt measurement

Replace the deliberately invalid placeholder in
`deploy/measurement-transactions.example.json` with real operation/hash entries
in a private/local input file. Optional `submittedAt` is the actual observed ISO
submission timestamp, not invented retrospective timing.

```powershell
npm run measure:network -- --manifest contracts/deployments/sepolia-11155111.json --transactions output/sepolia-transactions.json --output output/measurements/sepolia.json
npm run measure:network -- --manifest contracts/deployments/baseSepolia-84532.json --transactions output/base-sepolia-transactions.json --output output/measurements/base-sepolia.json
```

Set the matching `RPC_URL` in each shell first. Collection is read-only and
checks the chain and canonical transaction/receipt blocks. It records success/
failure, gas, effective price, execution fee and an exposed L1 data fee when
provided. Missing data fee is unknown, never assumed zero. Execution plus known
data fee is not universally all-in: chain-specific operator/other fees may apply.
JSON and CSV retain raw integer wei, operation labels and manifest checksum.
Testnet observations are not mainnet cost predictions; rows are not an additive
lifecycle. A block timestamp difference is not finality or end-to-end server latency.

## 9. Hosted rollout and exact ownership

| Service | Values/settings owned here |
| --- | --- |
| Vercel frontend | Public API origin, selected chain/RPC/network/explorer, all VITE component addresses and deployment blocks; rebuild after changing them |
| Render API | MongoDB, JWT/OTP/PRE/Pinata/Brevo secrets, HTTPS RPC/chain, same manifest addresses/blocks, registry publisher and privileged operator keys, allowed origins/SIWE, indexer confirmation policy |
| Oracle 1 | Instance 1, primary proof source, its distinct key, same RPC/chain/manager/start block, backend URL/API key, shared protocol/model package |
| Oracle 2 | Instance 2, oracle2 proof source, its own distinct key, identical protocol/model package and matching request-bound context |

Roll out the matching revision to API and both workers before changing a live
model default; then deploy frontend labels. Optional Docker recipes include
shared files and the protocol artifact, but static inclusion is not an image
build. Render/Vercel local configuration changes are not automatic hosted updates.
Never put private credentials into `VITE_` variables or copy all operator secrets
to every service indiscriminately.

Preserve existing off-chain preview flags until a shared chain is configured:
API `BLOCKCHAIN_RUNTIME_ENABLED=false`, `INDEXER_ENABLED=false`; both workers
`ORACLE_WORKER_ENABLED=false`. For deliberate full activation verify deployments,
roles, roots/archive/history, model identity, reserves, origins/SIWE, uploads and
worker URLs first, then enable processing. Configure public-network confirmation
depth deliberately; the local zero-confirmation test setting is not a hosted policy.
Run health checks and actual hosted claim/payment/review/withdrawal tests. Real
email and public transaction observations remain user-assisted checks.

## 10. Final manual handoff

1. Add/verify Brevo sender and private API key, restart backend and observe both
   profile and payment emails plus the corresponding transaction.
2. Start the actual manual local stack using the maintained startup runbook;
   verify that new requests carry the XGBoost identity and old ones keep theirs.
3. Obtain separate public testnet wallets/RPCs/faucet balances; authorize each
   network deployment, role/reserve setup and migration explicitly.
4. Copy generated public manifests into the right hosting settings, deploy the
   matching revision, verify hosted workflows and capture actual receipts.
5. Review measurement units/provenance and freeze the next application/research
   release. No Git add/commit/push is performed by this implementation pass.

Fresh executed checks, failures/corrections and remaining unavailable layers
belong in `verification-results/xgboost-protocol-migration-2026-10-27.json`.
Earlier reports retain their source/metric scope. This migration does not invent
new fraud labels, retrain the model or resolve its held-out-family limitations.

## 11. Executed verification — 26–27 October 2026

**Pre-manual audit follow-up, 27 October:** both operator CLIs reject unknown,
duplicate or missing arguments before creating a provider/signer. In particular,
`--rollbak --apply` cannot silently select promotion. The measurement output must
be a new `.json` path, with neither it nor the paired `.csv` already present; choose
a new filename for another collection. Inputs/manifests and prior results are
preserved. Both CLIs use a 10-second HTTP request timeout (not an overall command
deadline). The follow-up uses focused unit checks and an actual isolated migration/
measurement run, plus all 214 backend tests and analytics; it does not repeat
the broader browser campaign below. See
[pre-manual audit](../verification-results/pre-manual-audit-2026-10-27.json).

| Layer | Observed result |
| --- | --- |
| Backend / Oracle | 212 / 30 tests passed; backend analytics also passed |
| Contracts | 143 passed, including stateful invariants and both directions of pending-request/default migration |
| Actual MongoDB | 14 passed, including concurrent first-decision persistence, reload and deployment isolation |
| Actual migration/measurement CLI | One isolated-chain integration passed: authorized promotion/rollback, stale expectation and unauthorized signer rejection, unchanged nonces for rejected calls and read-only receipt collection |
| Mathematical components | 23 passed; no model training or classification reevaluation |
| Authenticated browsers | 43 distinct cases passed across staged runs; seven claim/showcase/concurrency cases reran under the final packaged identity |
| Production frontend | Lint/build and all seven browser cases passed, including 320px |
| Daily workflow | Two ordinary `dev` launches preserved chain/data/configuration; lost-chain launch exited with recovery guidance and no app services |
| Worker recovery | Actual restart after mined commitment and before reveal preserved the same commitment; post-finality backfill remained idempotent |
| Integrity / release | Package identity, ABI/config sync, seven repository groups and release template passed |
| Dependency audit | Backend, frontend and Oracle production dependencies: zero reported advisories at review time |

This was a staged campaign with focused corrections, not one uninterrupted run
against a single final source hash. Earlier groups were not retroactively labelled
as full final-identity coverage. A monitoring receipt-envelope mismatch and an
API-only shared dependency resolution issue were reproduced, fixed and rerun;
malformed inference now fails closed. Windows restart interrupted early attempts,
which are excluded from passing counts. Slither was unavailable, Docker images
were not built, and no hosted transaction or real mailbox check is claimed.

The final local operational observations include deliberate worker delay/restart;
they are diagnostic samples, not ordinary-network latency or throughput. The
structured verification record retains their scope and the source hashes.
