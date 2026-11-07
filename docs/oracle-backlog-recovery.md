# Oracle backlog recovery and operational compatibility

## Current hosted disposition — 7 November 2026

The recovery release is published. Both hosted workers run operational release
`oracle-appeal-proof-v2`, runtime identity
`0xfbc9911a6b580c43d8b7626e353f24a4beef3ad16b0dc4d74a30d4c83263754d`.
Base uses the activated v5 evaluator profile; frozen inference is unchanged.
Earlier publication/activation instructions below are historical procedures,
not actions to repeat. Hosted sleep/resume, restored checkpoints and near-head
readiness have been observed; this is not a continuous-availability guarantee.
Read `/health/ready` on both workers before a new timed request. Catch-up does
not require a zero-lag promise, a checkpoint reset or another deployment.

Current verification and remaining private acceptance are recorded in
[the acceptance report](comprehensive-acceptance-2026-11-07.md).

## Historical implementation and publication review

Current follow-up: [sponsored appeal compatibility](sponsored-appeal-compatibility.md)
adds protocol v5 with unchanged inference and historical v4/NB dispatch. The v1
release details below are historical; the new active release is v2. Base activation
still requires rollout/readback and an explicitly authorized default-change transaction.

**Local verdict: READY FOR PUBLICATION REVIEW.** Compatibility and recovery tests pass; hosted activation and throughput are not yet verified. No public deployment, funds, chain configuration, model training or Git publication was performed.

## What changed

The old workers processed a single 2,000-block range each normal polling cycle (15 seconds in the maintained hosted configuration). The candidate scans consecutive historical ranges, with at most 10 ranges or a five-second between-range budget per cycle, yielding after every successful range. Historical work resumes after 250ms; near-head work uses normal polling. Work remains serial. An in-flight RPC/event operation is not forcibly cancelled at the five-second boundary.

Each range is processed before its deployment-qualified signed/file checkpoint is persisted, and the in-memory cursor advances only after successful persistence. Failed reads, event processing or persistence keep the range replayable. Scanner failure backoff starts at the normal poll interval and caps at 120 seconds. There are no nested immediate scanner retries. Provider range-limit failures back off without advancement; automatic range-size adaptation is not implemented. Preserve the configured provider-supported range size.

Expired requests are classified before model/API work and checked again before transactions. A missing commitment after the inclusive commit deadline cannot be supplied later; an existing commitment can reveal through the inclusive reveal deadline. Expiry is logged with request ID and does not manufacture fulfillment. The existing on-chain timeout/finalization path remains available. Pending reveal work yields to normal polling with its range retained. Actionable errors also retain their range; there is no new pending-work queue or event skipping.

## Frozen evaluator versus operational release

The unchanged `backEnd/artifacts/xgboost-protocol-v4.json` remains the request-pinned evaluator profile:

- Model identity: `0xe722db3519fc3f2667c5ba1b8a18854b8a59357a925d37ecf38d5903ad9b6595`.
- Frozen profile SHA-256: `3799e45de1e9be95aa728cb33308eab163b0b685a1542779a503a2c494a93ff9`.
- Model bundle, feature/context code, cutoff, result encoding and decision rules are unchanged.

The new `backEnd/artifacts/oracle-runtime-compatibility-v1.json` names `oracle-backlog-recovery-v1` and separately identifies the approved runtime. Its exact files are `oracle/index.js`, `oracle/runtimeProtocol.js`, `oracle/scanRecovery.js`, and `oracle/workerHealth.js`. Full runtime hash is in this manifest, the evidence summary, and Oracle health `operationalRelease`.

The loader checks the exact frozen profile checksum and canonical identity, verifies advisory/legacy evaluator identities and cutoff, requires the approved release/schema/profile identity and exact file set, verifies the runtime manifest fingerprint and all current runtime bytes, and checks unchanged protocol sources against their original hashes. Only the entrypoint and loader have explicit frozen-source replacement exceptions; neither is ignored. Unknown releases/models, missing manifests, extra paths/properties, altered sources or evaluator settings fail closed. No ignore-integrity environment switch exists. `buildProtocolArtifact()` now verifies/reconstructs the frozen request profile rather than freezing current runtime bytes.

This is an operator-approved compatibility release, not a signature, remote attestation or a mathematical proof of equivalence. An operator who replaces code and manifests controls the release. Do not describe the new runtime bytes as the original v4 source. The original artifact is preserved, and request identities, context/decision keys, result hashes, salts and commitments retain their meaning. NB historical dispatch remains intact; arbitrary additional XGBoost versions are not accepted.

The archived original entrypoint is inert test data at `oracle/test/fixtures/protocol-v4-index.txt`, checked against its original frozen hash. Tests verify byte-identical appeal/classification and assessment-construction sections, then execute both old and patched handlers against identical automatic, model-review, invalid-proof, unavailable-context, invalid-appeal and valid-appeal inputs for both identities. Exact assessments, result/reveal arguments and commitments match. Operational deadline changes are tested separately.

## Readiness and settings

`/health/live` stays live during healthy catch-up and provider failure. `/health/ready` requires initialization, an observed head/restored cursor, fresh head and successful poll, no scan error, and at most 150 unscanned blocks. Health exposes `scanHead`, `scanLagBlocks`, `headObservedAt`, `readinessMaxLagBlocks`, and the separate `operationalRelease` identity.

