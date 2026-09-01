# Manual MetaMask Rehearsal — 2026-09-01

## Safety and browser preparation

- Use only the local Hardhat accounts prepared for this project. Never import a wallet that controls real assets.
- Give every role its own browser profile. Separate profiles isolate MetaMask permissions, JWT sessions, local storage, and encrypted-evidence identities.
- Do not clear the policyholder profile's site data during a claim demonstration. Its encrypted evidence-recovery identity is stored in that profile's IndexedDB.
- After rebuilding the Hardhat chain, clear MetaMask's activity/nonce data in every local profile if MetaMask shows stale transactions or a nonce error.
- Do not start duplicate services on the same ports. Stop an existing managed stack with `Ctrl+C` before starting the multi-terminal layout.

## MetaMask network

Add the same custom network to every profile:

| Field | Value |
| --- | --- |
| Network name | Hardhat Localhost |
| RPC URL | `http://127.0.0.1:8545` |
| Chain ID | `31337` |
| Currency symbol | `ETH` |
| Block explorer | Leave blank |

## Expected browser-profile addresses

Compare the selected MetaMask public address before connecting. Never paste a private key into the website.

| Profile | Public address | Expected application role |
| --- | --- | --- |
| Policyholder | `0x0Bd6E65d2C8a48fF1136D061CAF39bCe669Ed0fd` | USER |
| Admin | `0xd388BB1572CDb7F7dB2bb485a1051749F9B1ff1E` | ADMIN |
| Auditor 1 | `0x62C6343B7a3AAA23cED5BE620B4e0cFA3FEd3b7B` | AUDITOR |
| Auditor 2 | `0xC96AcdC410bF1EF4AFf2DaaE773f1f2bb21F84CE` | AUDITOR |
| Auditor 3 | `0x087526D154a9d9f5eFE9F3b4bc5A76553c6A2D20` | AUDITOR |
| Auditor 4 | `0xe18db535cD470bF346B41860e0Ac4Cd4Dcb04Dda` | AUDITOR |

The Oracle wallets are service identities. Do not use them as browser profiles.

## Multi-terminal startup

Open VS Code in the repository root. For a fresh hybrid demonstration, use these terminals in order.

Terminal 1 — local blockchain; keep it running:

```powershell
npm --prefix contracts run node
```

Terminal 2 — deploy, reset only Block-Insure runtime data, fund accounts, assign roles, and publish the 5,000-record registry root:

```powershell
npm run setup:hybrid
```

Wait for setup to finish successfully before starting the remaining terminals.

Terminal 3 — backend:

```powershell
npm --prefix backEnd run dev
```

Terminal 4 — frontend:

```powershell
npm --prefix frontEnd run dev
```

Terminal 5 — Oracle 1:

```powershell
npm --prefix oracle run dev
```

Terminal 6 — Oracle 2:

```powershell
npm --prefix oracle run dev:oracle2
```

Terminal 7 — safe public-address and readiness check:

```powershell
npm run preflight:metamask
```

Every browser identity must show `roleReady: YES` and a positive local ETH balance. The command prints no private keys.

The simpler alternative is one terminal running `npm run dev:hybrid`; it performs the same preparation and keeps all services together.

## First connection in each profile

1. Select **Hardhat Localhost** and the exact address assigned to that profile.
2. Open `http://localhost:5173`.
3. Click **Connect Wallet**.
4. Approve the MetaMask site connection.
5. Approve the sign-in message. This is a signature, not an ETH transaction.
6. Confirm the application redirects to the correct workspace and displays the expected role beside the address.

Changing the active MetaMask account or network intentionally logs the application session out. Select the intended account and connect again.

## Automatic two-Oracle demonstration

1. In the Policyholder profile, buy **Health Basic** and confirm the MetaMask transaction.
2. Open **Submit Claim**, select the valid `HOSP-001 / HOSPITALIZATION / 0.1 ETH` preset, and set the incident date/time to the current time.
3. Select a small document and submit. On a profile's first encrypted upload, MetaMask may request an evidence-recovery signature; then it requests the claim transaction confirmation.
4. In the Admin profile, open the new claim. It should begin at `DUPLICATE_CHECKED`.
5. Click **Request Oracle Verification** and confirm the Admin transaction.
6. Keep both Oracle terminals visible. Refresh the claim until the two independent results move it to `PAYOUT_READY`.
7. Return to the Policyholder claim, click **Withdraw Payment**, confirm the transaction, and show `SETTLED`.

## Manual-review demonstration

1. In the Policyholder profile, buy a second policy.
2. Submit a `0.1 ETH` `HOSPITALIZATION` claim using hospital `HOSP-NOT-REGISTERED`, a unique invoice number, the current incident date/time, and a small document.
3. In Admin, request Oracle verification and wait for `ORACLE_FAILED`.
4. Click **Send to Manual Review** and confirm the transaction. Admin cannot approve, reject, settle, or vote on the claim.
5. Open Auditor profiles 1, 2, and 3. Each should see the assigned claim in the voting queue.
6. In each profile, open the claim, choose **Valid Claim**, and confirm the MetaMask vote transaction. Three approvals allocate the payout automatically.
7. Show the audit timeline, evidence hash chain, independent Oracle results, document-integrity check, and updated Auditor Reputation page.
8. Return to the Policyholder profile and withdraw the payment to reach `SETTLED`.

## Expected MetaMask prompts

- One site-connection approval per new browser profile.
- One sign-in signature per new or expired application session.
- One transaction confirmation for each policy purchase.
- A possible evidence-recovery signature on a profile's first encrypted-evidence operation.
- One transaction confirmation for claim submission.
- Admin confirmations for Oracle request and manual-review routing.
- One transaction confirmation per Auditor vote.
- One Policyholder transaction confirmation for payout withdrawal.

Read the account and network shown in every popup. Reject a prompt if it comes from the wrong profile.

## Avoid these demo problems

- Do not run `test:e2e:workflow` before a manual demonstration unless you want Playwright to create and settle the claims for you.
- Do not run `setup:hybrid`, `dev:hybrid`, or redeploy while demonstrating; they replace the local chain/database state.
- Keep the blockchain, backend, frontend, and both Oracle terminals running. Oracle verification will not finish if either Oracle worker is missing.
- Maintain internet access: MongoDB Atlas and the configured real Pinata service are external dependencies.
- Avoid repeated logout/login cycles. The backend permits 15 wallet-login attempts per client IP in a 15-minute window.
- If MetaMask says the network is wrong, select chain `31337` before reconnecting.
- If MetaMask reports a stale nonce after a chain reset, clear activity/nonce data for that local account and reload the page.
- If a role is wrong or an account lacks test ETH, stop and rerun `npm run preflight:metamask`; do not continue with a different account.
