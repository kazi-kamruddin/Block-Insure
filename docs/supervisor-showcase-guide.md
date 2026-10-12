# Supervisor Showcase Guide

## Current readiness

The core Block-Insure workflow is prepared for a supervised demonstration. The automated browser suite covers both the automatic two-oracle settlement path and the manual three-auditor consensus path, plus every public and role-isolated workspace.

## Recommended demonstration order

1. **Public view**
   - Explain the claim-assurance pipeline: evidence commitment, oracle quorum, independent review, and on-chain settlement.
   - Show that unauthenticated users cannot enter role workspaces.

2. **Policyholder view**
   - Connect the policyholder wallet and show the coverage dashboard.
   - Open **Buy Policy** and demonstrate premium simulation and the historical scenario simulator.
   - Show purchased policies, beneficiaries, additional benefits, and downloadable terms.
   - Show both settled claims: one approved automatically by two oracles and one resolved through manual review.
   - Open a claim to show its status, encrypted evidence metadata, oracle results, payout, and settlement.
   - Show notifications and the claim-submission form's document-privacy explanation.

3. **Admin view**
   - Show reserve, exposure, premium, settlement, role-sync, and oracle-health cards.
   - Show the policy-package lifecycle and the pre-created **Supervisor Demo Health** package.
   - Show policy-benefit administration.
   - Open the hybrid healthcare registry, point out the matching roots, and verify a Merkle proof.
   - Open Role Sync Health and show zero mismatches.
   - Show the Admin Action Audit and a settled claim's on-chain settlement breakdown.
   - Emphasize that Admin cannot directly approve, reject, or settle a claim; those buttons are intentionally absent.
   - Finish with the Thesis Results Dashboard: evaluation mode, reserve adequacy, confidential evidence, fraud decision support, throughput, gas, oracle performance, and registry commitment.

4. **Auditor view**
   - Show the assigned manual-review claim and its complete audit timeline.
   - Show the evidence hash chain and the comparison between independent oracle registry results.
   - Export the audit timeline as JSON.
   - Upload a deliberately different file on Verify Document and show the tamper/hash-mismatch warning.
   - Show that the voting queue is empty after settlement and that the auditor registry root matches.
   - Show the Reputation page with all four active auditors and their initialized or unrated state.

5. **Hospital view**
   - Show that the provider wallet opens only its contracted hospital workspace.
   - Open patient and invoice records and explain hospital-owned source data.
   - Open claim requests and show how the hospital attestation is kept separate from the insurer and oracles.

6. **Bank view**
   - Show the independently scoped bank identity and its three demo accounts.
   - Explain mandate approval/rejection, quarterly EFT automation, and OTP-confirmed manual payments.
   - Emphasize that the policyholder initiates payment instructions while the bank owns execution and account records.

7. **Architecture/research explanation**
   - Two independent oracle wallets evaluate the committed claim against separate registry snapshots.
   - Registered evidence can reach automatic quorum; failed registry checks route to assigned auditors.
   - Evidence is encrypted before upload, linked to the on-chain claim, and protected by assignment-based access control.
   - The 5,000-record hybrid registry, frozen fraud model, Merkle commitment, reserve simulation, and experimental dashboard connect the implementation to the research paper.

## Playwright coverage and results

The final non-mutating rehearsal passed all 13 public, authentication,
role-isolation, and route-inventory scenarios. The two transaction journeys
below are maintained as opt-in suites because running them writes blockchain and
database state and uploads two encrypted test artifacts to the configured Pinata
account. Run them deliberately during demo preparation, not as part of a routine
read-only verification.

| Area | Result | Verified behavior |
| --- | --- | --- |
| Automatic transaction journey | OPT-IN | Purchase, encryption, evidence reconciliation, two-oracle approval, payout, withdrawal, `SETTLED` |
| Manual-review transaction journey | OPT-IN | Oracle failure, Admin routing, three assigned-auditor votes, payout, withdrawal, `SETTLED` |
| Policyholder expanded showcase | PASS | Dashboard, pricing, scenario simulation, policies, benefits, claims, evidence, notifications, claim form |
| Admin expanded showcase | PASS | Portfolio health, package lifecycle, benefits, Merkle proof, role health, audit log, claim controls, thesis dashboard |
| Public and role smoke suite | PASS | Public health, User/Admin/four-Auditor authentication, route isolation, role synchronization |
| Auditor expanded showcase | PASS | Timeline, export, evidence integrity, voting queue, registry, and four-auditor reputation roster |
| Hospital workspace | PASS | Scoped records, claim attestation, maintenance, and restored Merkle commitment |
| Bank workspace | PASS | Scoped accounts, mandate decisions, scheduled EFT, OTP payment, and transaction history |

Use the commands below to produce a fresh, dated verification result before the presentation instead of relying on an older test count.

## Non-browser verification

- Hybrid dataset integrity: PASS, 5,000 records.
- Solidity contract tests: PASS, 132 tests.
- Backend tests: PASS, 91 tests.
- Frontend lint and production build: PASS.
- Oracle tests: PASS, 13 tests.
- Repository integrity: PASS after refreshing the top-level research manifest.

## Known issues and risks

### Demo environment dependencies

- MongoDB is hosted remotely and the configured workflow uses real Pinata, so reliable internet is required for authentication, persistence, and new evidence uploads.
- The local Hardhat chain is ephemeral. Closing the managed development process discards the current on-chain demo state.
- Avoid repeatedly reconnecting wallets during the presentation; the security limiter permits 15 wallet-login attempts per 15-minute window from one client IP.

## Demo preparation

Prefer the local hybrid workflow for the defense: it is deterministic, fast,
and isolated from public-testnet congestion. Use the hosted Sepolia deployment
as an architecture/deployment proof and backup URL, not as the only live demo.

Build a deterministic hybrid demonstration from a clean local state with:

```powershell
npm run dev:hybrid
```

Keep that terminal running. In a second terminal, create the two settled showcase journeys once:

```powershell
npm run test:e2e:workflow
```

That workflow changes local blockchain/database state and, with the current configuration, pins two encrypted test artifacts to the configured real Pinata account.

Run the state-dependent showcase checks after the workflow journeys:

```powershell
npm run test:e2e:showcase
```

Before the meeting, verify service and actor readiness with:

```powershell
npm run preflight:metamask
```

Also keep these presentation fallbacks ready:

- The public homepage and policy catalog, which do not require wallet login.
- The latest `verification-results/phase5-verification.json` report.
- The tracked six-page paper and evaluation charts.
- A browser tab on the hosted deployment and a second tab on the local stack.

If a live transaction stalls, explain the recorded transaction journey and move
to the already-settled claim rather than waiting at the podium. Never reset the
database or redeploy contracts during the presentation.
