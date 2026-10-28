# Block-Insure Playwright tests

These tests use Playwright's bundled Chromium and an in-process EIP-1193 wallet
bridge. They do not use Waterfox, Opera, MetaMask profiles, seed phrases, or a
Pinata browser login. Every signature and local transaction uses the private key
assigned to the selected test actor.

## What is covered

- Public landing page and backend health
- SIWE wallet login for User, Admin, Bank and all four Auditors; separate hospital staff login
- SIWE invalid-signature, wrong-wallet, wrong-chain, nonce-replay, logout, missing-token,
  and guest direct-navigation rejection
- Role-specific navigation and cross-role redirect protection
- Every top-level public and authenticated application route, with browser-error and
  HTTP 5xx monitoring
- Every role's top-level routes at 1366px and 320px, with retained route screenshots
- Admin role synchronization and policy-package pages
- Auditor registry, voting queue, and document-verification pages
- Hospital dashboard, scoped staff record/invoice maintenance with persistence, automatic publication,
  and restored Merkle-root verification
- Bank dashboard, mandate approval/rejection, automatic quarterly EFT, manual OTP
  rejection/success, and policyholder cancellation
- State-changing registered-claim workflow: policy purchase, browser encryption,
  evidence reconciliation, two-oracle approval, payout allocation, and withdrawal
- State-changing exception workflow: oracle failure, Admin routing, three assigned
  Auditor approvals, payout allocation, and withdrawal
- Focused benefit lifecycles: death beneficiary, surrender after six installments,
  maturity, allocation, withdrawal, and replay prevention
- Focused defensive boundaries: expired JWT, cross-hospital IDOR, OTP expiry,
  concurrent confirmation, and replay
- Full Recrypt evidence lifecycle: Auditor identity, owner grant, proxy transform,
  exact decrypted-byte/hash verification, access logging, and revocation
- Opt-in Brevo-mode profile verification and premium payment through a local
  provider stub, including hidden codes, wrong-code rejection, single use,
  the shared resend limit, verified-email invalidation and delivery failure
- Manual-review finality: concurrent rejection submissions and expired-review timeout

The Oracle workers are not controlled through browser pages. The E2E preflight
validates both Oracle wallets and the running workers process claims in the same
way they do during manual testing.

## Commands

Start the Hardhat node, backend, frontend, and both Oracle workers first. Then:

```powershell
cd "E:\4-1\4100 thesis\project\Block-Insure"

npm run preflight:e2e
npm run test:e2e
```

`test:e2e` is the repeatable, read-only suite. To watch it:

```powershell
npm run test:e2e:headed
```

After a clean `setup:hybrid`, the complete ordered regression can be run with:

```powershell
npm run test:e2e:all
```

To keep the normal `block_insure` database and saved role configuration
untouched, start the stack against the dedicated `block_insure_e2e` database
with local Hardhat-derived actors, then run the isolated campaign in a second
terminal:

```powershell
npm run dev:e2e-isolated
npm run test:e2e:isolated:all
```

The wrapper changes configuration only in the spawned processes. It never
prints wallet secrets and refuses to use a non-local RPC or a chain other than
31337. The E2E database is intentionally retained after the campaign so its
cross-system state can be inspected; it can be removed separately after the
test report has been captured.

The isolated command launches headed Chromium by default so the browser
workflows remain visible. Set `E2E_HEADED=false` when a headless CI run is
preferred. The ordered campaign retains separate HTML reports under
`playwright-reports/general`, `playwright-reports/workflow`,
`playwright-reports/showcase`, `playwright-reports/maintenance`, and
`playwright-reports/resilience`, plus stage timings in
`verification-results/playwright-e2e-run-results.json`.

To inventory the integrated Playwright catalog without starting services or
executing a scenario, use the isolated environment loader so all local actor
identities are derived consistently:

```powershell
npm run test:e2e:list:isolated
```

The state-dependent supervisor showcase is intentionally separate from the
clean-state suite. Run it after the workflow journeys have created policies,
claims, payments, notifications, and audit history:

```powershell
npm run test:e2e:showcase
```

Hospital-owned record maintenance is a reversible database mutation and has its
own opt-in check:

```powershell
npm run test:e2e:maintenance
```

Live defensive HTTP checks have their own final stage:

```powershell
npm run test:e2e:resilience
```

