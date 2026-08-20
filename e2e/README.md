# Block-Insure Playwright tests

These tests use Playwright's bundled Chromium and an in-process EIP-1193 wallet
bridge. They do not use Waterfox, Opera, MetaMask profiles, seed phrases, or a
Pinata browser login. Every signature and local transaction uses the private key
assigned to the selected test actor.

## What is covered

- Public landing page and backend health
- SIWE wallet login for User, Admin, and all four Auditors
- Role-specific navigation and cross-role redirect protection
- Admin role synchronization and policy-package pages
- Auditor registry, voting queue, and document-verification pages
- Optional real User workflow: purchase a policy, generate a unique PNG evidence
  file in memory, encrypt it in the browser, upload it through the application,
  submit the claim on-chain, and reconcile its evidence metadata

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

To run the state-changing policy purchase and claim/evidence upload journey:

```powershell
npm run test:e2e:workflow
```

The workflow command uses the Pinata mode configured in `e2e/.env`. With
`E2E_PINATA_MODE=real`, it uploads one small encrypted test artifact to the real
configured Pinata account and changes the current local blockchain/database
state. Run it after a clean `setup:local` when you want deterministic results.

Failures retain a screenshot, video, and Playwright trace in `test-results/`.
Open the HTML report with:

```powershell
npm run test:e2e:report
```

## File layout

- `tests/public-smoke.spec.js` — public site and API availability
- `tests/role-workspaces.spec.js` — User/Admin/Auditor login and authorization
- `tests/user-policy-claim.workflow.spec.js` — opt-in state-changing journey
- `support/environment.js` — safe loading of role-specific local configuration
- `support/walletBridge.js` — programmable local wallet replacing MetaMask UI
- `support/actions.js` — shared login, date, and evidence helpers

Add future scenarios as focused spec files instead of extending one giant test.
