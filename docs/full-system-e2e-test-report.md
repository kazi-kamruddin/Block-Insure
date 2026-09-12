# Block-Insure Full-System QA Report

Status: **PASS WITH RISKS** — the complete clean-state integrated Playwright campaign passed 30/30 in headed Chromium against disposable Docker MongoDB and a loopback Pinata-compatible service; the production-preview suite passed 5/5, and the final repository-wide verification passed. No executed test remains failing. Risks remain where requested scenarios are proved below the browser layer or still need deeper manual security review.

## Environment and source

- Date: 2026-09-11 through 2026-09-12 (Asia/Dhaka)
- Commit: `e4498b107ffa6df4f948844531e7fcf64f1c2be1` on `postPreDefence`
- Initial working tree: one pre-existing untracked `tmp/` directory
- Runtime URLs: frontend `http://localhost:5173`, API `http://localhost:5000`, RPC `http://127.0.0.1:8545`
- Configured and observed local chain ID: `31337`
- Database isolation was proved twice. The first campaign used the Atlas host (redacted) with the dedicated `block_insure_e2e` database; the existing Atlas `block_insure` database remained at 10,079 documents. The final clean run used disposable `mongo:8.0` in Docker, exposed only as `127.0.0.1:27018`, with no host volume and database `block_insure_e2e`.
- External evidence storage was removed from the final run: a loopback Pinata-compatible simulator at `http://127.0.0.1:5055` accepted only the two small synthetic encrypted evidence files.
- Wallet safety: every User, Admin, Bank, Hospital, Auditor, and Oracle actor was derived from Hardhat's published default development mnemonic and used only on the loopback chain
- Node 24.16.0, npm 10.2.5, Playwright 1.62.1, Hardhat 2.29.0, solidity-coverage 0.8.17, Docker Engine 29.7.2 / Desktop 4.90.0, MongoDB 8.0 container, Slither 0.11.6 in a temporary local virtual environment
- Deployed local manager `0x8A791620dd6260079BF849Dc5567aDC3F2FdC318`, coordinator `0x8aCd85898458400f7Db866d53FCFF6f0D49741FF`, adjudicator `0x0B306BF915C4d645ff596e518fAf3F9669b97016`, economics `0xe082b26cEf079a095147F35c9647eC97c2401B83`, evidence registry `0x9A9f2CCfdE556A7E9Ff0848998Aa4a0CFD8863AE`, hospital registry `0x610178dA211FEF7D417bC0e6FeD39F05609AD788`, bank registry `0xA51c1fc2f0D1a1b8494Ed1FE312d7C3a78Ed91C0`, and benefits manager `0x3Aa5ebB10DC797CAC828524e59A333d0A371443c`

## Requirements-to-test matrix

The matrix was derived from `README.md`, `e2e/README.md`, `frontEnd/src/App.jsx`, Express routes/middleware/controllers, Solidity contracts and tests, oracle protocol/tests, and the verification/release scripts. `Contract` means an isolated Hardhat test; `API unit` means a controller/service/middleware test without a live database; `Browser` means Playwright against the integrated stack.

Final-result interpretation: the 30 integrated scenarios and five production-preview scenarios passed at their stated layers. Rows whose requested negative/boundary variants are proved only by contract or API tests remain identified as coverage risks rather than being inferred as live-browser proof. The exact per-suite disposition is in `verification-results/full-system-e2e-summary.json`.