It covers CORS and security headers, malformed JSON, unsupported methods,
Oracle API-key rejection, and sustained authentication rate limiting. Run it
last because deliberate rate-limit exhaustion affects the shared loopback
client until the limiter window resets.

For a fully local evidence path, start `npm run dev:pinata-mock` and set
`PINATA_API_BASE_URL=http://127.0.0.1:5055` plus matching synthetic
`PINATA_JWT`/`LOCAL_PINATA_TOKEN` values only in the spawned test processes.
The simulator keeps encrypted synthetic uploads in memory and discards them
when stopped; it is not a production IPFS implementation.

To run the state-changing banking and adjudication journeys:

```powershell
npm run test:e2e:workflow
```

To rerun only the focused unfinished-work coverage on a healthy isolated stack:

```powershell
npm run test:e2e:unfinished:benefits
npm run test:e2e:unfinished:boundaries
npm run test:e2e:unfinished:evidence
npm run test:e2e:unfinished:claims
npm run test:e2e:unfinished:appeal
npm run test:e2e:unfinished:rpc
```

The focused `claims` command intentionally excludes the separately named
appeal scenario, so the sequence above executes each unfinished scenario once.

For the complete serial campaign with fresh temporary deployments between
time-changing stages, start the existing local MongoDB container, then use:

```powershell
$env:E2E_MONGODB_URI='mongodb://127.0.0.1:27019/block_insure_e2e'
$env:E2E_RPC_PROXY='true'
npm run test:stabilization
```

This runner refuses an occupied chain port or a database outside loopback
`block_insure_e2e`. It preserves saved environment/deployment files and uses
the in-memory Pinata simulator. Each stage keeps its HTML report, JSON results,
screenshots and failure artifacts under its own `tmp/stabilization-*/`
directory. The parent `campaign.json` records completed and failed stages.
The runner discovers an installed Chromium; record any executable override with
the campaign results. It does not start or reconfigure Docker itself.

To run only the provider-mode email journey:

```powershell
npm run test:stabilization -- e2e/tests/email-delivery.workflow.spec.js --brevo-stub
```

The test-only backend launcher substitutes an in-memory response at Brevo's
fixed HTTP endpoint. Its private loopback mailbox holds synthetic codes in
memory. It requires the isolated database and synthetic sender/API key; saved
Brevo credentials are overridden only in the spawned test process. The test
waits through the actual one-minute resend interval and checks a mined premium
receipt. A separate provider-rejection case checks that no usable challenge or
simulated fallback remains. These checks prove application behavior against a
provider stub; real mailbox receipt remains a separate manual check.

The appeal check is a headed multi-role workflow: original Oracle failure,
four-Auditor manual-review snapshot and rejection, browser-side encrypted
correction, fresh version-bound Admin Oracle request without hospital-wallet attestation, exact
two-worker approval, allocation, claimant withdrawal, and final UI/API/MongoDB/
contract/event reconciliation. The RPC check requires `E2E_RPC_PROXY=true` and
proves `/health/ready` returns 503 during a paused loopback proxy while
`/health/live` stays 200, followed by readiness recovery.

When using the local Pinata-compatible simulator with the isolated launcher,
pass `E2E_PINATA_API_URL=http://127.0.0.1:5055/pinning/pinFileToIPFS` and a
matching synthetic `E2E_PINATA_JWT`. The launcher translates these values to
the backend's `PINATA_API_BASE_URL`/`PINATA_JWT` and the frontend's matching
`VITE_IPFS_GATEWAY` only inside spawned test processes, then prints only the
sanitized evidence hostname.

The workflow command uploads two small encrypted test artifacts through the
backend's configured Pinata account and changes the current local
blockchain/database state. Run it after a clean `setup:hybrid` (or start with
`dev:hybrid`) when you want deterministic results. The workflow covers bank approval, rejection,
automatic EFT, manual OTP payment, automatic Oracle approval, and Oracle failure
followed by assigned-Auditor consensus.

Failures retain a screenshot, video, and Playwright trace in `test-results/`.
Open the HTML report with:

```powershell
npm run test:e2e:report
```

The production-bundle public quality suite is self-contained and does not need
MongoDB, a blockchain deployment, or role credentials. It rebuilds the Vite
bundle, starts `vite preview` on loopback, checks representative mobile, tablet,
laptop, and desktop viewports, and verifies basic keyboard/focus semantics:

```powershell
npm run test:e2e:frontend-production
```

