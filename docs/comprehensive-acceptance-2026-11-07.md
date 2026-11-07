# Comprehensive acceptance and stabilization — 7 November 2026

Status: the combined local correction batch is READY FOR PUBLICATION REVIEW. The advisory-concurrency failure and policy-read inefficiencies were investigated and corrected locally; affected checks pass. Hosted publication/retest remains required. The current follow-up below supersedes historical unresolved-local-failure notes later in this report.

## Local latency/concurrency follow-up — 2026-11-07 14:45 UTC

**READY FOR PUBLICATION REVIEW of one combined batch.** The earlier local advisory/shadow failure is now reproduced, diagnosed and passing. All affected local reruns pass. Hosted availability is not declared resolved: this batch has not been published and no hosted retest occurred during this follow-up.

### Advisory-concurrency diagnosis

The instrumented unchanged test reproduced ECONNRESET while waiting for worker shadow agreement. Both initial concurrent advisory responses were HTTP200, and the failed later GET never reached the Express request observer. Backend processing continued and its process exited only during normal test cleanup. A pooled-connection closure is consistent with this evidence; the precise low-level reason for that socket reset is not proven. There is no evidence here of incorrect inference or lost/merged assessment identities.

The test's idempotent advisory GET now permits exactly one transport retry via `maxRetries:1`, and explicitly requires HTTP200. HTTP errors, persistent resets and the original scenario/expectation deadlines still fail. No state-changing request has gained a retry. [Playwright documents this option as an ECONNRESET retry, not an HTTP-status retry](https://playwright.dev/docs/api/class-apirequestcontext#api-request-context-get-option-max-retries). A real local HTTP probe confirmed first-reset/then-success uses2calls, HTTP503 remains one503 response, and persistent resets fail after2calls. The full original multi-claim/assessment/dual-worker assertions passed first with only that transport correction, then again with final backend corrections. Original failed traces remain retained.

### Policy loading diagnosis and correction

The loader created a new provider inside each policy formatter, with additional independent transports for deployment-bound document/rule lookups. Independent enrichment reads also ran serially. Request-owned providers were not released on success, failure or access denial. The correction reuses the request's contract/provider across policy formatting, indexed wallet identity and issued terms/documents; performs independent term reads together; and closes only the transport it owns. Deployment chain, creation-block hash/code, wallet filters, accepted-document hash, installment and coverage checks are preserved. No authorization or cross-request policy cache was introduced.

