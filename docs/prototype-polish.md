# Thesis-prototype polish: items 1–9

Review date: 24 October 2026 (Asia/Dhaka). Base commit: `340c41f` plus this worktree. This is a bounded improvement pass, not a protocol redesign. No deployment, model promotion, live email send or Git commit is implied.

## Scope and decisions

| Item | Delivered behavior | Boundary |
| --- | --- | --- |
| 1. Evaluation | Validation-only cost/F1 thresholds; whole-score tie handling; union-of-rules review budgets; three sampling seeds; paired provider-cluster bootstrap intervals. | One retained source partition/scenario seed, not independent source replications. |
| 2. Historical context | Strictly earlier 14-day patient similarity and 30-day provider counts/bill ratios, with current/future/same-day exclusion and identity/diagnosis/amount checks. | Offline advisory ablation. Similar recurring care is not proof of duplication or fraud. |
| 3. Promotion | Explicit HOLD decision backed by the new study and unchanged active artifact hashes. | History is not an authenticated input in the deployed worker schema; no automatic weight/policy/data replacement. |
| 4. Evidence recovery | Profile status/restore controls, committed IndexedDB writes, same-wallet check and restored-public-identity validation. | Reuses the existing encrypted wallet-signature backup; no incompatible second backup format or automatic key rotation. |
| 5. Email | Brevo adapter, verified-profile recipient, durable resend limits, one-use bounded-attempt challenges, explicit email/simulation UI. | Real sends require backend configuration and a registered sender; mocked-provider tests are not mailbox-delivery evidence. |
| 6. Reads | Benefit-request snapshots; indexed confirmed premium events; bounded statement query; reorg/deployment isolation. | Policy-scoped three-benefit detail reads remain small direct reads. Existing raw event indexing remains authoritative input to projections. |
| 7. Daily chain | Persistence investigation completed; existing non-destructive launcher retained. | Hardhat remains in-memory. No disk persistence or state-only export is presented as complete recovery. |
| 8. Regression | Serial local tests and security checks recorded in the dated verification file. | Only actually executed layers count as fresh verification. |
| 9. Paper/provenance | Six-page working paper qualifies legacy routing claims and resolves gas provenance against the recorded Git revision, not current contracts. | Historical numbers were not silently regenerated, rebranded or substituted with a favorable sampling seed. |

## Reproduce the offline study

```powershell
$env:OBSERVABLE_DATASET_DIR='E:\4-1\4100 thesis\project\Block-Insure\docs\engineered\observable-2026-10-23T19-34-11-717Z'
npm --prefix backEnd run evaluate:prototype
```

The default retained dataset is the same directory if the variable is omitted. Six sequential runs use sampling seeds 11/29/47, each with history off/on, and a 768 MB JavaScript heap ceiling. Generated datasets and result artifacts stay under ignored `docs/engineered/observable-study-*`. The evaluated source checksums are recorded and checked again before each report is published. Repeated calls intentionally create a new output directory.

Each run samples 2,000 training and test rows. Probability calibration and operating-point selection are separate provider groups with shared patients purged. Score thresholds are selected only on the policy partition. Mandatory rules can exceed a requested budget: reports expose the mandatory rate and effective budget instead of hiding this. Uncertainty is a paired provider-cluster percentile bootstrap (500 repetitions), not a multiple-comparison-corrected superiority test. Cross-provider patient dependence and constructed scenario bias remain limitations.

Recorded study: `docs/engineered/observable-study-2026-10-24T03-30-53-042Z/study-summary.json`.

| Sampling seed | Rules-only test F1 | Continuous cost-selected F1, history off | History on |
| --- | ---: | ---: | ---: |
| 11 | 0.8159 | 0.8159 | 0.8159 |
| 29 | 0.8456 | 0.8456 | 0.8456 |
| 47 | 0.8331 | 0.8331 | 0.8331 |

These values use the 60% requested-budget cost-selected configuration. They are not a retrospective choice of the best test method: all cost/F1 configurations and 20/40/60% requested budgets remain in the reports. History did not justify promotion. Concealed compromise and unchanged advisory examples must not acquire invented answer-key features just to improve scores. Unmutated rows are controls, not independently adjudicated legitimate claims.