| Actor / role | Feature or mechanism | Preconditions | Happy path | Negative / boundary cases | Expected frontend result | Expected API result | Expected database effect | Expected on-chain effect / event | Existing automated coverage | Missing coverage at baseline | Final result |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Guest | Landing, login alias, catalog, detail, 404 | Frontend/API available | All public routes render | Unknown package/route; API 5xx; console errors | Correct heading or not-found view | Public reads return 2xx/4xx, never unexpected 5xx | None | None | `public-smoke`, `route-inventory` | Production preview, responsive/focus checks | See results |
| All roles | Route inventory and refresh | Valid SIWE session | Every declared workspace route loads directly | Foreign workspace, missing session, refresh | Owner workspace; foreign routes redirect | Protected reads accept only valid bearer | None for reads | Role verified for privileged sessions | `route-inventory`, `role-workspaces` | Dynamic-route refresh and stale session browser cases | See results |
| User/Admin/Bank/Hospital/4 Auditors | SIWE login/session | Local wallet, nonce, chain 31337 | Nonce, signature, role workspace | Replay, bad signature, wallet/chain/origin mismatch, expiry, logout | Correct role; failures remain signed out | 200 on valid; 400/401 on malformed/replayed | Nonce consumed; revoked JTI stored on logout | Privileged roles rechecked on-chain | Browser login for 8 actors; backend SIWE replay/origin/revocation tests | Full browser negative matrix | See results |
| Any authenticated role | Backend authorization | Valid or missing bearer | Own-role endpoints succeed | Missing/expired token, cross-role and basic IDOR | No privileged UI/data | 401/403, no internal detail | No mutation | No transaction | Route middleware plus source/unit checks | Live endpoint cross-role matrix | See results |
| User | Policy browse/eligibility/pricing | Active package | View package terms and simulations | Invalid package, exclusions, waiting/date boundaries | Explainable eligibility/pricing | Deterministic public quote/preview | None | Immutable package/rule reads | Browser showcase; policy-rule unit; contract tests | Browser validation/error states | See results |
| User | Policy purchase | Active package, exact premium | Purchase and display policy | Wrong value, inactive/missing package, paused, duplicates as allowed | Success and policy card | Acceptance persisted and indexed | Terms acceptance/user metadata | `PolicyPurchased`; premium/reserve balance | Workflow browser + 12 purchase contract tests | Live DB/event receipt reconciliation detail | See results |
| User | Policy lifecycle | Owned policy | Details, status, certificates, history | Non-holder, expiry, lapse, cancel/reinstate | Accurate status/actions | Scoped policy/payment reads | Ledger/acceptance records | Status/premium events | Showcase + premium lifecycle contract tests | More browser boundary actions | See results |
| User/Bank | EFT mandate create/approve | User account, Bank identity | Create and approve mandate | Wrong bank/role, duplicate/invalid state/concurrent action | Both workspaces reconcile | Scoped mutation succeeds once | Mandate state/audit/notification | Bank registry identity/payment anchor when executed | `bank-eft.workflow`; backend/contract tests | Live concurrent request race | See results |
| User/Bank | Mandate reject/cancel/replace | Pending or approved mandate | Reject, replace, cancel | Repeated/foreign mutation | Current status shown | Idempotent or 4xx conflict | Status/history retained | No invalid premium event | `bank-eft.workflow` | API replay matrix | See results |
| User/Bank | Quarterly EFT | Approved due mandate, balance | Automatic debit/premium | Insufficient balance, duplicate run, not due | Paid ledger and notification | One confirmed transaction | Balance/transaction/next retry updated | `PremiumPaid`/bank transfer reference | Workflow + backend + registry contract tests | Restart/recovery and contention live tests | See results |
| User/Bank | Manual OTP payment | Active policy/account | Request and confirm OTP | Wrong, expired, reused OTP; double submit/rate limit | Error or one confirmed payment | 4xx for invalid/replay; one success | Challenge consumed; one ledger entry | One premium event | Workflow covers wrong/success; backend foundations | Expiry/reuse/concurrency browser checks | See results |
| User/Hospital | Claim submission/attestation | Active covered policy, synthetic encrypted file | Valid claim and hospital match | Fields, amount/date/type/size/hospital/duplicate/ownership | Claim created or precise validation | Validated upload/claim response | Attempt/document/verification records | `ClaimSubmitted`, `DocumentAdded`, attestation | Workflow; claim/hospital service and contract tests | Full browser upload boundary matrix | See results |
| Oracles | Health/identity/API key | Two configured workers and committed registry | Both distinct workers heartbeat | Missing/invalid API key; shared/revoked identity | Admin sees healthy independent workers | Protected heartbeat/log endpoints | Health/log records without PHI | Authorized oracle set/snapshot | Preflight, oracle unit, contract tests | Live worker key rejection and restart | See results |
| Oracles | Exact quorum approval | Two matching valid results | Commit/reveal exact result | Single response, duplicate, delay, wrong salt/model/root | Approved/allocation visible | Limited result logs | Two oracle logs | Request snapshot; approval/allocation events | Workflow + 14 coordinator contract cases | Live delayed/single-worker browser campaign | See results |
| Oracles/Admin | Failure/timeout routing | Failed/stalled request | Route to manual review | Before SLA by unprivileged caller; repeated routing | Manual-review state shown | Safe request/routing response | Audit/notification updates | `OracleTimedOut`, `ClaimSentToManualReview` | Workflow + automatic-adjudication tests | Live SLA timeout duration | See results |
| Admin | Dashboard/health/research/audit | Admin SIWE | All pages and metrics render | Other roles/direct URL | Admin-only navigation/content | Admin endpoints 200 only for Admin | Read-only except audited actions | Read-only state | Route/showcase tests | Error/empty/loading views | See results |
| Admin | Package lifecycle | Admin SIWE | Create/update/deactivate/reactivate | Invalid values, non-admin, repeat/concurrency | Valid states and messages | Validated/admin-only writes | Acceptance/audit metadata as applicable | Package events | Showcase create; 7 contract cases | Browser update/deactivate/reactivate validation | See results |
| Admin | Protocol limits | Reviewable claim | Request processing/manual route/fund | Direct approve/reject/settle/close/appeal vote forbidden | No forbidden controls | No forbidden endpoints | Audit permitted operations only | ABI omits admin adjudication | Showcase + ABI and contract tests | Live endpoint enumeration | See results |
| Admin | Benefits administration | Benefits module funded | Publish/fund/process requests | Non-admin, bad version/hash/value | Correct schedule/funding state | Admin-only mutation | Audit/notification | Benefit schedule/funding events | Showcase view + 13 benefits contract tests | Browser state-changing benefits campaign | See results |
| 4 Auditors | Login/registry/reputation | Four active role holders | Each authenticates; roster has four | Wrong role/revoked role | Auditor workspace only | Scoped reads | No mutation | On-chain role checked | Role workspace + showcase | Browser revoked-session case | See results |
| Assigned Auditor | Evidence authorization/decryption | Manual review snapshot, owner grant | PRE transform and browser decrypt | Before grant, outsider, revoked/rotated key, tamper | Evidence available only after grant | Never returns raw AES/plaintext | Capsule/grant/access log only | Evidence commitment unchanged | PRE/AES backend tests; workflow vote | End-to-end owner grant/decrypt browser flow | See results |
| Assigned Auditors | Voting and quorum | Exactly four snapshotted | Three approvals allocate | Two rejects; duplicate/non-assigned/post-final; conflict/concurrency; expiry | One final state | Vote accepted once or 4xx | Vote/finalization/reputation records | Vote/decision/allocation events | Workflow (3 approvals) + contract/invariant tests | Live two-reject/expiry/concurrent browser paths | See results |
| Auditor | History/export/integrity | Existing claim/evidence | Timeline/export/hash verify | Mismatched/tampered file | Valid or tamper warning | Scoped history/receipt | Access log | Indexed events/commitments reconciled | Showcase and evidence tests | Successful decrypt+matching file browser check | See results |
| Hospital | Dashboard/own records/invoices | Contracted hospital | Read/update/restore own record | Another hospital/role, invalid state/payload | Own data only | HOSPITAL and provider scope enforced | Own record changes then restored | Merkle root republished by authorized flow | Role + maintenance browser; service/contract tests | Live cross-hospital mutation attempts | See results |
| Hospital/Oracle | Attestation/Merkle proof | Matching registry snapshots | Valid attestation/proof | Missing/mismatched/tampered record/path | Verification result propagates | Minimal commitment, no diagnosis/PHI | Verification record | Registry version/root and attestation | Maintenance/showcase + service/oracle/contract tests | Live worker disagreement | See results |
| Claimant | Funded payout withdrawal | Allocated claim | Claimant withdraws once; settled | Outsider, double withdrawal, paused, reverting recipient | `SETTLED`, no repeat control | Indexed/scoped state reflects settlement | Notification/audit/index | `SettlementWithdrawn`, `ClaimSettled` | Both workflows + contract/invariant tests | Live outsider API/browser attempt | See results |
| Admin/Claimant | Underfunded allocation activation | Valid approved claim, insufficient reserve | Admin funds; anyone activates; claimant withdraws | Premature activation, insufficient funding, repeat | Funding-required then ready/settled | Reconciled status | Notifications/index | funding-required/funded/withdraw events | Contract tests | Browser journey | See results |
| User | Appeal | Rejected owned claim | Evidence appeal opens next version | Non-owner, repeat, invalid state/evidence | Appeal history/version shown | Owner-only validated mutation | Appeal/document/access history | appeal/reopen/request events | Contract tests and claim UI support | Full browser/API appeal journey | See results |
| User/Beneficiary/Admin | Beneficiary, death, surrender, maturity | Terms bound, eligible policy | Designate/request/approve/withdraw | Shares !=100, non-beneficiary, waiting/cancel/expiry/funding/replay | Accurate eligibility/status | Scoped benefits responses | Terms/request metadata | Benefits reserve/allocation/withdraw events | 13 contract tests; UI pages/showcase reads | End-to-end state-changing browser paths | See results |
| System | Cross-system reconciliation | Representative completed journeys | UI/API/DB/storage/receipt/events/logs/CID/hash agree | Missing/duplicate/divergent evidence | No success-only false positive | Canonical IDs/amounts | Single consistent records | Exact events/storage/balances | Workflows assert UI + selected API/on-chain results | Complete DB/log/event evidence bundle | See results |
| System | Headers/CORS/error leakage | Backend running | Local allowed origin and security headers | Foreign origin, unsupported method, malformed JSON/XSS | Safe generic failure | Helmet/CORS/404/4xx/5xx policy | None | None | Runtime-config tests, Helmet/CORS implementation | Live HTTP assertions | See results |
| System | Rate limits/replay/idempotency | Backend running | Normal request rate | Claim/login/nonce/OTP bursts and duplicate mutations | Actionable retry error | 429/4xx and one mutation | No duplicate records | No duplicate events | Limiter config + invariants | Live rate-limit campaign | See results |
| System | Resilience/recovery | Local disposable stack | Restart and resume workers/backend | Mongo/RPC/Pinata/one-oracle unavailable | Graceful errors/no runaway retry | Health reflects dependency state | Cursors/idempotency preserved | No duplicate events | Cursor, launcher, atomic-write tests | Live fault injection | See results |
| System | Accessibility/responsive/browser | Production frontend build | Keyboard/mobile/tablet/laptop/desktop render | Focus/labels/overflow/console/request failures | Basic WCAG and usable layout | N/A | None | None | Semantic markup and route smoke | Dedicated production-preview checks | See results |
| System | Performance/load/flakiness | Local synthetic volume | Key pages/APIs and claims within recorded bounds | Retry/polling/leak/duplicate stress | Responsive UI | Stable latency/throughput | Cleanup/isolation | Deterministic events | Research benchmark and serial E2E design | Live measurements and reruns | See results |
| Repository | Sync/build/release/secrets | Installed workspaces | ABI/address/artifact/template consistency | Stale/instrumented artifacts; tracked secrets | Production assets build | N/A | No secret artifacts | Bytecode below EIP-170 | `verify:*`, release check | Order-independent coverage; redacted scan | See results |

