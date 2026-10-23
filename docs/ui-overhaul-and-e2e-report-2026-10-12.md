# Block-Insure UI Overhaul and Repository-Wide QA Report

## Verdict

**PASS WITH RISKS** — the redesigned application and the deterministic local E2E scope passed. No executed functional test remains failing. The remaining risk is confined to development-tool dependency advisories that require breaking major-version migrations.

## Campaign identity

- Date: 2026-10-12 (Asia/Dhaka)
- Tested commit: `49aa84ed7bccfd29354afaddfade053ffb79c1cb`
- Branch: `postPreDefence`
- Working tree: dirty before this campaign; unrelated existing edits were preserved
- Node.js: v24.16.0
- Browser: locally installed Playwright Chromium, headed for role/workflow E2E
- Frontend: `http://localhost:5173`; production preview quality suite used `http://127.0.0.1:4173`
- Backend: `http://localhost:5000`
- RPC: `http://127.0.0.1:8545`, chain ID 31337
- MongoDB: configured Atlas host with the launcher-forced disposable database `block_insure_e2e`
- Wallets: deterministic local Hardhat accounts only
- Evidence storage: local Pinata-compatible simulator on `127.0.0.1:5055`; synthetic encrypted files only
- Dataset: `blockinsure-hybrid-v1.2.0`, 5,000 synthetic healthcare records, five hospitals and one bank

The launcher safety preamble, clean-start verification, and E2E preflight all passed before state-changing browser tests. Only the disposable E2E database and local Hardhat chain were reset.

## Implemented UI upgrade

- Integrated Tailwind CSS 4 through the Vite plugin and theme tokens.
- Added a global modern design system while retaining the stable semantic classes used by the existing app and E2E tests.
- Redesigned the public shell, local-protocol ribbon, navigation, wallet identity, role workspaces, cards, forms, tables, status surfaces, dialogs, toasts, and footer.
- Added role-specific visual accents for User, Admin, Auditor, Hospital, and Bank workspaces.
- Added responsive layouts and overflow protection for mobile, tablet, laptop, and desktop sizes.
- Preserved keyboard focus styles and reduced-motion behavior.
- Added production-bundle viewport assertions and full-page screenshot attachments.

Primary implementation: `frontEnd/src/styles/modern-system.css`, `frontEnd/src/layouts/PublicLayout.jsx`, `frontEnd/src/layouts/RoleWorkspaceLayout.jsx`, and `frontEnd/src/components/WalletConnectButton.jsx`.

## Requirements-to-result matrix

| Actor/system | Proved behavior | Evidence/result |
|---|---|---|
| Guest/public | Landing, catalog, policy detail, login alias, 404, direct-route denial, refresh | PASS in general and production suites |
| User | SIWE, purchase, policy views, bank mandate, EFT, OTP, encrypted claim, withdrawal, settlement | PASS |
| Admin | SIWE, package lifecycle, claim detail, Oracle request, protocol/research/role-health views | PASS |
| Bank | Scoped login, mandate approval/rejection, replacement/cancellation, EFT and OTP ledger | PASS |
| Hospital | Scoped login, claim lookup/attestation, owned record update and fixture restoration | PASS |
| Four Auditors | All four sign in; snapshot/quorum, assigned voting, evidence delegation/decryption/revocation, history/integrity/reputation | PASS |
| Two Oracles | Distinct authorized identities, heartbeats, exact two-result quorum, API-key denial, failure-to-manual-review path | PASS |
| Evidence | Browser AES-256-GCM, CID/hash reconciliation, no raw AES key/plaintext in MongoDB, logged grant/proxy transform | PASS |
| Smart contracts | Role controls, state machines, replay protection, coverage/reserve accounting, pull payments, benefits | PASS, 133 tests |
| Backend | Validation, SIWE, authorization, rate limits, evidence, banking, analytics, operational hardening | PASS, 114 tests |
| Frontend quality | Lint, production build, four viewport sizes, focus/skip link, no overflow or unexpected browser/request failures | PASS |
| Resilience/security | Headers, explicit local CORS, malformed JSON, unsupported methods, Oracle API key, nonce rate limit | PASS |

## Commands and results

| Command/suite | Result | Count/time |
|---|---:|---:|
| `npm run test:e2e:isolated:all` | PASS | 30/30; 462,432 ms aggregate |
| General Playwright | PASS | 17/17; 165,721 ms |
| Workflow Playwright | PASS | 4/4; 185,319 ms |
| Showcase Playwright | PASS | 4/4; 80,093 ms |
| Maintenance Playwright | PASS | 1/1; 24,873 ms |
| Resilience Playwright | PASS | 4/4; 6,426 ms |
| `npm run test:e2e:frontend-production` | PASS | 5/5; 10.2 s |
| `npm run verify:all` | PASS | 7/7 verification tasks |
| Contract tests | PASS | 133/133 |
| Backend tests | PASS | 114/114 |
| Oracle tests | PASS | 13/13 |
| Contract coverage | PASS | 95.22% statements; 65.04% branches; 92.18% functions; 95.51% lines |
| Contract mutation campaign | PASS | 8/8 mutants killed; score 1.0 |
| Repository verification | PASS | 7/7 check groups |
| Synchronization verification | PASS | ABI/address/config synchronization valid |
| Release-template check | PASS | Complete |
| Frontend/root/Oracle npm audit | PASS | 0 advisories |

