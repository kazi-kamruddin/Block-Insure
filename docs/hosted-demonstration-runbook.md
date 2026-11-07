# Hosted demonstration and private acceptance

Use [Block-Insure](https://block-insure.vercel.app) on **Base Sepolia, chain 84532**.
Ethereum Sepolia is the preserved comparison deployment; a browser action does
not execute on both chains. No local Hardhat, Docker, API or worker terminal is
needed to use the hosted system.

## Prepare before the meeting

1. Open [API readiness](https://block-insure-api.onrender.com/health/ready),
   [Oracle One](https://block-insure-oracle-one.onrender.com/health/ready) and
   [Oracle Two](https://block-insure-oracle-two.onrender.com/health/ready).
   Free services may wake and resume checkpoints. Wait for all three to report
   `ready`; workers also expose scan lag and last successful poll. Refresh before
   creating a timed request. Do not reset checkpoints or redeploy to catch up.
2. Open separate browser **profiles** for holder, Admin, bank and reviewers.
   Ordinary windows in one profile can share wallet and application sessions.
   Hospital staff use the ordinary hospital login, with no wallet.
3. Check the selected role's public address and Base test balance. Wallet names
   are local labels, not role authority. Never screen-share private environment
   files, keys, recovery signatures or codes.
4. If MetaMask still displays the earlier malicious-site warning, record the
   current details and request review through its official support procedure.
   It is an unresolved classification, not a verified false positive. See the
   local `reference/METAMASK_CLASSIFICATION_REVIEW__2026-11-07.md` handoff.

## Walk through one fresh case

Use IDs actually returned by the application. Old policy, claim and statement
rows are preserved rehearsal history; they have not been reset or erased.

| Order | Role and page | Action / expected result |
|---|---|---|
| 1 | Holder, Profile | Confirm the intended email. If a code is requested, inspect inbox/spam privately; the application must show verified. Existing verified email can be reused. |
| 2 | Holder, Profile | Check evidence recovery. Restore only if this browser lacks the existing identity and an encrypted backup is available. The expected wallet recovery signature decrypts that backup; it does not rotate keys or grant another role access. |
| 3 | Holder, Buy Policy | Read and acknowledge the actual issued terms; purchase Health Basic — Accelerated Testnet Demo. Save the returned policy ID and receipt. Initial premium is 0.000001 test ETH; use displayed terms as authority. |
| 4 | Holder, Banking | Choose that policy and an account actually owned by this holder. Make one manual OTP payment when its quoted installment opens. Simulated 0.10 BDT corresponds to 0.000001 test ETH at the declared fixed demo rate. Check both statement and chain receipt. |
| 5 | Holder, Banking; then Bank | Submit an EFT mandate, switch to the bank profile and approve that exact new mandate. Confirm a later scheduled payment in both ledgers. OTP and EFT share the installment timeline; they must not pay the same installment twice. |
| 6 | Hospital portal | Create a fresh synthetic record using the input template below. Wait until publication is complete. No hospital blockchain signature should be requested. |
| 7 | Holder, New Claim | Select the new policy, HOSP-001, exact invoice number, 0.00002 test ETH, HOSPITALIZATION and a covered incident time after purchase. Check invoice readiness. Attach a matching synthetic invoice PDF and optional supporting image. Submit once and wait for receipt **and** evidence reconciliation. |
| 8 | Admin, that claim | For DUPLICATE_CHECKED, request Oracle verification only while both workers are ready. For FRAUD_FLAGGED or ORACLE_FAILED, use the authorized manual-review action. A risk/record failure routes to review; it does not itself prove fraud. |
| 9 | Holder and assigned reviewers, if routed | Prepare all four reviewer identities, authorize the assigned panel for the evidence set, then inspect actual decrypted files from assigned reviewer profiles. Three approvals approve; two rejections reject. Do not vote an approval merely to finish a demonstration. |
| 10 | Holder, approved claim | If funding is required, retain the entitlement until the correct reserve is funded and allocation activated. Withdraw once when payout is ready. Confirm SETTLED and the receipt; allocation and withdrawal are separate operations. |
| 11 | Holder / Bank | Cancel only the demonstration's EFT mandate when finished. Preserve statements and receipts. Cancellation of a mandate does not erase prior payments. |

## Hospital input template

| Field | Value / rule |
|---|---|
| Patient reference | `DEMO-PATIENT-<unique suffix>`; ordinary hospital reference, hashed by the application |
| Invoice number | `DEMO-INVOICE-<unique suffix>`; reuse this exact value in the claim |
| Authorized claimant wallets | The intended holder's full public address, e.g. `0x6575cBC8B95aBc6aB6628e7AeC176aF5769580F9` |
| Treatment type | `HOSPITALIZATION` |
| Diagnosis code | `GEN-001` for this synthetic fixture |
| Admission / discharge / invoice date | The actual synthetic treatment dates, consistent with the intended claim; do not reuse old November 3 dates blindly |
| Bill amount (ETH) | `0.00002` |
| Normal record / invoice status | `VALID` / `VALID`, after confirmed publication |
| Deliberate negative example | Set only a clearly labelled synthetic invoice to `SUSPICIOUS`, wait for its successful update and publication, then create its new verification request |

Use an invoice file whose visible fields match that synthetic record. Uploaded
PDF contents are not automatically authenticated by the current structured
registry checks. Encryption, hash integrity and a valid file type do not prove
clinical truth. A deliberate duplicate incident/type is a distinct on-chain
flagging test; it is not the same experiment as a negative Oracle outcome.

## If something is delayed

- A closed free-hosting service may need to wake. Readiness is a current sample,
  not a permanent uptime guarantee. The public chain continues while services sleep.
- The accelerated calendar uses ten-minute periods, opens payment eight minutes
  before due and has two minutes' collection grace. Check the current quoted
  period; a lapsed policy may offer reinstatement. Never change system/chain time.
- If a transaction mined but the API/UI failed, retain its hash and recover the
  original operation. Do not buy, claim, appeal or pay again to repair bookkeeping.
- Public RPC rate limits can delay reads and Oracle work. Do not keep every role
  dashboard polling while idle. Normal navigation away from inactive pages is
  useful; it does not turn an observed provider failure into a passing result.
- An Oracle request that misses quorum has a supported timeout action **after**
  its on-chain reveal deadline. Keep the same request; do not change thresholds
  or silently start another to hide the failed attempt.
- A green empty-document indicator is not evidence access. Verify linked files
  and actual authorized preview. If reconciliation is pending, keep it pending.

## Evidence and remaining acceptance

Canonical receipts and the coverage matrix are retained in the local
`verification-results/` directories referenced by the
[acceptance report](comprehensive-acceptance-2026-11-07.md).
Use [BaseScan manager activity](https://sepolia.basescan.org/address/0xBEc2a1B6215012cC7e59B0495F0d84c512003F96)
for Base, and the preserved L1 evidence's Etherscan links for Ethereum Sepolia.
These are block explorers, not the Coinbase exchange.

Automated injected-signing tests do not replace your final real MetaMask,
private mailbox, browser-key recovery and extension-warning acceptance. The
already-recorded manual November 3 email/OTP/EFT and payout observations remain
real historical evidence; a fresh post-fix private walkthrough is a separate gate.