## Architecture and role coverage summary

The application declares public routes plus five isolated workspaces: Policyholder, Administrator, Auditor, Hospital, and Bank. Oracle workers have no browser workspace. The route inventory contains all static workspace routes; state-dependent tests contain the user/admin claim-detail and auditor history/vote routes. There are 30 integrated Playwright tests across nine files after this campaign, plus five independent production-preview tests.

The contract system is split across `InsuranceManager`, `OracleCoordinator`, `ClaimAdjudicator`, `PolicyEconomics`, `EvidenceRegistry`, `PolicyBenefitsManager`, `HospitalVerificationRegistry`, `BankIdentityRegistry`, and the deployment registry. The 133-test Hardhat suite proves role controls, policy and premium states, claim validation, hospital attestation, exact two-oracle commit/reveal consensus, four-auditor snapshots, 3-approval and 2-rejection finality, timeouts, appeals, reserve constraints, funding-required activation, pull payments, duplicate/replay rejection, beneficiary/death/surrender/maturity flows, and state-machine invariants.

The backend suite covers fraud/triage rules, SIWE replay/origin/on-chain-role checks, evidence AES-GCM/PRE/Merkle mechanics, registry scoping foundations, bank state, deployment hardening, pagination, indexer replay/reorg handling, reserve calculations, and the new middleware regressions. The oracle suite covers cursor isolation, proof reconstruction/tampering, model binding, canonical results, and independent commitments.

