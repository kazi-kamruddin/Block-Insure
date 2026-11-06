# Transaction and evidence stabilization — local verification

Latest follow-up: [sponsored appeal compatibility](sponsored-appeal-compatibility.md)
resolves the preserved appeal limitation locally through a new v5 protocol profile.
The prior v4 limitation below remains true for v4-pinned requests. Publish both
reviewed batches together; hosted activation and claim4 recovery are still pending.

This batch repairs off-chain confirmation and evidence status behavior. Contracts, authorization roles, quorum, financial rules, frozen evaluators and the merged Oracle recovery release are preserved. No hosted changes, live recovery writes or public transactions are authorized/performed by this batch.

## Confirmed defects and scoped remedies

1. Claim submission already uses configured-manager events plus exact owner/policy/facts/hash/CID binding. That fix was already in the merged source; its 13 focused regressions are retained. No rewrite was needed.
2. Admin confirmation compared outer sender/target and could reject a successfully sponsored operation. It also accepted an existing audit row before checking its actor/claim, and parsed events without checking their emitter. Confirmation now verifies the trusted manager event and exact claim. Manual review uses its `sentBy` actor event. Request-Oracle and timeout operations lack an actor event, so sponsored execution must prove a successful internal CALL from the authenticated wallet to the exact target/method/claim. Direct transactions verify sender, target, method and argument. Retry still revalidates proof and cannot borrow another actor/claim's audit row. Repeated confirmations do not add another audit/notification; notifications reflect current claim state rather than forcing an earlier pending label.
3. Wallet premium confirmation now binds the configured manager's unique PremiumPaid event, payer and policy ownership, without requiring relayer transport addresses to be the payer. Multiple matching payments are rejected as ambiguous rather than selecting an arbitrary one. Existing notification deduplication is retained.
4. Successful appeal registration now binds the configured manager's ClaimAppealed event to claimant, claim and reason, plus the adjudicator's version/round event. Existing historical fact checks, immutable bundle rules and attempt recovery remain. Failed/reverted sponsored appeals without verifiable ownership are still retained for investigation, not automatically reopened as safe to retry. The unchanged frozen Oracle validator still rejects sponsored appeal provenance: registration compatibility does not establish end-to-end sponsored appeal processing. No Oracle evaluator file was changed.
5. Retained cancellation-refund Admin approval/rejection/allocation had the same direct-only assumption. These confirmations now verify the exact operation/actor and trusted benefit event. Parsing uses the full maintained benefits ABI because the read service's reduced ABI omits those events. User cancellation/refund withdrawal already follows on-chain state/receipts without this backend guard; it was tested, not redesigned. Disabled death/maturity flows were not restored.
6. Empty evidence no longer reports verified. The API returns verified=false for zero files. The UI displays Awaiting evidence linkage, including defensive handling of an old verified=true/zero-document response.
7. The merged registry receipt-recovery patch remains unchanged and is exercised by unit/storage restart checks. No new publisher architecture was added.

## Current follow-up — 6 November 2026

The follow-up in `verification-results/transaction-evidence-followup-2026-11-06/` supersedes the earlier callTracer-only limitation below. The configured runtime/Render export uses PublicNode; the deployment environment uses Alchemy. These are different local configurations, not proof of the current private Render value. PublicNode rejects `debug_traceTransaction` with -32601 but returns `trace_transaction` for the original sponsored Admin operation. The configured Alchemy key rejected tracing with an upgrade indication; no paid service was enabled. The official public Base debug endpoint also rejected the request. None of the saved envs or hosted settings was changed.

The confirmation verifier now falls back once to the established flat `trace_transaction` format only when the first method is unavailable. Both requests share the same ten-second deadline. Rate limits, outages and timeouts do not trigger another method request. Flat traces require matching transaction hashes and inclusion block, matching outer sender/target/calldata, a unique complete ancestor tree, successful CALL results, and the exact authenticated actor/target/method/ID. Reverted parents, missing/duplicate paths, incomplete child counts, malformed results, ambiguous operations and oversized/deep traces fail closed. Existing trusted event checks remain mandatory. No arbitrary envelope decoding or actor inference was introduced.