Its HTML report is written to `playwright-report-frontend/`.

The production-quality suite uses Playwright's matching Chromium build by
default. If that build is unavailable, an explicitly installed Chromium can be
selected for a local smoke check with `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`.
Record that browser override with the result; it is not proof of the default
bundled browser. Clear the variable to restore the default.

## File layout

- `tests/public-smoke.spec.js` — public site and API availability
- `tests/role-workspaces.spec.js` — role login, navigation, and authorization
- `tests/route-inventory.spec.js` — every top-level route and cross-role redirects
- `tests/bank-eft.workflow.spec.js` — bank EFT, OTP, rejection, and cancellation
- `tests/user-policy-claim.workflow.spec.js` — claim adjudication and settlement
- `tests/hospital-records.maintenance.spec.js` — reversible hospital registry edits
- `tests/showcase-coverage.spec.js` — state-dependent deep workspace assertions
- `support/environment.js` — safe loading of role-specific local configuration
- `support/walletBridge.js` — programmable local wallet replacing MetaMask UI
- `support/actions.js` — shared login, date, and evidence helpers

Add future scenarios as focused spec files instead of extending one giant test.

## Completion Phase 1 verification

Select an explicit **loopback disposable database**; the runner refuses Atlas.
Do not use the saved application database or reset existing project data. The
runner creates fresh local deployments serially and stops only its own services.
It does not change saved `.env` files, standard deployment manifests, Docker
resource settings, trained weights or historical research artifacts. The broader
hybrid fixture still requires the separately prepared runtime dataset.

```powershell
$env:E2E_MONGODB_URI='mongodb://127.0.0.1:27019/block_insure_phase1_e2e'
$env:E2E_DATABASE_NAME='block_insure_phase1_e2e'
npm run test:phase1
```

An already installed compatible Chromium can be selected with
`PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`; otherwise the normal Playwright browser
installation is used. On Windows the harness needs permission to stop the process
trees it starts. Do not kill unrelated Node or Docker processes.

Run one stage with `npm run test:phase1 -- foundation`, `payments`, `claims`,
`email`, or `settlement`. Each stage gets a new local chain, preventing premium
time travel from expiring a later claim fixture. Email uses a local Brevo-shaped
provider stub and never sends external messages. Settlement tests exercise actual
MongoDB, Hardhat, signed transactions, a fresh recovery process, competing wallet
payment, gateway/account insufficiency and manual/EFT final-period coordination.

Reports, synthetic screenshots and traces are stored beneath `tmp/stabilization-*`
and stay ignored. A test failure is not a completion receipt. Phase 2 evidence
bundle/access/appeal recovery and auxiliary-benefit decisions remain separately
scoped; the Phase 1 command does not claim the full project is deployment-ready.

## Integrated evidence and recovery verification

The current release adds `npm run test:phase2`. Select an explicit loopback
disposable database, with the existing MongoDB container already prepared:

```powershell
$env:E2E_MONGODB_URI='mongodb://127.0.0.1:27019/block_insure_phase2_e2e'
$env:E2E_DATABASE_NAME='block_insure_phase2_e2e'
npm run test:phase2
```

Run a bounded stage with `npm run test:phase2 -- foundation`, `recovery`, `evidence`, `claims`,
`refund`, `funding`, `finality`, `payments`, or `email`. Each stage resets only the
selected disposable database and deploys a new local chain, keeping time-travel
fixtures separate. Existing Atlas and saved .env/standard manifest files are not
rewritten. `funding` deliberately omits the test treasury top-up; `email` uses
only a local Brevo-shaped stub. Operator setup is not a real public deployment.

Evidence tests cover interrupted supporting upload/reload, fixed manifests, one
batch of reviewer grants, revoked access and explicit resumption, claimant-offline
actual PRE decryption/download, image preview, four-reviewer preparation, quorum
withdrawal, preparation expiry and lost appeal registration. Recovery integration
uses MongoDB/Hardhat and a fresh process for exact signed-transaction recovery,
ordered predecessor anchoring and deployment isolation. The retired death/maturity
and unlimited-immediate-premium script is replaced by the cancellation-refund test.

Reports remain under ignored `tmp/stabilization-*`. Selected cases must actually
pass before recording completion; prior failures and source-bound historical
results are not substituted for the current release. Actual MetaMask/mailbox,
production installation and public-testnet evidence remain later release checks.