Integrated authentication passed for User, Admin, Bank, Hospital, and all four Auditors. Two distinct live Oracle workers passed preflight, heartbeat, commit/reveal, exact-quorum approval, conservative failure, and manual-review routing through the browser-driven workflows.

## Commands executed and evidence

| Command | Result | Evidence / totals |
|---|---|---|
| `npm run preflight` | PASS | Required environment files/keys present (values not printed) |
| `npm --prefix backEnd run validate:hybrid` | PASS | 5,000 runtime records; 4,995 hybrid; 5 presets; Merkle status VALID |
| Fresh local Hardhat node plus read-only RPC checks | PASS | Loopback RPC; observed chain ID 31337; 20 unlocked local accounts |
| `npm run verify:all` (baseline) | PASS | 132 contract, 91 backend, 13 oracle; lint/build/repository pass |
| `npm --prefix contracts run coverage` (baseline) | PASS with defect found | 131 pass, 1 instrumentation skip; 95.22/64.76/92.18/95.51 percent statement/branch/function/line coverage |
| `npm run verify:sync` immediately after baseline coverage | FAIL, diagnosed | Instrumented artifacts falsely exceeded EIP-170; normal compile made the check pass |
| `npm --prefix contracts run test:stateful` | PASS | 4/4 invariants |
| `npm --prefix contracts run test:mutations` | PASS | 8/8 valid mutants killed; no survivor/timeout/infrastructure error |
| `npm run release:check:template` | PASS | Release template and files complete |
| Temporary local Slither 0.11.6 campaign | PASS with review findings | Baseline 100 findings; zero-address defect fixed; final 99 findings (4 high, 23 medium, 63 low, 7 informational, 2 optimization) retained for manual triage |
| Focused backend regression run | PASS | 23/23 selected security/hardening tests |
| `npm run test:e2e:frontend-production` (first unrestricted run) | FAIL, fixed | 4 pass/1 fail: 404 page lacked an `h1`; failure artifacts were generated, then replaced by the clean rerun |
| `npm run test:e2e:frontend-production` (rerun) | PASS | 5/5 Chromium tests; HTML report retained |
| `npm run dev:e2e-isolated` | PASS after one environment retry | Fresh chain ID 31337; `block_insure_e2e` reset/seeded; all role grants, reserve, Merkle root, backend, frontend, and both workers healthy |
| `node scripts/runIsolatedE2E.js preflight:e2e` | PASS | Admin, User, Bank, Hospital, 4 Auditors, 2 Oracles, URLs, chain, claim controls, and evidence configuration verified |
| Disposable Docker MongoDB plus local Pinata simulator | PASS | Mongo bound only to `127.0.0.1:27018`; Pinata simulator bound only to `127.0.0.1:5055`; no volume or external request |
| Live Mongo pause/unpause/restart injection | PASS | Readiness changed 200 connected → 503 disconnected → 200 connected; frontend remained 200; backend recovered after container restart |
| `npm run test:e2e:isolated:all` | PASS | 30/30 headed Chromium tests: general 17, workflow 4, showcase 4, maintenance 1, resilience 4 |
| `npm run test:e2e` | PASS | 17/17; 112.909 s wrapper duration; public, SIWE/session, every actor, role guards, every declared top-level route |
| `npm run test:e2e:workflow` | PASS | 4/4; 117.735 s wrapper duration; banking, encrypted evidence, automatic Oracle approval, manual Auditor review, withdrawal |
| `npm run test:e2e:showcase` | PASS | 4/4; 47.945 s wrapper duration; populated dashboards, histories, exports, integrity, health, reputation |
| `npm run test:e2e:maintenance` | PASS | 1/1; 14.240 s wrapper duration; scoped hospital mutation, restoration, and root match |
| `npm run test:e2e:resilience` | PASS | 4/4; 5.195 s wrapper duration; live headers/CORS, malformed JSON, unsupported method, Oracle key rejection, sustained nonce rate limit |
| `npm run test:e2e:frontend-production` (final headed run) | PASS | 5/5; production build plus four responsive viewports and basic accessibility |
| Docker-local post-run state capture | PASS | 10,228 synthetic documents, 4 policies, 2 claims, 2 settlements/withdrawals, 4 Oracle commitments/reveals, 3 Auditor votes, and 2 encrypted local evidence uploads |
| `npx playwright test --config playwright.frontend.config.js --list` | PASS | 5 production-preview tests |
| Redacted tracked/generated-artifact credential scan | PASS with review notes | No credential-shaped candidate in Playwright artifacts; source candidates were environment references, hashes, or explicit test/example fixtures |
| `npm --prefix backEnd run research:manifest` then `npm run verify:repository` | PASS | Reconciled the mutation campaign's regenerated timestamp/hash |
| Final `npm --prefix contracts run coverage` then `npm run verify:sync` | PASS | 132 pass/1 instrumentation skip; 95.23/64.83/92.18/95.52 percent; normal artifacts restored; manager 24,361/24,576 bytes |
| Final `npm run verify:full` | PASS | 8/8 aggregate tasks; 133 contract, 104 backend, 13 Oracle, lint, build, repository, dataset, synchronization |