The final local Admin controller successfully verified the actual original claim #4 request transaction `0x69ed83de1339de169fc13f29629538fc02be41a836d884113bced604306d19d6`, using real public receipt/state/flat trace and in-memory audit/notification captures. It attributed the authenticated Admin and retained the current SETTLED notification status. This is real read-only public evidence for the proof adapter, not hosted API confirmation or evidence recovery. No signature, calldata body or raw trace was saved.

The follow-up adds 35 component regressions (17 operation/delegation cases and 18 flat-trace cases); all 334 backend tests and 78 unchanged Oracle tests pass. The 70 focused confirmation tests overlap that backend total. Exact final browser outcomes, source hashes, initial diagnostic-fixture failure and the final diff review are recorded in the follow-up summary. The fixture failure was an incorrect OracleTimedOut argument count and was corrected against the maintained ABI; application logic was not changed to satisfy it.

Two additional maintained browser workflows passed on separate fresh loopback databases/deployments: concurrent two-auditor rejection converges once and disables later voting (1 test, 2.0 minutes), and review expiry rejects for insufficient quorum (1 test, 1.3 minutes). The latter uses disclosed local chain time travel. Both run the actual local contracts/API/workers with independent mock-wallet role contexts and the storage stub; they do not exercise real MetaMask or hosted rejection/expiry. No maintained assertions were changed. Docker startup's first ping preceded Mongo readiness and failed; the next ping passed without a reset. The task-owned Mongo container and local test processes were stopped after completion, retaining the database data.

One bounded public sample at 12:32:31 UTC / 18:32:31 Bangladesh time found API ready, both workers ready with scanLagBlocks=0 against their individually sampled heads, and matching recovery-release fingerprints. Frontend public configuration matched Base84532 and the expected API/manager. Initial cold/waking samples were degraded; the later sample does not guarantee ongoing uptime or global zero lag. No cursor was moved by the agent.

Remaining: publish/retest the actual hosted confirmation endpoint; reconcile/decrypt claim #4 only after live-write authorization; separately review the unchanged frozen Oracle's sponsored-appeal validation. No manual dashboard/RPC change is currently indicated for the PublicNode flat-proof path. Do not upgrade Alchemy or spend money merely to enable callTracer.

Claim #4's original ciphertext was independently retrieved read-only from the dedicated gateway (HTTP200, 6,503 bytes) and matched its on-chain SHA-256. Claim4/policy3/expected owner/status9 SETTLED were rechecked. No plaintext or raw file contents were saved; this is availability/integrity evidence, not recovered application metadata or proof of owner decryption.