## Defects and fixes

### 1. Claim-limit reset authorization ordering

Severity: medium. The reset middleware could clear the in-memory rate limiter before the controller rejected environments without `DEV_ALLOW_CLAIM_LIMIT_RESET=true`.

Fix: the middleware now independently requires a non-production environment and the explicit development reset flag before clearing a key. A regression test verifies development-enabled, development-disabled, and production behavior. The full backend suite passes.

### 2. E2E MongoDB safety assertion contradicted the isolated launcher

Severity: test defect. A manual-review test required a loopback MongoDB hostname even though the supported isolated launcher safely permits an external MongoDB host while forcing the exact disposable database name `block_insure_e2e`.

Fix: shared E2E validation now always requires the exact disposable database and additionally requires loopback only when `E2E_REQUIRE_LOCAL_MONGO=true`. The manual claim and appeal database assertions use this helper.

### 3. Playwright direct MongoDB SRV lookup did not share backend DNS policy

Severity: environment/test reliability. Direct Mongo reconciliation intermittently failed with `querySrv ECONNREFUSED` while the backend remained healthy.

Fix: the shared Playwright environment applies IPv4-first ordering and the same opt-in public DNS resolver policy as the backend. The manual-review journey then passed, including Mongo evidence-safety checks.

### 4. Dependency advisories

Non-breaking `npm audit fix` updates were applied to frontend, backend, contracts, and Oracle lockfiles. Frontend, root, and Oracle now report zero advisories. Backend dropped from nine advisories to three. Contracts tooling dropped from 51 to 46 and removed the prior critical advisory. All affected test suites passed after these updates.

## Diagnosed non-product failures

- The first evidence upload failed because the local simulator and backend were launched with different synthetic tokens. The UI correctly showed `Evidence storage upload failed`. Matching the documented local token resolved it; the narrow regression and full workflow both passed.
- A sandboxed Playwright retry produced `browserType.launch: spawn EPERM` before browser execution. The identical command passed outside the process sandbox. These instant launch failures are excluded from product-failure counts.

## Remaining risks

1. Backend retains three high advisories in the development-only `nodemon -> chokidar -> braces` chain. npm offers only a breaking/incorrect downgrade path (`nodemon@1.14.10`), so it was not forced. This chain is not part of the production runtime.
2. Contracts retains 46 advisories in local Hardhat/coverage/toolbox dependencies (14 low, 9 moderate, 23 high). npm's remediation requires a breaking Hardhat 3/toolbox migration or coverage downgrade. No deployed contract bytecode imports these Node tooling packages. Treat this as planned toolchain maintenance, not a runtime protocol vulnerability.

## Evidence and artifacts

HTML reports and screenshots below are local generated artifacts excluded from
Git. The small dated JSON summaries remain tracked. Reruns describe their current
source revision and do not recreate the historical campaign's exact evidence.

- Ordered E2E machine result: `verification-results/playwright-e2e-run-results.json`
- Final offline verification: `verification-results/phase5-verification.json`
- Mutation details: `contracts/mutation-results.json`
- General HTML report: `playwright-reports/general/index.html`
- Workflow HTML report: `playwright-reports/workflow/index.html`
- Showcase HTML report: `playwright-reports/showcase/index.html`
- Maintenance HTML report: `playwright-reports/maintenance/index.html`
- Resilience HTML report: `playwright-reports/resilience/index.html`
- Production UI report: `playwright-report-frontend/index.html`
- UI screenshots: `verification-results/ui-overhaul-home.png` and `verification-results/ui-overhaul-mobile.png`

## Reproduction

Use three PowerShell terminals from the repository root.

Terminal 1:

```powershell
npm run dev:pinata-mock
```

Terminal 2:

```powershell
$env:E2E_PINATA_API_URL='http://127.0.0.1:5055/pinning/pinFileToIPFS'
$env:E2E_PINATA_JWT='block-insure-local-test-only-token'
npm run dev:e2e-isolated
```

After the launcher reports that application services are ready, terminal 3:

```powershell
$env:E2E_PINATA_API_URL='http://127.0.0.1:5055/pinning/pinFileToIPFS'
$env:E2E_PINATA_JWT='block-insure-local-test-only-token'
npm run test:e2e:isolated:all
npm run test:e2e:frontend-production
npm run verify:all
npm --prefix contracts run coverage
npm --prefix contracts run test:mutations
npm run verify:sync
npm run release:check:template
```

These commands are for the disposable local/E2E environment only.