Unique executed tests were 285 standard tests (133 contract + 104 backend + 13 Oracle + 30 integrated Playwright + 5 production Playwright), plus eight killed mutation cases. Stateful and coverage executions repeat subsets and are not double-counted. The backend command also contains its separate Section 3 analytics harness.

Evidence:

- `verification-results/phase5-verification.json` — final aggregate and durations
- `contracts/coverage/index.html` — contract coverage
- `contracts/mutation-results.json` — mutation outcomes
- `playwright-report-frontend/index.html` — passing production-browser report
- `playwright-reports/general/index.html` — authentication, roles, and route report
- `playwright-reports/workflow/index.html` — state-changing bank/claim report
- `playwright-reports/showcase/index.html` — populated-system report
- `playwright-reports/maintenance/index.html` — hospital maintenance report
- `playwright-reports/resilience/index.html` — live HTTP defensive-controls report
- `verification-results/playwright-e2e-run-results.json` — suite durations and exit results
- `verification-results/e2e-post-run-state.json` — sanitized MongoDB/on-chain/event reconciliation
- `verification-results/docker-e2e-post-run-state.json` — final Docker-local MongoDB/on-chain/event reconciliation
- `verification-results/docker-resilience-results.json` — local dependency outage/recovery and Pinata evidence
- `verification-results/slither-results-final.json` — final Slither detector output after remediation
- `verification-results/full-system-e2e-summary.json` — machine-readable disposition

