# Supervisor Showcase Readiness — 2026-09-01

## Verdict

The core Block-Insure workflow is ready for a supervised demonstration. Both the automatic two-oracle settlement path and the manual three-auditor consensus path completed end to end in Playwright. The Auditor Reputation indexing and contract-binding defects discovered during rehearsal have been corrected and the live page now lists all four on-chain auditors.

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

5. **Architecture/research explanation**
   - Two independent oracle wallets evaluate the committed claim against separate registry snapshots.
   - Registered evidence can reach automatic quorum; failed registry checks route to assigned auditors.
   - Evidence is encrypted before upload, linked to the on-chain claim, and protected by assignment-based access control.
   - The 5,000-record hybrid registry, frozen fraud model, Merkle commitment, reserve simulation, and experimental dashboard connect the implementation to the research paper.

## Playwright results

| Area | Result | Verified behavior |
| --- | --- | --- |
| Automatic transaction journey | PASS | Purchase, encryption, evidence reconciliation, two-oracle approval, payout, withdrawal, `SETTLED` |
| Manual-review transaction journey | PASS | Oracle failure, Admin routing, three assigned-auditor votes, payout, withdrawal, `SETTLED` |
| Policyholder expanded showcase | PASS | Dashboard, pricing, scenario simulation, policies, benefits, claims, evidence, notifications, claim form |
| Admin expanded showcase | PASS | Portfolio health, package lifecycle, benefits, Merkle proof, role health, audit log, claim controls, thesis dashboard |
| Public and role smoke suite | PASS | Public health, User/Admin/four-Auditor authentication, route isolation, role synchronization |
| Auditor expanded showcase | PASS | Timeline, export, evidence integrity, voting queue, registry, and four-auditor reputation roster |

The final clean role/showcase run passed all 9 browser scenarios. The targeted Admin rerun also passed after the package form was made controlled from its first render.

## Non-browser verification

- Hybrid dataset integrity: PASS, 5,000 records.
- Solidity contract tests: PASS, 127 tests.
- Backend tests: PASS, 65 tests.
- Frontend lint and production build: PASS.
- Oracle tests: PASS, 13 tests.
- Repository integrity: PASS after refreshing the top-level research manifest.

## Known issues and risks

### Demo environment dependencies

- MongoDB is hosted remotely and the configured workflow uses real Pinata, so reliable internet is required for authentication, persistence, and new evidence uploads.
- The local Hardhat chain is ephemeral. Closing the managed development process discards the current on-chain demo state.
- Avoid repeatedly reconnecting wallets during the presentation; the security limiter permits 15 wallet-login attempts per 15-minute window from one client IP.

## Demo preparation

The current multi-terminal stack is populated with two settled policies/claims and a supervisor-demo package. If it must be rebuilt in the simpler managed mode, run:

```powershell
npm run dev:hybrid
```

Keep that terminal running. In a second terminal, create the two settled showcase journeys once:

```powershell
npm run test:e2e:workflow
```

That workflow changes local blockchain/database state and, with the current configuration, pins two encrypted test artifacts to the configured real Pinata account.

Before the meeting, verify service and actor readiness with:

```powershell
npm run preflight:metamask
```