| Setting | Default | Accepted |
|---|---:|---|
| ORACLE_CATCHUP_MAX_RANGES | 10 | 1..50 |
| ORACLE_CATCHUP_BUDGET_MS | 5000 | 1..30000, checked between ranges |
| ORACLE_READY_MAX_LAG_BLOCKS | 150 | 1..150, can tighten |

150 blocks is roughly 30 seconds at the previously observed Base rate of five blocks/second, below the deployed 1,500-block commit window. This is not a processing/deadline guarantee, universal network rule, or finality statement. Review tolerances if changing network/deadlines. Existing polling/range/provider settings need no change for this patch. Keep Render's health check on `/health/live`, not readiness.

## Verified results

Evidence: `verification-results/oracle-compatibility-2026-11-06/`. The older `oracle-recovery-2026-11-06/` directory preserves the initial package-blocked campaign; its failing counts are historical, not the final verdict.

| Check | Final result |
|---|---|
| Oracle suite | 78 passed, 0 failed, 0 skipped |
| Backend unit suite | 263 passed, 0 failed, 0 skipped |
| Local enabled-worker integration plus adjudication regressions | 10 passed |
| Synchronization/integrity | Passed; existing contract-size headroom warning retained |
| Backend and Oracle Docker builds | Both passed |
| Network-disabled verifier inside each image | Both passed, matching frozen/runtime identities |
| Diff whitespace check | Passed |

The enabled-worker test uses actual local Hardhat contracts, child Oracle processes, Mongoose/MongoDB, backend signed cursor controllers, API-key middleware, protocol-decision controllers and log/heartbeat handlers. It exercises 6,000 mined local blocks, expired then valid requests, a lost cursor acknowledgment, rejection of missing API key/wrong signer, restart after one mined commitment, both reveals, pinned-decision preservation, near-head readiness, provider outage/recovery and the existing explicit timeout operation. Exactly two commitments and two reveals are confirmed. Cursor/decision metadata uses a new uniquely named local database each run. The hospital endpoint deliberately returns an invalid synthetic Merkle proof; this is not a healthcare or encrypted-evidence acceptance campaign. Shadow reporting is disabled in this isolated integration. No real provider, email, storage or public signer is used. Local mining is disclosed time/block manipulation.

Initial parity-test failures were malformed test fixtures (missing proof `found` marker, and noncanonical whole-ETH string in context facts). Initial integration failures were a duplicate incident identity and a loss-injection wrapper masking a rejected signature. These fixtures were corrected to exercise the original requirements; production assertions and model thresholds were not weakened. Final suites passed on the final runtime source/manifest. Earlier tests are preserved separately where applicable.

## Commands

From the repository root:

```powershell
npm --prefix oracle test
npm --prefix backEnd run test:unit
npm run verify:sync
npm --prefix contracts run test -- --no-compile --network hardhat test/OracleRecoveryRuntime.integration.cjs test/Phase2AutomaticAdjudication.test.js
node oracle/scripts/benchmarkRecovery.cjs
```

The explicit integration requires MongoDB on 127.0.0.1:27039. It creates a uniquely named `block_insure_oracle_compat_<timestamp>_e2e` database. The preserved task-owned container is `block-insure-oracle-recovery-20261106`; do not reset it or use Atlas for this test. The `.integration.cjs` suffix keeps Docker requirements out of the default contract unit-suite discovery.

The benchmark optionally takes a new output filename as its first argument and refuses to overwrite it. It reads the hash-checked archived original source, so it remains reproducible after this patch is committed.

## Controlled scheduling result

Same workload: 1,200,000 empty blocks, 600 ranges, 1,200 event queries and 600 checkpoint writes. Synthetic costs: 50ms per event query, 10ms per head read and 10ms per checkpoint, normal polling 15 seconds. Both query costs are conservatively charged per range despite parallel execution.

| Measure | Original | Recovery runtime |
|---|---:|---:|
| Cycles | 600 | 60 |
| Head reads | 600 | 60 |
| Simulated elapsed time | 9,057,000ms (150.95min) | 81,350ms (81.35sec) |

This demonstrates removed scheduling waits, not measured public RPC throughput or a hosted ETA. Real event processing, rate limits, receipt latency and cold starts affect actual recovery.

## Final review and publication boundary

Frozen artifacts, inference sources, contracts, ABIs, saved environments and unrelated backend patches are preserved. Docker copy lists now include the runtime manifest and verifier dependencies for both subsystem images. No auth/quorum/financial changes or public transactions were made.

Remaining limits: existing number-only Oracle cursor/reorganization assumptions remain; no new canonical hash journal was added. A persistently failing actionable request can hold its range until its deadlines expire. Existing transaction retries/receipt polling retain their limitations; the outage experiment concerns scanner recovery rather than exhaustive faults at every mining boundary. Known unrelated sponsored-transaction/evidence issues remain separate.

Publish matching backend/worker source and the runtime manifest together after review. Do not regenerate the frozen profile or change the on-chain model default for this operational patch. No frontend redeploy is required by these changes. After publication, inspect both runtime identities, restored cursors, readiness/liveness, measured catch-up and provider errors while preserving Atlas/checkpoints. Hosted verification remains pending; do not claim the current hosted backlog is fixed yet.