The flat format and ancestor-address interpretation follow the documented [trace_transaction method](https://www.alchemy.com/docs/chains/trace-api/trace-api-endpoints/trace-transaction) and [traceAddress semantics](https://openethereum.github.io/JSONRPC-trace-module). Provider availability above is established by actual bounded probes, not inferred from a generic method catalog.

## Initial RPC boundary — historical, superseded by the follow-up

Sponsored Admin/refund operations without an actor-bearing event require `debug_traceTransaction` with `callTracer` on the selected RPC. The verifier accepts only one successful CALL from the authenticated wallet to the expected contract/function/ID, rejects failed ancestor subtrees, ambiguous calls, malformed or oversized traces, and bounds the wait. It does not infer actor identity from a successful outcome alone. RPCs lacking tracing return an actionable 409 and leave the mined operation intact.

Local tests validate this with controlled call-trace responses. Actual hosted trace support is NOT verified by these local tests and must be checked before closing the sponsored Admin/refund cases. Do not repeat a mined Admin transaction just because confirmation cannot obtain a trace. The API's ten-second wait bounds its response; server trace timeout is five seconds, but underlying provider cancellation is not guaranteed. The authenticated route and scan limits remain necessary.

## Tests and evidence

Evidence directory: `verification-results/transaction-evidence-2026-11-06/`. See summary.json for final exact counts/source hashes and the coverage matrix below for execution categories. Earlier failing browser traces are retained in stabilization-ekekrk; they are not final passing evidence.

- Component tests execute actual confirmation controllers with receipt/trace dependency doubles, including wrong actors/targets/IDs/events, reverts, ambiguity, unavailable traces and retries.
- Real local MongoDB metadata recovery reconstructs a settled claim's original file and sealed bundle after lost API acknowledgment and concurrent repeated reconciliation; the original hash/CID/capsule stay unchanged and evidence events are not duplicated. Its contract/notification dependencies are explicit doubles; this is not live claim #4 recovery or a cryptographic test of its capsule.
- Browser workflows use local contracts/API, separate mock-wallet browser contexts, real AES/PRE encryption/decryption and synthetic provider stubs. Reviewer grants/revocation, owner-offline inspection, expiry, appeal registration recovery, refund and withdrawal are exercised. They do not constitute real MetaMask/mailbox/provider acceptance.
- The strengthened owner test additionally downloads both original plaintext files after browser decryption and compares bytes with the originals.
- Storage and bank settlement concurrency/restart integrations use fresh local databases. Only test-created databases may be reset by maintained isolation scripts. Atlas, saved envs, previous manifests, old evidence and existing containers are preserved.
- Production UI tests include the zero-evidence indicator at 320px with both old/new API responses. These are synthetic API/session fixtures, separately classified from actual local application execution.

The initial refund regression failed because the new receipt check used the reduced read ABI; the controller and regression fixture now use the full maintained event ABI. The first combined browser run also advanced the shared test clock through the refund scenario before the appeal fixture: the frozen model correctly returned review, contradicting that fixture's expected automatic path. Running the maintained scenarios on separate fresh deployments passed without changing the model, data, threshold or assertion. The final report does not claim arbitrary combinations of time-travel fixtures are order-independent.

## Coverage and outstanding boundaries

| Workflow/invariant | Final local result | Execution evidence | Remaining limit |
| --- | --- | --- | --- |
| Claim direct/sponsored receipt, exact actor/policy/facts/hash/CID | PASSED | 13 existing component regressions within backend unit suite | Actual claim #4 recovery not executed |
| Admin direct/internal-call proof and manual-review actor event | PASSED locally and public read-only proof | Component coverage and actual existing sponsored Admin receipt/flat trace | Actual hosted confirmation endpoint UNTESTED |
| Wallet premium event payer/owner/emitter, ambiguity denial | PASSED | Same 30-test suite | Real sponsored hosted payment UNTESTED |
| Successful direct/sponsored appeal API registration | PASSED | Same component suite; direct appeal browser recovery | Does not validate frozen worker compatibility |
| Sponsored appeal provenance in frozen Oracle | FAILED / preserved boundary | Actual validator extracted without modification; direct=true, sponsored=false, receipt/provider doubles | Separate protocol-behavior review required; never claim this path closed |
| Retained cancellation refund | PASSED | 5 original component tests, extended operation branches and 1 complete browser workflow | Actual hosted sponsored refund confirmation UNTESTED |
| Settled original-file recovery, wrong owner/stale version, concurrent retries | PASSED | 1 real-Mongo integration, receipt/notification doubles | Live original capsule decryption UNTESTED |
| Owner and assigned reviewers decrypt exact original bytes, owner offline | PASSED | Fresh local application browser; real AES/PRE; owner attachment in stabilization-sO0a6Z | Mock wallets and Pinata stub |
| Wrong-wallet denial, grant revocation, evidence/panel version, preparation expiry | PASSED | 2 evidence browser workflows, immutable-set restart integration | Public expiry duration not measured |
| Registry receipt loss/restart and storage concurrency | PASSED | 10 storage integrations; merged publisher patch unchanged | Hosted provider outage not reproduced |
| Gateway concurrency/reconciliation | PASSED | 9 maintained settlement integrations | Simulated banking/local chain |
| Evidence operation restart, ordered anchors, mined-claim registration loss | PASSED | 6 real local chain/Mongo integration tests | No new public transactions |
| Empty evidence status at 320px including old API flag | PASSED | 1 backend unit test; 2 new cases within 13 production UI tests | Hosted revision UNTESTED |
| Existing Base claim #4 owner/reviewer acceptance | UNTESTED | Prepared recovery procedure only | Must recheck original metadata and obtain live-write authorization; settled automatic claim may have no reviewer panel |

The final audit also executed the unchanged `validateAppealCommitment` from oracle/index.js against identical direct and sponsored receipts. Only outer transaction addresses changed; direct passed and sponsored failed. Evidence: sponsored-appeal-boundary.json. This check is deliberately not a green regression test asserting that the limitation is correct. Its decision-bearing code and frozen compatibility package remain untouched under the preservation constraint. A subsequent change needs an explicit compatibility decision; do not silently refresh the operational manifest or weaken the guard.

## Repeating local checks

```powershell
npm --prefix backEnd run test:unit
npm --prefix oracle test
npm --prefix frontEnd run lint
npm --prefix frontEnd run build
npm run verify:sync
node --test backEnd/test/claimReconciliation.integration.js
node --test backEnd/test/stabilizationStorage.integration.js
```

For the two Mongo integration commands, explicitly set E2E_MONGODB_URI to the task's loopback MongoDB (127.0.0.1:27049); they create separate uniquely named test databases. Never point them at Atlas. The disposable container for this batch is block-insure-transaction-evidence-20261106-mongo. Full browser commands and exact database selections are recorded in the campaign logs. Run evidence, refund and time-travel recovery suites in separate fresh deployments as maintained by the phase verification runners; do not reuse the shared-clock deployment across unrelated fixtures.

For the focused lifecycle restart integration, set PHASE_TWO_RECOVERY_ONLY=true and pass an explicit spec argument to runStabilizationE2E.js. With no argument, the runner selects the broad campaign dispatcher before inspecting that flag. This task preserved an initial missing-proxy startup failure and stopped the accidentally selected broader dispatcher after identifying it; only the final explicit-argument run is the authoritative focused result. No assertions or application rules were changed to accommodate either launcher error.

The focused suite completed successfully; sandbox restrictions prevented its normal Windows child-process termination. Only its verified Hardhat/Pinata process tree was terminated with elevated cleanup, after all six tests finished. This is an environment cleanup limitation, not a passing test obtained by terminating a failing scenario. The task-created Mongo container is stopped and retained with its local test data.

## Publication and remaining limits

Review and publish the scoped backend/frontend correction batch together, then verify hosted APIs/UI against that revision. The configured PublicNode proof path now works in the read-only controller probe; actual hosted sponsored confirmations, recovered claim #4 owner decryption and real browser acceptance remain pending. This batch does not resolve MetaMask site classification, clinical document semantics, existing PRE trust/revocation boundaries, or public-network reorganization behavior. Do not label those issues fixed.

Verdict: the scoped correction batch is READY FOR PUBLICATION REVIEW. Full sponsored-workflow stabilization is NOT COMPLETE: frozen Oracle sponsored-appeal provenance remains a confirmed failure, and the actual hosted confirmation endpoint still needs publication/verification. Public trace capability has now been verified through the flat format without a paid provider. There are no Docker-blocked integration checks in the final focused campaign. No public deployment, configuration change, live recovery write or Git publication was performed.

See `docs/claim-four-evidence-recovery.md` for the exact existing-claim procedure. Stop before performing it on the live database/API; a later authorization is required.

## Reviewed publication batch

The following commands are suggestions only; the agent has not run Git staging, commit or push. Context/evidence remain in their maintained ignored locations. Review the unresolved frozen sponsored-appeal boundary before treating this correction batch as full workflow closure.

```powershell
git add -- README.md backEnd/controllers/adminController.js backEnd/controllers/appealController.js backEnd/controllers/paymentController.js backEnd/controllers/policyBenefitsController.js backEnd/services/evidenceChainService.js backEnd/services/transactionExecutionService.js
git add -- backEnd/test/benefitConfirmation.test.js backEnd/test/claimReconciliation.integration.js backEnd/test/emptyEvidence.test.js backEnd/test/transactionReconciliation.test.js backEnd/test/transactionExecution.boundaries.test.js backEnd/test/flatExecutionTrace.test.js
git add -- e2e/tests/frontend-production-quality.spec.js e2e/tests/phase-two-evidence.workflow.spec.js frontEnd/src/components/EvidenceChainPanel.jsx docs/claim-four-evidence-recovery.md docs/transaction-evidence-stabilization.md
git commit -m "Reconcile sponsored transactions with bounded execution proofs"
```

Independent review prompt: Review the current diff for trusted emitter/actor/operation binding, flat-trace completeness and failed ancestry, evidence-version safety, and scope preservation. Check the final source-qualified evidence and distinguish the known frozen sponsored-appeal limitation from repaired API registration. No edits or publication. Return findings before publishing this batch. Avoid another general audit or new feature list.
