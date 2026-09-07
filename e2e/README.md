# Block-Insure Playwright tests

These tests use Playwright's bundled Chromium and an in-process EIP-1193 wallet
bridge. They do not use Waterfox, Opera, MetaMask profiles, seed phrases, or a
Pinata browser login. Every signature and local transaction uses the private key
assigned to the selected test actor.

## What is covered

- Public landing page and backend health
- SIWE wallet login for User, Admin, Bank, Hospital, and all four Auditors
- Role-specific navigation and cross-role redirect protection
- Every top-level public and authenticated application route, with browser-error and
  HTTP 5xx monitoring
- Admin role synchronization and policy-package pages
- Auditor registry, voting queue, and document-verification pages
- Hospital dashboard, record/invoice maintenance with persistence, claim attestation,
  and restored Merkle-root verification
- Bank dashboard, mandate approval/rejection, automatic quarterly EFT, manual OTP
  rejection/success, and policyholder cancellation
- State-changing registered-claim workflow: policy purchase, browser encryption,
  evidence reconciliation, two-oracle approval, payout allocation, and withdrawal
- State-changing exception workflow: oracle failure, Admin routing, three assigned
  Auditor approvals, payout allocation, and withdrawal

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

To run the state-changing banking and adjudication journeys:

```powershell
npm run test:e2e:workflow
```

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