The earlier top-quantile LR baselines are retained for comparison, not treated as budget-matched operating points. Only the new `*_cost_budget_*` / `*_f1_budget_*` configurations apply the whole-score union-budget selector. A requested review percentage is not guaranteed to carry over unchanged to a shifted test distribution; both mandatory validation routes and observed test confusion counts must be inspected.

## Brevo configuration and walkthrough

Backend only, in an ignored local environment or Render secrets:

```dotenv
OTP_DELIVERY_MODE=brevo
BREVO_API_KEY=<secret configured privately>
BREVO_SENDER_EMAIL=<registered sender>
```

Keep a stable `BANK_OTP_SECRET`. Never use a `VITE_` prefix for secrets. Restart/redeploy only the backend when configuring it. No Oracle credential/configuration change is needed. No credentials are included in the repository.

1. Register/verify the sending address/domain in Brevo. Provider acceptance is not a guarantee of inbox delivery; do not promise a delivery time.
2. Save the recipient email in **My profile**. Request its verification code, enter the emailed code and confirm. This establishes mailbox access only, not legal identity.
3. Wait at least one minute after the last email request. In Banking, request a manual premium payment code; the recipient comes from the verified saved profile, not arbitrary request input.
4. Confirm with the emailed code. A transaction must still complete before a premium is marked paid.

Local defaults use `simulation`. `NODE_ENV=production` defaults to `disabled` until explicitly configured; simulation in production is rejected. Real email mode never returns `demoOtp`. A delivery failure invalidates the challenge and returns an actionable 503, without falling back to an on-screen code. An email accepted by Brevo is described as accepted, not delivered.

Email verification expires after five minutes, permits three incorrect attempts and is consumed atomically. It is bound to wallet, recipient and delivery mode; changing a profile email invalidates verification. A simulated challenge cannot verify a mailbox even if the delivery configuration later changes. Shared durable limits allow at most ten email requests per wallet/inbox in a 24-hour window, at least one minute apart, and 100 across the application. Limits consume quota even on provider failure. Existing authenticated endpoint limits remain as an additional guard; these application limits do not guarantee remaining quota on a shared Brevo account.

