# Dual-worker shadow verification and release assurance

**Historical assurance record, 24 October.** The [26 October migration](xgboost-protocol-migration.md)
adds XGBoost protocol routing. The optional shadow side channel below remains
observational; the new protocol wrapper is a separate decision path. Preserve
the old counts and release hashes as dated evidence, not a certification of newer code.

Review date: **24 October 2026 (Asia/Dhaka)**. Source baseline: `9a98b55`, plus
this implementation. This report covers the selected shadow/DX/regression/release
work, not a new fraud model or a protocol-model promotion.

## What changed

| Area | Implementation |
| --- | --- |
| Independent worker execution | Both workers verify the complete committed registry archive, derive the same bounded observable context and execute the portable XGBoost pipeline locally. |
| Request identity | Chain, manager/coordinator, request block hash, claim facts/version, registry root/version, bundle and source identities bind each assessment. |
| Authentication | Existing Oracle API key plus fresh, purpose-separated Oracle wallet signatures; current role and snapshotted request eligibility are checked. |
| Report integrity | Backend recomputes the expected context, result and explanation hashes. Metrics are included in the signed report payload. |
| Financial isolation | Shadow computation is scheduled separately after Oracle request finalization. No shadow result enters NB verification, commit/reveal hashes, votes, reserves or payouts. |
| Recovery | Independent bounded retry loop and idempotent persistence. Restart backfills the latest 64 finalized requests, at most eight pending attempts per pass. A bad early request does not starve later requests. |
| Visibility | Admin advisory includes worker shadow agreement; worker health exposes separate shadow availability. Failures never become zero risk or an NB substitute. |
| Measurements | Admin assessment timing includes archive/root/context and scoring; worker timing includes context HTTP and local verification/scoring. Process RSS/heap samples are recorded. |
| Daily developer workflow | Explicit test manifest override; distinct Oracle health ports; API readiness before worker startup; launcher waits for backend/frontend/both workers; non-resetting resume, application restart and missing-chain behaviour are exercised. |
| Release/deployment | Source/evidence candidate snapshot, shared source/artifact packaging checks, Docker dependency closure, build filters and a rollout/rollback handoff. |

The default Admin model remains XGBoost. Its weights, calibration and balanced
policy are unchanged. NB remains the proof-bound protocol model. Solidity and
ABIs are unchanged, including four-Auditor snapshots, 3/2 thresholds and pull
payments. Matching shadow workers share code, model and root publisher; their
agreement is deterministic execution evidence, not independent medical truth.

## Worker and API flow

1. The normal Oracle poller verifies a claim and completes its existing NB
   commit/reveal workflow.
2. A separate shadow loop examines a bounded window of finalized requests.
3. A worker signs a `CONTEXT` message identifying its wallet, request, chain,
   coordinator and fresh timestamp. `/api/oracle/shadow/context` verifies the
   API key, signature, current role, eligibility, claim version and registry root.
4. The backend returns canonical registry records from the pinned archive with
   a deterministic context binding. Source beneficiary IDs and unrelated raw
   database fields are excluded. Canonical legacy label fields remain necessary
   to reconstruct existing leaf hashes but are never read as model features.
5. The worker reconstructs the complete root itself, checks the binding against
   its own chain reads, derives observable history and computes XGBoost, OOD,
   calibration, conformal and exact Shapley explanations.
6. It signs a separate `REPORT` message over the report and metrics digest.
   `/api/oracle/shadow/report` re-verifies authorization and recomputes all
   expected assessment hashes before inserting the report idempotently.
7. Admin reads aggregate only matching request-block/root/model/version records.
   Two reports from the same wallet cannot count as two-worker agreement.

All HTTP endpoints are optional to the financial protocol. A source mismatch,
archive gap, missing invoice, revoked role or outage produces no shadow success.
Temporary failures are retried within the bounded loop. Missing invoices are
rejected before transmitting the full archive. No shared credentials, wallet
keys, patient history or raw provider error bodies are written to public logs.

Persistence is append-style application discipline, not blockchain immutability:
a privileged database operator can alter stored reports. The stored records
retain the verified identity and digests, not a standalone signed-envelope proof
for an independent offline verifier. Source hashes and matching worker reports
must not be described as protection against a compromised publisher/backend.

The current endpoint supplies a full canonical snapshot, capped at 10,000 rows
and a 16 MiB worker response limit. This is a prototype trade-off for independently
rebuilding the root, not a claim of scalable multiproof delivery. Signature
freshness is two minutes and both shadow endpoints share a request rate limit.

## Measurement boundaries