## Defects found and fixed

### BI-QA-001 — coverage contaminated deployment artifacts (Medium)

Reproduction: run `npm --prefix contracts run coverage`, then `npm run verify:sync`. Before the fix, synchronization read instrumented bytecode and reported manager/adjudicator/benefits sizes above EIP-170. A forced normal compile immediately restored 24,358/10,880/9,981-byte artifacts.

Fix: `contracts/scripts/runCoverage.js` always forces a normal compile after coverage, including when coverage fails. `contracts/package.json` now uses the wrapper, and `phase8OperationalHardening.test.js` guards the cleanup behavior. Verification: rerunning coverage followed directly by synchronization passes.

### BI-API-002 — malformed wallet nonce input became HTTP 500 (Medium)

Reproduction: request a nonce with a non-Ethereum wallet string. `ethers.getAddress` threw an unclassified error, so the global handler treated client input as a server fault and could expose development detail.

Fix: wallet normalization now emits a stable `400 Invalid wallet address`. The regression proves the invalid request never reaches MongoDB.

### BI-UI-003 — 404 page had no level-one heading (Low)

Reproduction: load an unknown production route and inspect the heading outline. The page began at `h2`.

Fix: `NotFoundPage` now uses `h1`. The production Playwright rerun proves one `h1`, one main landmark, primary navigation labeling, skip-link focus, visible focus styling, and no duplicate IDs.

### Security hardening — Oracle API key comparison

Oracle API-key middleware now uses equal-length `crypto.timingSafeEqual` comparison instead of ordinary string inequality. Tests cover absent server configuration, missing/invalid credentials, the dedicated header, and Bearer syntax.

### BI-QA-004 — interrupted Windows launcher left stale child services (Medium)

Reproduction: interrupt a nested `dev:e2e-isolated` PTY while its managed stack is running, then bootstrap again. Orphaned backend/oracle children can resume indexing/heartbeats and invalidate the next clean-state check; one retry also hit a Windows libuv handle assertion after deployment.

Fix/hardening: stale processes were identified by exact command line and stopped before retry. The isolated wrapper now derives all actors from Hardhat defaults, selects only `block_insure_e2e`, enables headed execution, and supports a narrow setup-resume command. The launcher redacts sensitive startup lines. A fully fresh rerun passed clean setup and all tests.

### BI-API-005 — rejected CORS origin surfaced as HTTP 500 (Medium)

Reproduction: send a live request with an untrusted `Origin`. The CORS callback created an unclassified error and the global handler returned 500, incorrectly representing a deliberate client rejection as a server fault.

Fix: the rejection carries HTTP 403 status, and the global handler honors both `statusCode` and `status`. The live resilience test proves the untrusted origin is now 403 while the configured loopback origin receives the expected CORS header.

### BI-IPFS-006 — evidence-provider failures were not deterministic or locally testable (Medium)

Reproduction: simulate a provider 5xx, timeout, or a nominally successful upload with no CID. The service was tied to the public Pinata URL and did not normalize every upstream failure into a stable gateway response.

Fix: `PINATA_API_BASE_URL` is configurable for local testing, insecure custom endpoints remain forbidden in production, timeouts return sanitized 504 responses, provider/invalid-CID failures return sanitized 502 responses, and unpin identifiers are URL-encoded. Four service regressions and the full encrypted-claim workflow passed against the loopback simulator, which retained exactly two synthetic encrypted uploads.