Controlled comparison used actual ethers HTTP and ABI decoding against identical synthetic loopback RPC/Mongo fixtures, four document-bound policies and20ms artificial delay per HTTP batch. Before: **13providers,42HTTPbatches,102JSON-RPC operations**. After: **1provider,6HTTPbatches,60JSON-RPC operations**. All52business `eth_call` operations remained, and complete JSON response equality passed. One observed pair took733ms/314ms; these are local fixture timings, not public-provider latency or a paper result. The unbound-policy comparison is retained separately. Batching uses the existing ethers behavior; [Alchemy documents HTTP JSON-RPC batch support](https://www.alchemy.com/docs/reference/batch-requests). This does not eliminate provider rate limits or establish the hosted latency root cause by itself.

Collapsed cancellation-refund panels were also polling every5seconds. They now fetch initially, stop periodic polling while closed, refresh immediately on opening, and poll while open. The real controls and actions remain. A production-build browser test with disclosed clock control verifies the closed/open/closed request counts, with no unexpected page errors. Its first run used an incorrect endpoint observer string; corrected only that fixture and retained the first failing log.

### Final affected verification

- Backend unit: **347passed**, including8new resource/ownership/deployment regressions. Before-fix resource regressions failed and are preserved.
- Production frontend: **18passed**, build and lint pass. The new polling test uses explicit API/wallet fixtures and browser clock control; other tests retain their original scope.
- Actual isolated stateful browser: concurrency1; main claims2; showcase4; bank/EFT2; cancellation/refund1; RPC outage/recovery1 — **11distinct affected scenarios passed**, excluding the repeated concurrency-only confirmation. Worker restart after mined commitment and shadow-report backfill also passed.
- Actual local Mongo: storage/recovery10, advisory integrity/concurrency4 and original-claim reconciliation1 — **15passed**. Financial settlement/restart/concurrent OTP/EFT integration: **9passed** on final relevant source.
- Protocol package check, ABI/configuration synchronization and final whitespace/diff review pass. Frozen model/Oracle/contract bytes are unchanged. Earlier100Oracle/151contract passes remain separately identified evidence, not rerun counts from this follow-up.

Evidence: `verification-results/read-latency-2026-11-07/`, especially `summary.json`, `policy-read-benchmark.json`, `read-transport-probe.json`, before/transport-only/final diagnostic directories, `affected-results.json`, `last-checks.json` and per-suite logs. The larger campaign inventory is now51distinct local browser scenarios passed,0remaining local failures, combining earlier unaffected passes with these affected reruns; it is not one universal same-revision rerun or proof of every possible interaction. All original failed attempts remain historical evidence.

### Remaining hosted gate and preservation

Review and publish the combined batch, then verify the actual deployed revision's multi-file uploads, flagged-review button, policy list/detail/refund loading and RPC outage/recovery. The earlier hosted wallet/refund browser failures remain FAILED/unverified until that retest, despite their separately passed real contract/API lifecycles. No contract deployment, model activation, role reassignment, new environment variable or migration is needed for default settings. Earlier v5 activation, claim3 sponsored appeal, claim4 original recovery and L1 measurements must not be repeated.

This follow-up made **no public transactions, hosted configuration changes, Atlas resets or Git publication**. It used only fresh guarded loopback databases/local chains and the preserved campaign Mongo container. Owned processes were stopped after checks; the campaign container was stopped and preserved. Other containers, saved credentials, manifests and checkpoints remain untouched. Real MetaMask/mailbox acceptance and the prior warning classification remain separate.

Combined staging commands below supersede the earlier smaller list; they are suggestions only:

```powershell
git add -- README.md backEnd/.env.example backEnd/controllers/policyController.js backEnd/middleware/claimSubmissionRateLimit.js backEnd/routes/documentRoutes.js
git add -- backEnd/services/contractService.js backEnd/services/contractQueryService.js backEnd/services/deploymentScopeService.js backEnd/services/issuedPolicyTermsService.js
git add -- backEnd/test/claimUploadRateBudget.test.js backEnd/test/rpcTransportDeadline.test.js backEnd/test/policyReadResources.test.js backEnd/test/issuedPolicyReadResources.test.js backEnd/test/indexedWalletReadResources.test.js
git add -- frontEnd/src/pages/AdminClaimDetailPage.jsx frontEnd/src/components/PolicyBenefitsPanel.jsx e2e/tests/frontend-production-quality.spec.js e2e/tests/shadow-concurrency.workflow.spec.js e2e/tests/showcase-coverage.spec.js scripts/stabilizationStack.js docs/comprehensive-acceptance-2026-11-07.md
git commit -m "Fix claim upload limits, manual review routing and policy RPC loading"
```

An optional Argon review should inspect this exact21-file diff, resource-lifetime changes, authority checks and failure dispositions without edits or deployment; return findings before merging. The next required external action is publication, followed by targeted hosted retesting, not more feature work.


## Earlier comprehensive campaign evidence (historical local-failure dispositions)

## Environment and preservation

Hosted frontend/API/Atlas/Pinata and Base84532, existing manager `0xBEc2a1B6215012cC7e59B0495F0d84c512003F96`, v5 model `0x5fe2760cc2306065c60287b80df97ca66ba1da54ce3647389672e9bc5ea58e4a`. Reviewed local baseline1f3f080; hosted Render merge459167d. Render reads only. Existing v5 activation, claim3 sponsored appeal and claim4 original-evidence recovery were already completed in a separate campaign and were not repeated.

Evidence is retained locally in `verification-results/hosted-comprehensive-2026-11-07/`: `COVERAGE.md`, `state.json`, transaction journal, receipts, sanitized browser diagnostics, per-suite logs and final report. Separate read-only hosted role sweep: `verification-results/hosted-acceptance-2026-11-07T10-25-24-447Z/report.json`. Fresh synthetic policy4 and campaign-owned claims/invoices are preserved. Original records, credentials, manifests, checkpoints and research artifacts remain intact.

Local integration tests use a new loopback Mongo container `block-insure-comprehensive-20261107-mongo` on27039 and uniquely named disposable databases. Maintained isolation scripts reset only those newly selected databases and local chains. Previous containers are untouched. Each test process started by this campaign was tracked and stopped. The campaign Mongo container was stopped and preserved; no existing container was deleted or recreated.

## Corrections

### Separate evidence uploads from claim authorizations

The actual hosted second two-file claim failed at its second upload withHTTP429. One authorization plus two uploads consumed three requests from the same five-request bucket; the second claim's last upload was the sixth request. A single maximum-five-file claim would likewise exceed that shared bucket.

`claimSubmissionRateLimit.js` retains five claim authorizations per15minutes and adds an independent25-upload resource budget per wallet and window. `documentRoutes.js` uses that upload limiter. This does not change the durable daily claim allowance, authentication, per-attempt ownership, file counts/slots/size limits, encryption or business rules. `CLAIM_DOCUMENT_UPLOAD_RATE_LIMIT` is optional; defaults require no dashboard change. The actual router regression verifies five authorizations plus five files per claim, then rejects excess authorization/upload requests and case-switched wallet replay. The hosted interrupted attempt later resumed through the supported UI with its existing primary file and authorization; no quota reset or evidence replacement.

### Bound stalled blockchain transport

A real Render log recorded GET`/api/claims/5` taking256559ms. Further claim/policy browser reads timed out, then a later single-context probe returned claim5 in5.6seconds, policy4 in4.2seconds and the policy list in8.7seconds. Root cause of that intermittent hosted latency remains unproven; a per-transport deadline is not an end-to-end API deadline across multiple sequential reads. Sampled backend CPU~0.05core/memory~123MB did not establish resource exhaustion; fast laptop RPC reads do not attest the private hosted provider's performance.

The backend provider previously inherited ethers' five-minute transport timeout. The local correction uses `FetchRequest` with a20second total deadline and at most three throttling attempts with500ms slots. Optional `BLOCKCHAIN_RPC_TIMEOUT_MS` accepts1000–60000ms. Actual loopbackHTTP/ethers tests exercise a stalled response, later recovery, persistent429 bounds and invalid settings. This is fail-closed transport hardening, not proof that the hosted slowdown is resolved. It preserves financial reconciliation and requires hosted verification after publication.

### Maintain current tests and failure diagnostics

The showcase suite expected the removed beneficiary/extra-benefit workflow. It now checks the retained cancellation-refund disclosure, accepted-terms download and refund navigation. No product functionality was removed or restored. A first edit used a Page where Playwright requires a Locator; that test-only error was corrected and its failing report retained.

The isolated stack now records child exit codes/signals and bounded sanitized diagnostic tails, making an unexpected connection reset investigable. Bearer values are redacted. No production logging/configuration change is included.

## Verified results so far

| Category | Result | Scope |
|---|---|---|
| Backend unit |339passed | Includes actual upload-router and transport regressions |
| Oracle unit |100passed | Frozen evaluator and operational compatibility/recovery |
| Contract suite |151passed | Explicit isolated Hardhat network; no public deployment |
| Mongo recovery |11passed | Real local Mongo, controlled provider/service faults |
| Settlement recovery |9passed on final transport source | Actual isolated chain/Mongo, concurrent OTP/EFT/receipt recovery |
| Production frontend |17passed; build/lint passed | Built UI, explicit synthetic API/RPC/wallet fixtures; four Admin state regressions |
| Hosted role sweep |Passed | Independent wallet roles, ordinary hospital logins, protected routing, essential320px layout |
| Hosted hospital API isolation |9passed | Cross-hospital read/write denied; source unchanged; anonymous/role denials |
| Hosted fresh purchase/evidence |Policy4, claims5/6/7 submitted | Real encrypted storage, transaction receipts and reconciliation |
| Hosted EFT |Two confirmed installments | Matched holder/bank statements, simulatedBDT backed by real testETH |

The full local stage inventory and failures/retries are in `local-resume.json` and the original campaign directory. Final distinct stateful browser inventory: **50 passed, one failed**, excluding repeated passes. The remaining failure is the concurrent advisory-read scenario. Six additional local chain/Mongo evidence-restart tests passed. Final helper startup/RPC recovery smoke passed after the last diagnostic-redaction edit. Earlier public/auth/role/profile/email passes preceded the narrow corrections; affected unit, production UI, contract, settlement and main claim/showcase checks were rerun. This is source-qualified coverage, not a claim that one final command reran every scenario.

### Flagged-claim Admin action

Actual hosted claims6/7 reachedFRAUD_FLAGGED under the existing high-frequency validation rules. Solidity permits their manual routing and the page computed that permission, but its action markup only rendered the button forORACLE_FAILED. The local correction renders the same authorized action for both states. A production-build regression failed before the change, then all17production tests passed, including permitted and forbidden statuses. API fixtures must have matching synthetic RPC reads; the first incomplete fixture hit a real local contract for syntheticclaim42 and its failure was preserved/corrected. The actual hosted button is still unfixed until publication.

To keep testing independent downstream behavior, claims6/7 were routed with the existing authorized Admin contract call and exact authenticated API confirmation. This alternate route retained all contract/API authority checks; it is not a hosted-button pass.

## Final hosted outcomes

- Fresh policy4 purchased with acknowledged terms; actual dual-worker v5 request7 on claim5 automatically verified. It pinned registry11. Saved worker receipts and request state distinguish this from clinical truth.
- Three claims each have sealed PDF+PNG evidence. The owner decrypted all six files and matched original bytes. A bank role was denied decryption. Assigned reviewers decrypted both files with the owner's browser closed.
- Claim7 finalized after exactly three approvals; claim6 finalized after exactly two rejections. Post-final voting and rejected withdrawal were denied.
- Claims5/7 correctly retained unfunded entitlements without permitting withdrawal. One0.00004testETH treasury funding operation allowed explicit activation; each owner withdrawal paid0.0000144testETH once. Both claims areSETTLED; claim6 isREJECTED.
- Two scheduled EFT payments settled installments2/3, each0.10simulatedBDT backed by0.000001testETH; holder and bank statements agree. Only the campaign mandate was cancelled; no ongoing test debit remains.
- The wallet-premium and refund **browser** journeys remained blocked by intermittent aggregate policy loading. Actual contract plus authenticated hosted API checks separately passed: reinstatement bought the quoted current scheduled interval, confirmation bound its exact transaction, replay failed, policy cancellation/refund request used four actually paid premiums, Admin approval/allocation confirmed, and the owner withdrew0.000002testETH from the separate existing benefits reserve. Cancelled-policy premiums and repeated refund withdrawal were denied. Policy4 isCANCELLED, refundrequest2ALLOCATED/withdrawn; no pending benefit credit remains.
- Earlier claims1–4 remainSETTLED with original document commitments and versions read back; no old claim/appeal/recovery transaction was repeated.

All23guarded transactions have successful receipts and no unresolved signed intent. Their maximum reserved allowance including transferred value was0.0002506918testETH against the0.001direct allowance; this is **not actual gas spent**. Worker, EFT, publisher and anchor transactions are separate. `summary.json` preserves selected gas/execution-fee fields without conflating them with total Base fees. No new paper measurements are asserted.

## Remaining failures and disposition

| Priority | Finding | Current disposition / next bounded action |
|---|---|---|
| High | Hosted maximum-file uploads can consume the claim bucket | Local separate-budget fix and regression pass; publish then verify actual hosted multi-file behavior without changing durable claim limits. |
| High | Hosted flagged-claim manual-review button is hidden | Local visibility fix and before/after production regression pass; publish then verify through the actual button. Downstream contract/API flow already passed. |
| High operational | Intermittent hosted claim/policy requests exceed30seconds | One claim request took256.6seconds; final bounded probe saw claim timeout45seconds, singlepolicy19.6seconds, policylist30.7seconds. Transport bound is locally verified but does not prove latency root cause or resolution. Publish, retest individual/aggregate reads with few open role tabs, then inspect provider/indexer timing if it recurs. |
| Medium | Concurrent advisory API retrieval fails locally | Three preserved attempts producedECONNRESET or15secondtimeout. Persisted assessments show valid outputs and some context times~28–32seconds, while inference itself was milliseconds. Latest trace shows both initial concurrent advisory requests succeeded with HTTP200 in about9seconds; a later read while waiting for worker shadow agreement reset. Latest backend exit record shows shutdown during test cleanup, not a proven process crash. Parking idle role pages did not solve it; that experiment was removed. Do not weaken assertions, increase timeouts blindly, alter model behavior or declare this passed. Profile controller/context/RPC timing in a separate bounded follow-up. |

No new feature, contract refactor, retraining or new infrastructure is justified by this campaign. Scope remains completion-focused.

## Test-harness findings and interpretation

The first purported suspicious fixtures were actually stored asVALID because the harness navigated/closed before acknowledging its status updates. Request7 pinned registry11 and both live v5 workers correctly agreed on automatic verification. That failed negative expectation is a fixture defect, not evidence of model bypass. Later fixtures wait for the PATCH response, persisted status and publication before requests.

The first multi-claim Blob observer was installed twice in one context, double-counting the second claim's decrypted blobs. A single observer per context corrected the harness; exact PDF/PNG byte-hash assertions were retained. Earlier loading failures remain separate availability observations. Some artifact filenames from the first helper were reused before timestamped failure capture was enabled; chronological JSON outcomes and Render timing logs are retained.

## Limits and next gate

Wallet automation uses scoped injected providers with the user's existing testnet keys. It is actual signed on-chain execution, but it does not exercise MetaMask extension prompts, its sponsorship service or the unresolved site-classification warning. BDT banking remains simulated. Automated local mail tests use a provider stub; earlier user-confirmed real mailbox acceptance is historical, not a new automated inbox check. Local expiry/recovery scenarios disclose time travel, provider/storage stubs and fault injection.

No hosting publication, environment mutation, contract deployment/change, model retraining/threshold change or Git staging/commit/push occurred. Review and publish only the scoped correction batch, then verify hosted upload limits, bounded RPC failure/recovery and remaining affected workflows. Do not rerun the completed v5 activation, earlier sponsored appeal, original claim4 recovery or L1 measurements.


## Publication and final review

The scoped correction batch is prepared for review; the complete hosted application is **not ready for an all-green completion declaration**. Review confirmed operation/state binding and the UI visibility condition, resource budgets, provider timeout behavior and final source hashes. Contract ABIs, frozen models and protocol identity remain unchanged. No deployment configuration edit or migration is required for default settings.

Suggested commands, not executed by the agent:

```powershell
git add -- README.md backEnd/.env.example backEnd/middleware/claimSubmissionRateLimit.js backEnd/routes/documentRoutes.js backEnd/services/contractService.js
git add -- backEnd/test/claimUploadRateBudget.test.js backEnd/test/rpcTransportDeadline.test.js frontEnd/src/pages/AdminClaimDetailPage.jsx
git add -- e2e/tests/frontend-production-quality.spec.js e2e/tests/showcase-coverage.spec.js scripts/stabilizationStack.js docs/comprehensive-acceptance-2026-11-07.md
git commit -m "Correct evidence upload limits and flagged claim routing; bound RPC waits"
```

Context/evidence are intentionally ignored. No `.gitignore` change is needed. Publish the reviewed batch through the user's usual workflow, then return when the API and Vercel show the expected revision for hosted retesting. Do not repeat blockchain deployments, roles, v5 activation, earlier claim3 appeal or original claim4 recovery. An optional Argon review should inspect this exact diff and failure dispositions, with no edits or deployment; bring its findings back before publication.

Remaining private acceptance is one real MetaMask/mailbox walkthrough; retain earlier confirmed mailbox evidence as historical. The site-classification review remains external and was not resolved by injected-wallet tests. Raw local Playwright traces contain ephemeral test sessions and should not be published; use the sanitized summaries for sharing.


## Reproduction and evidence commands

Commands below identify the executed check families. Integration/browser runs require a freshly named loopback-only database, a local Hardhat deployment and the maintained isolated runner. Do not point these commands at Atlas, hosted RPCs or saved public signers.

```powershell
npm --prefix backEnd run test:unit
npm --prefix oracle test
npm --prefix contracts test -- --network hardhat
npm --prefix frontEnd run lint
npm run test:e2e:frontend-production
node scripts/packageProtocolModel.js --check
npm run verify:sync
python -X utf8 reference/sync_project_context.py --check
```

Local Mongo recovery used `node --test backEnd/test/stabilizationStorage.integration.js` with an explicitly disposable loopback database. Settlement and evidence/restart used `scripts/runStabilizationE2E.js` with `PHASE_ONE_SETTLEMENT_ONLY=true` and `PHASE_TWO_RECOVERY_ONLY=true`, respectively. The browser stage list and exact selected specs are saved in `local-resume.json`; completed groups are not rerun to manufacture higher totals. Chromium executable: `E:/coding projects/Playwright/ms-playwright/chromium-1243/chrome-win64/chrome.exe`. Local services used chain31337, API5000, frontend5173, workers5101/5102, storage stub5055 and task Mongo27039. Provider-outage tests routed only through the loopback RPC proxy18545. Public application tests used Base84532 and the existing live origins identified above.

The remaining advisory/shadow failure should be reproduced separately with `e2e/tests/shadow-concurrency.workflow.spec.js` under that isolated runner, preserving the existing assertions. Do not rerun the public helper scripts: their final transactions are already confirmed and source state has advanced.

## Remaining private walkthrough after publication and targeted retest

1. Open the API and both workers' `/health/ready` links from the demonstration-links context. Wait for fresh ready responses and measured near-head worker progress before creating a timed request; an old screenshot or a successful landing page is insufficient.
2. Use Base Sepolia84532 and separate browser profiles for the existing holder, Admin, bank and reviewers. Hospital staff use their ordinary staff login. Check the actual domain, account and proposed signature/action. The prior wallet classification warning remains unresolved; injected automation does not clear it.
3. In the holder profile, confirm the current verified email and restore the existing encrypted evidence identity if the browser lacks it. Check one actual mailbox delivery/code in the application; do not paste its code/signature into chat.
4. Policy4 is now CANCELLED and claims5/7 are already SETTLED; do not reuse them as fresh live mutations. Prepare one new synthetic invoice/policy/claim only for the user's chosen walkthrough, with current dates and intended identifiers. Existing demonstration guides contain historical dates/IDs; adapt those fields instead of resetting history.
5. Confirm the actual hosted upload and flagged-manual-review controls after this batch is published. Test wallet premium/refund through the real interface after loading is healthy; contract/API fallback results do not replace this acceptance.
6. Inspect encrypted evidence as owner and an assigned reviewer, then follow the applicable approval/withdrawal path and verify its explorer receipt. Avoid repeated claims/purchases/funding solely because the UI is slow; first read chain/application state.

No new public deployment, contract migration, account setup, model package, payment method or paid service is required to publish the scoped fixes. Final completion remains gated on the documented failure dispositions and hosted retest.