The implementation follows [Brevo's transactional API](https://developers.brevo.com/docs/send-a-transactional-email). General claim-status email subscriptions and SMS are not included in this OTP-focused pass.

## Evidence recovery

**My profile → Evidence access recovery → Check → Restore** uses the registered encrypted backup and the original wallet. It does not create an identity when recovery is requested, replace mismatched local keys, or rotate the registered identity. Both encryption and signing public keys must match before recovered private material is saved. IndexedDB writes resolve only after their transaction commits and close the connection afterward.

The recovery signature is a decryption capability: do not publish it. A wallet implementation must reproduce the same purpose-bound signature; this is not a claim of universal hardware-wallet/browser recovery. No private key or recovery-signature export is introduced.

## Projections and operation

Derived reads use `read:v2:<deployment identity>` so benefit backfill cannot accidentally reuse a cursor that predates benefit snapshots. Versions are retained for interrupted refresh/reorg recovery. Premium events are scoped by deployment, contract, policy, removal status and confirmed cursor, with a 10,000-record cap. Indexer/DB errors fail closed rather than starting a silent historical RPC scan. Ownership checks still precede statement reads. Per-policy benefit details remain at most three direct request reads.

Keep `npm run dev:chain` running while restarting `npm run dev`. A stopped Hardhat process loses its chain; ordinary launch must report stale deployment state, not reset MongoDB automatically. Anvil is not installed on the reviewed host. Its documented `--state`, `--state-interval` and `--preserve-historical-states` options are candidates, not a verified drop-in recovery solution. State, historical blocks/logs/receipts, deployment identity, cursors and MongoDB must agree after restart before adopting it. No new node/tool installation or environment was created for this investigation. See [official Anvil state options](https://foundry-rs.github.io/foundry/anvil/cmd/struct.NodeArgs.html).

## Research integrity and follow-up

The selected paper is a historical working manuscript, not a claim that current source reproduces old results. The old 100% routing result is explicitly qualified as predating observable-input hardening. The six new runs do not support replacing it with a claim of ML superiority. The separate provider-risk target and protocol correctness evidence must not be conflated with fraud ground truth.

Future work should follow evidence, not a feature-count target: independently rerun or replace the legacy routing study; define a prospective promotion gate; then evaluate continuous models/OOD/conformal methods only with justified inputs and calibration. Protocol extensions require their own scoped design and tests. Blind votes or plaintext digests must not be described as proving that a person inspected or understood evidence.

## Dependency review

The fresh production audit initially reported three affected backend packages and one affected Oracle package. Compatible updates were applied without `audit fix --force` or install scripts: Multer 2.5.0, body-parser 2.4.0 and follow-redirects 1.16.1; body-parser also advances its iconv-lite/qs patch dependencies. The Multer manifest floor is now ^2.5.0. The native Recrypt binding remains 0.11.1. Final `npm audit --omit=dev` reports zero known advisories separately for backend, frontend and Oracle. This is not a claim that every application vulnerability or development dependency has been audited away.

The reviewed advisories concern [compressed request parsing](https://github.com/advisories/GHSA-27r3-jxmh-p828), [upload teardown](https://github.com/advisories/GHSA-q7qp-rjg7-q26m) and [redirect credential handling](https://github.com/advisories/GHSA-q3jh-wrc6-jgq8). The audit identifies affected package versions, not proof that a specific exploit was demonstrated against this prototype. Unit/storage/worker checks and selected browser workflows are rerun after these dependency changes; earlier broad browser counts keep their original stage scope.

The temporary `/contracts/.mutation-workspace/` folder is now ignored. No tracked files existed there; generated source copies are removed by the mutation runner after its campaign. Existing historical mutation evidence is preserved; the fresh eight-mutant result is retained separately under ignored `tmp/prototype-mutations-2026-10-24.json`.

## Final verification: 24 October 2026

Machine record: [prototype-polish verification](../verification-results/prototype-polish-2026-10-24.json). It records final source/configuration fingerprints, active artifact hashes, exact scope and failures corrected along the way.

| Check | Observed result |
| --- | ---: |
| Backend plus section-3 analytics | 162 tests passed; analytics passed |
| Oracle | 19 tests passed |
| Actual-Mongo integration/recovery | 10 tests passed |
| Contracts, including four stateful cases | 139 passed |
| Selected contract mutations | 8/8 detected; no invalid/timeout/infrastructure cases |
| Distinct local browser cases across staged runs | 42 passed |
| Affected cases rerun after dependency updates | 10 distinct cases passed, plus repeated profile captures |
| Production frontend browser suite | 7 passed |
| Frontend lint/build | Passed |
| Repository / ABI/config synchronization | Seven check groups passed / passed |
| Existing hosted preview health | Passed, API limited and workers dormant |
| Paper build, six-page visual/layout/provenance checks | Passed; historical result qualifications retained |

This was not one uninterrupted 42-case run at a single final hash. The broad campaign stopped after 38 passing cases on a post-finality navigation timeout; focused continuation finished the remaining four. Original chain assertions were retained. Earlier RPC-provider destruction, guaranteed context cleanup and DOM-readiness navigation were added; the focused simultaneous-rejection rerun passed in 51.7 seconds. That does not independently prove the exact timing root cause or eliminate every possible flake. The initial duplicate React sibling-key warning was also corrected and its affected journeys rerun.

The final OTP guard uses conditional expiry updates so a stale reader cannot overwrite a concurrently USED challenge. Both the actual-Mongo race regression and the browser expiry/concurrency/replay journey pass. The mobile profile capture was inspected at 320px; all six rendered paper pages were inspected. Source hashes for the six-run study still match its recorded implementation.

Slither was unavailable in the existing environment, so no fresh static-analyzer result is claimed. Real email delivery was not attempted. No service was deployed or Git commit made. The local test stack was stopped, the pre-existing MongoDB container returned to its original stopped state, and no test ports remained listening. Atlas and normal saved environment files were not intentionally rewritten.

Delivering this code later affects the API/frontend and Oracle dependency lockfiles; use the normal repository redeployment workflow when authorized. Brevo credential configuration itself remains backend-only. The four `.project-context` files and one root reference context remain ignored local handoff material.
