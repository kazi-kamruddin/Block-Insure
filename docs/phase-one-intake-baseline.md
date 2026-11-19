# Phase one comparison baseline

The historical hosted application uses Base Sepolia (84532). Local acceptance uses a disposable MongoDB database and Hardhat (31337). The supported original viewer and explorer entry points are indexed in `.project-context/12_DEMONSTRATION_LINKS.md`.

| Historical input | SHA-256 of the archived local file |
|---|---|
| reference/BASE_SEPOLIA_DEPLOYMENT__2026-11-01.md | 92e6ad84151eb030b20820fc5df8454f9d6800c7392a103d37aaa0dd71150f14 |
| verification-results/base-v5-activation-2026-11-07/current-state-manifest.json | 47b3f3482aff59d7e17970115497bed7db2734f10732d0a36974ff9b2a0fe666 |
| backEnd/artifacts/xgboost-protocol-v5.json | d991ea6af77aa6f914424303def310f2ba4a75d47caf4bc42bd200f14a8c7edf |
| oracle/abi/InsuranceManager.json | 60865140feb090bd38f0c9f50100614afec81c956af6ad08d65dc5613a09f24c |

The activation directory contains the readback, journal and transaction receipt. The dated episode evidence and its verification scope are indexed in `.project-context/03_CURRENT_STATE.md`. Claim 9 records original owner and assigned reviewer decryption. A fresh hosted decryption requires the original authorized browser identity. The baseline records historical observations separately from current local test results.

| Comparison case | Baseline behavior |
|---|---|
| Routine payment | The holder entered hospital, invoice, service, amount and incident time, uploaded encrypted files and signed. Matching positive reveals could allocate a funded pull payment. |
| Clerical correction | Contract amendment required rejection. The claimant could change the permitted amount or invoice reference and advance the version through appeal. |
| Review-worthy record | Admin could route a negative Oracle result to four auditors. Each assigned viewer required evidence access before meaningful inspection. |
| Successful appeal | The archived hosted v5 acceptance directory records a sponsored appeal with fresh version-bound verification. |

Phase one retains the existing issued economics. A service-specific sublimit, partial payment at the remaining coverage cap and new appeal rules require the separately planned protocol deployment. The v5 medical document's hash and frozen evaluator identify the original behavior.

## Running the revised claims workflow

Set `CLAIM_WORKFLOW_PROFILE=V6` in a separate deployment to enable versioned clarification and votes with evidence reasons. The demonstration timing profile sets ten minutes each for evidence preparation and voting, with a fifteen-minute public routing delay. Production-shaped defaults retain the longer windows.

The insurer may publish an episode immediately from the healthcare registry. On a capped policy, the policyholder can record a filing intent for the invoice before the original deadline. That intent allows seven extra days for the same invoice. The contract still checks the paid coverage interval, service eligibility and invoice reuse. The hospital records and corrects episode facts. The insurer checks the patient-to-wallet association before publication.

The Oracle workers check published facts and the deployment's on-chain commitments. Reviewers can open encrypted attachments after the policyholder prepares access. A clarified claim needs its new evidence set reconciled and a fresh Oracle request. The claimant supplies the encrypted supplement. A reasoned vote binds a private rationale by hash. The app hides peer votes until the viewer votes or the review ends. Public transactions can still reveal votes during the window.

V6 uses its own database, evidence scope, manager address, worker configuration and release manifest. Existing policies, claims, open reviews, balances and encrypted evidence continue to resolve via the archived deployment. Copying old claim IDs or reusing the evidence database would misidentify those records. Use the existing Base Sepolia deployment probe and readback for a parallel deployment. Set the new API's `ORACLE_READY_URLS` to the two worker origins, separated by a comma. Run the hosted smoke suite against that API and its two workers before making it the default viewer.