### BI-SOL-007 — bank registry accepted the zero address (Medium)

Reproduction: an Admin could call `configureBankPaymentRegistry(address(0))`. Slither reported `missing-zero-check`; a zero registry would disable the intended payment-registry boundary.

Fix: the contract now rejects the zero address and a Hardhat regression covers it. The final 133-test suite passed, Slither no longer reports `missing-zero-check`, and normal-bytecode synchronization still passes.

### Reset and local-dependency safety hardening

Direct reset execution now accepts loopback databases or explicitly disposable external names ending in `_e2e`, `_test`, `_testing`, `_dev`, or `_development`, and refuses an external unsuffixed `block_insure` target. The isolated launcher supports `E2E_MONGODB_URI` and can require a loopback host with `E2E_REQUIRE_LOCAL_MONGO=true`. This made the final campaign independent of Atlas and prevented any reset from reaching the original project database.

## Isolation and safety evidence

- All RPC reads and transactions used `http://127.0.0.1:8545`; preflight and post-capture both observed chain ID 31337.
- Frontend and backend were loopback-only at `http://localhost:5173` and `http://localhost:5000`.
- The final launcher used `mongodb://127.0.0.1:27018/block_insure_e2e` and enforced loopback MongoDB. The container had no persistent volume and was named exactly `block-insure-resilience-mongo` for targeted cleanup.
- The original `block_insure` inventory was 10,079 documents before testing and 10,079 after testing. No collection count changed.
- All ten privileged/non-privileged actor categories used publicly documented Hardhat development accounts. No live wallet or network was queried.
- Synthetic registry records and two small encrypted synthetic evidence files were used. The final workflow used only the local Pinata-compatible simulator; no external storage request was made.
- The Atlas `block_insure_e2e` evidence remains retained at 10,228 documents for inspection. The disposable Docker database independently reached the same 10,228-document deterministic state before its container was removed.
- Slither was installed only into a disposable workspace virtual environment, executed locally, and removed after its JSON output was retained. Full production release validation was not run because production was outside authorization; release-template validation passed.

## Accessibility, responsive, performance, and browser observations

The self-contained Vite production bundle passed Chromium at 360×800, 768×1024, 1366×768, and 1920×1080 with no horizontal overflow, page exceptions, console errors, failed same-origin assets, or 5xx responses. The final headed run recorded each responsive scenario at about 1.1–1.2 seconds and the navigation/accessibility scenario at 2.3 seconds. Login-alias refresh, 404 fallback, skip link, focus indicator, landmarks, accessible button names, and duplicate-ID checks passed. This is basic WCAG-oriented coverage, not a formal WCAG conformance audit. Firefox/WebKit were not configured or executed.

The final integrated suite completed in approximately 298 seconds across five ordered stages. In-test timings were 36.7 seconds for automatic Oracle settlement and 44.9 seconds for the manual Auditor path. The four live HTTP defense checks took 2.1 seconds, including 110 concurrent nonce requests that triggered the expected 429 limit. The 5,000-record registry integrity check passed. No dedicated long-duration memory-leak or high-volume live claim load test was run, so no memory-leak/throughput ceiling is claimed.

## Security observations

- Strong evidence: SIWE invalid signature, wrong wallet, wrong chain, nonce replay, logout/revoked bearer, missing bearer, guest direct navigation/refresh, all role logins, and cross-role route guards passed live or direct API browser tests. Origin binding and on-chain role revocation also pass unit tests.
- Strong evidence: AES-256-GCM tamper/AAD binding, PRE recipient isolation, identity rotation/revocation, Merkle inclusion/consistency, evidence-chain concurrency, and content-address substitution tests pass.
- Strong evidence: live encrypted evidence upload/CID/hash reconciliation, both Oracle identities, exact two-worker commit/reveal quorum, manual-review snapshot, three Auditor votes, claimant withdrawal, hospital scoping, and bank-role workflows passed. Contract duplicate/replay/finalization/withdrawal protections and reserve invariants pass, and all eight selected security/protocol mutants were killed.
- Live defensive evidence now covers Helmet security headers, allowed/untrusted CORS origins, unsupported methods, malformed JSON without path/secret leakage, missing/invalid Oracle API keys, and sustained nonce rate limiting.
- Live fault injection proved MongoDB readiness degradation and recovery through pause, unpause, and restart while the frontend remained available. Pinata 5xx, malformed-success, and timeout behavior is proved at the service boundary with a real local HTTP server.
- Slither completed with 99 review findings after the concrete zero-address issue was fixed: 4 high `arbitrary-send-eth` findings are authorized stored-recipient/Admin/beneficiary transfer flows; medium reentrancy findings concern trusted manager-created components and event ordering; timestamp/equality findings largely model explicit time/state-machine behavior. These were not suppressed, and the raw report remains for independent review.
- Review risk: `InsuranceManager` has only 215 bytes of EIP-170 headroom. Future features can make deployment fail; retain the size gate on every change.
- Still unverified live controls: stored-XSS persistence, upload count/size boundaries through the browser, JWT expiry by clock advancement, simultaneous vote/payment/withdrawal races, RPC outage recovery, and a live single-Oracle worker restart/disagreement campaign.
- The final redacted scan found zero credential-shaped candidate files in tracked source or retained QA artifacts. Environment files were excluded and no matched values or filenames were printed.