- `inferenceMs`: feature-ready XGBoost/OOD/calibration/conformal/explanation.
- `totalAssessmentMs`: Admin archive read, root reconstruction, context,
  inference and NB comparison; excludes controller RPC and durable write.
- Worker `totalMs`: context HTTP plus local root verification, context and
  inference; excludes report HTTP. `scoringMs` includes local archive verification
  and feature construction, not just tree traversal.
- RSS and heap values are **whole-process samples**, not isolated model memory,
  peaks, or a machine-wide CPU/memory benchmark.
- Browser workflows cover full transaction paths; timing a handful of reports
  is not a throughput or broad reliability estimate.

No new classification study is run here. The existing held-out-family weakness,
engineered labels and lack of natural-fraud ground truth remain. Do not replace
them with a claim that worker agreement improved detection accuracy.

## Fresh verification on 24 October 2026

These are staged checks of this worktree, not one uninterrupted test campaign
against a committed release. The browser campaign used one worker and separate
disposable chains for scenarios that advance time.

| Check | Observed result |
| --- | --- |
| Backend units and analytics | 203 tests passed; Section 3 analytics passed |
| Oracle units | 25 passed |
| Python mathematical/component regressions | 23 passed; no training |
| Contract regressions, including stateful invariants | 139 passed; Solidity unchanged |
| Actual MongoDB recovery/projection/advisory checks | 13 passed |
| Authenticated/public/security/resilience campaign | 43 distinct browser cases passed, including simultaneous encrypted submissions and corrected-version shadow agreement |
| Production frontend | Lint/build passed; seven production-browser cases passed, including 320px and keyboard/navigation/theme checks |
| Daily lifecycle | Actual `npm run dev:chain`; two `npm run dev` launches preserved records/counters/configuration; missing chain failed without clearing data or starting services |
| Independent worker restart | Oracle 1 restarted and backfilled; two report records before and after, with no duplicates |
| Static checks | 26 modified/new JavaScript files parsed; seven repository groups, ABI/config/model synchronization, packaging and release-template checks passed |
| Production dependency audit | Backend, frontend and Oracle: zero reported advisories at review time |

The first daily-lifecycle attempt exposed an API/Oracle initialization race.
Workers could attempt a backend cursor read before the API listened and then
wait 30 seconds for retry, reaching the launcher's 30-second deadline. The
launcher now waits for API readiness before starting workers. The lifecycle
check was rerun successfully after this change. Earlier focused development
checks are not added to the distinct final campaign count.

Two retained worker reports measured context-plus-local assessment times of
approximately **1.66 and 2.48 seconds**, with local verification/scoring portions
of **220 and 240 ms**. Process RSS samples were approximately **95–97 MiB**.
This is a two-report observation, not a throughput, tail-latency or peak-memory
claim; report upload/persistence is excluded. Concurrent browser claims were
checked for distinct evidence/assessment identities and matching worker reports.

Slither was unavailable (`ENOENT`); no fresh Slither result is claimed. Docker
source closure passed, but images were not built. Hosted health and transaction
tests were not run in this pass. All test application/chain processes were
stopped and the pre-existing test MongoDB container was restored to its original
stopped state. No new environment/container, hosted activation or Git commit
was created.

## Safe reproduction

Use the already prepared loopback test MongoDB. These tests require explicit
disposable local data and do not create a database service automatically:

```powershell
$env:E2E_MONGODB_URI='mongodb://127.0.0.1:27019/block_insure_e2e'
$env:E2E_RPC_PROXY='true'
npm run test:stabilization

# Separate actual daily-command lifecycle verification
npm run test:stabilization -- --daily-launcher
```

The campaign rebuilds disposable deployments because expiry/appeal/benefit time
travel cannot safely share one chain. It uses one browser worker and keeps
normal saved `.env` and deployment files unchanged. The daily verification runs
the actual `npm run dev:chain` and `npm run dev` commands, stops/restarts only
application services, checks preserved source state and then verifies that loss
of the chain fails with explicit reset guidance rather than clearing MongoDB.

Portable packaging is independently tested in a temporary source-only directory
with no backend `node_modules`, Python environment or database. Modified shared
sources fail integrity validation. Docker COPY dependency closure is checked;
that does not claim Docker images were built or deployed.

Release instructions are in [the deployment handoff](shadow-deployment-handoff.md).
The final dated machine record is
`verification-results/shadow-release-assurance-2026-10-24.json`; it distinguishes
executed checks, corrected failures, unavailable tooling and exact fingerprints.
The source/evidence freeze is `verification-results/release-candidate-2026-10-24.json`.
Neither is a Git commit, release tag, hosted activation or manuscript update.