## Contradictions and configuration mismatches

- Documentation described clearing a “local Block-Insure” database while the normal URI used external Atlas. The isolated wrapper now accepts a disposable loopback URI and direct reset has an explicit local/test database allowlist.
- The saved privileged wallets may be custom, while deterministic tests require Hardhat defaults. The isolated wrapper now overrides every role only within spawned test processes.
- `test:e2e:workflow` previously depended on public Pinata. The configurable provider base URL and local simulator now make the complete encrypted-evidence workflow deterministic and local; production still requires HTTPS.
- Coverage instrumentation intentionally skips the deployment-size test. The new cleanup wrapper prevents this from contaminating later release checks, but the coverage run itself should not be cited as size evidence; normal compile/synchronization is the size evidence.

## Remaining gaps and exact reasons

The complete 30-test integrated campaign and five-test production suite were executed and passed. This proves route/role authentication, implemented critical cross-role journeys, live Oracle quorum/failure paths, encrypted evidence upload/integrity, bank/hospital mutations, representative cross-system reconciliation, core HTTP defenses, rate limiting, and Mongo outage/recovery. It does not mean every requested negative and resilience variant has browser automation.

Benefits have deep contract coverage and UI read coverage, but no end-to-end death/surrender/maturity state-changing browser journey exists. Other missing live browser cases include two-rejection and expired-review finality, funding-required activation, successful Recrypt owner grant/proxy transform/recipient decryption and access logging, OTP expiry/reuse/concurrency, another-hospital IDOR, simultaneous vote/payment/withdrawal races, live worker disagreement/restart, and RPC outage recovery. These remain explicit risks rather than failures observed in executed paths. Pinata failures are covered at the live service boundary rather than by breaking a browser workflow mid-upload.

## Exact full-campaign reproduction

In terminal A, start the isolated stack. This selects `block_insure_e2e`, derives every actor from Hardhat defaults, verifies chain ID 31337, and opens browser tests in headed mode:

```powershell
npm run dev:e2e-isolated
```

After readiness, in terminal B:

```powershell
npm --prefix contracts run test:mutations; if ($LASTEXITCODE) { exit $LASTEXITCODE }
npm --prefix backEnd run research:manifest; if ($LASTEXITCODE) { exit $LASTEXITCODE }
npm run verify:full; if ($LASTEXITCODE) { exit $LASTEXITCODE }
npm --prefix contracts run coverage; if ($LASTEXITCODE) { exit $LASTEXITCODE }
npm run verify:sync; if ($LASTEXITCODE) { exit $LASTEXITCODE }
npm --prefix contracts run test:stateful; if ($LASTEXITCODE) { exit $LASTEXITCODE }
npm run release:check:template; if ($LASTEXITCODE) { exit $LASTEXITCODE }
npm run test:e2e:frontend-production; if ($LASTEXITCODE) { exit $LASTEXITCODE }
npm run test:e2e:isolated:all; if ($LASTEXITCODE) { exit $LASTEXITCODE }
node scripts/runIsolatedE2E.js capture:e2e-state
```

For a fully disposable run, start `mongo:8.0` bound only to `127.0.0.1:27018` and `npm run dev:pinata-mock`, then set `E2E_MONGODB_URI=mongodb://127.0.0.1:27018/block_insure_e2e`, `E2E_REQUIRE_LOCAL_MONGO=true`, and `PINATA_API_BASE_URL=http://127.0.0.1:5055` for both launcher and tests. `test:e2e:isolated:all` must start from the clean hybrid state and includes general, workflow, showcase, maintenance, and resilience stages in order; resilience runs last because it intentionally exhausts the nonce limiter. Set `E2E_HEADED=false` only for headless CI. Stop the managed stack, Pinata simulator, and exact disposable Mongo container afterward.
