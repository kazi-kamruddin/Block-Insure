# Existing Base claim #4 — evidence recovery procedure

**Prepared only. Do not execute live recovery until explicitly authorized after publication review.** No live claim, file, attempt, grant or database row was changed during preparation. This is recovery of existing application linkage, not another claim submission or payout.

## Known historical identity — recheck first

- Network: Base Sepolia, chain 84532.
- Manager: 0xBEc2a1B6215012cC7e59B0495F0d84c512003F96.
- Policyholder: 0x6575cBC8B95aBc6aB6628e7AeC176aF5769580F9.
- Claim: 4; policy: 3; original claim version: 1.
- Attempt: 6ae975c5534eadc11b3f7b2d.
- Original transaction: 0x1c4f2f7d1db46bad89b316ae8f6975b136acde93abd895b62e46c0c5c376da60.
- Original block: 53815989.
- Historical diagnosis: verification-results/manual-claim-recovery-2026-11-03/diagnosis.json.

The claim was independently observed SETTLED with an on-chain document hash/CID. The original API attempt was TX_SUBMITTED and the UI showed zero linked documents because outer transaction addresses belonged to a sponsored executor. These are historical facts, not a new live inspection. The attempt/file may have since been recovered; inspect current state before any write.

Read-only follow-up at 12:36:10 UTC / 18:36:10 Bangladesh time on 6 November rechecked claim4/policy3/expected owner/status9 SETTLED. Its original public ciphertext was retrieved through the configured dedicated gateway (HTTP200, 6,503 bytes), and SHA-256 matched the on-chain document hash. No plaintext was accessed or saved, no attempt/file database row was read or changed, and no application recovery endpoint was invoked. Evidence: verification-results/transaction-evidence-followup-2026-11-06/claim4-ciphertext-readonly.json. Availability/integrity does not prove owner decryption or restored application linkage.

## Read-only preflight

1. Confirm the corrected backend revision and Base deployment identity. Confirm the browser is on https://block-insure.vercel.app with the policyholder wallet above; use a fresh authenticated session if required. Keep tokens, signatures and keys private.
2. Read GET https://block-insure-api.onrender.com/api/claims/submission-attempts/6ae975c5534eadc11b3f7b2d using that session.
3. Confirm wallet, policy, deployment scope, saved transaction hash, primary document ID and full document IDs/count match. Inspect the existing file's hash, CID, claim-version/envelope ownership and retained encryption metadata. Do not print or export key capsules/signatures/private keys.
4. Read claim #4 and its receipt. Confirm the original manager ClaimSubmitted event, exact policy/holder/facts and primary ciphertext hash/CID. Check the receipt succeeded. Current policy cancellation does not justify replacing an already settled claim's evidence.
5. If COMPLETED with the correct immutable bundle, perform read/decryption verification only; do not create another file or claim. If the attempt/file is missing or conflicts with an existing bundle, stop and diagnose. Do not fabricate replacement attempt metadata or overwrite a sealed set.

The attempt GET route can repair bookkeeping for an unsealed preparation in AUTHORIZED/UPLOADING/UPLOADED state. Claim #4 was historically sealed and TX_SUBMITTED, so that branch should not apply. For a strictly read-only preflight, inspect the narrowly projected existing attempt in the database first and confirm TX_SUBMITTED/COMPLETED plus sealed metadata before invoking GET; stop if its state differs. No such database or API call was performed in this batch.

## Authorized recovery operation — later, not performed now

With the same authenticated holder session, POST an empty JSON object to:

https://block-insure-api.onrender.com/api/claims/submission-attempts/6ae975c5534eadc11b3f7b2d/reconcile

Use the application's recovery control where available. This API call needs authorization but does not require a new on-chain transaction, premium, Oracle request, policy purchase or payout. It verifies the existing receipt and retained file, binds all original uploaded slots, appends idempotent evidence entries, seals the original version's bundle and marks the original attempt completed.

If operator browser-console execution is necessary after authorization, this uses the existing session without printing its token:

```javascript
const response = await fetch('https://block-insure-api.onrender.com/api/claims/submission-attempts/6ae975c5534eadc11b3f7b2d/reconcile', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('blockinsure_jwt')}` },
  body: '{}',
});
const result = await response.json();
console.log({ status: response.status, success: result.success, claimId: result.claimId, attemptStatus: result.attempt?.status, message: result.message });
```

A pending response is not permission to resubmit the claim. An ownership/hash/version/bundle conflict is not a reason to delete or re-upload evidence. Stop on conflict and retain the original files, transaction and diagnostic evidence.

## Verify completion

- Claim remains #4, policy #3, original transaction unchanged, SETTLED; no new claim/payout transaction.
- Original attempt is COMPLETED, claimId=4; original file IDs/hash/CID/capsule/envelope/version are preserved.
- Correct original file count, one sealed claim-version-1 bundle, and one addition event per original file plus one seal event.
- A repeated reconciliation returns the same linkage without duplicate evidence or new transparency events. Check counts/manifest before and after.
- Open/download the original plaintext as owner using the existing browser identity, or restore the existing encrypted identity backup first. Do not generate a replacement identity or rotate keys to mask a decryption failure.
- If the gateway is unavailable, preserve the CID/ciphertext and investigate retrieval separately; linkage alone is not successful decryption.

Claim #4 was automatically processed and may have no assigned auditor panel. Do not create a panel on this settled claim to prove reviewer access. Assigned-reviewer decryption, wrong-role denial, revocation and version boundaries are verified on the separate local manual-review fixtures; hosted reviewer acceptance uses a legitimately assigned review claim.

## Evidence boundary

Local metadata recovery, cryptographic browser checks and the exact live recovery plan are separate evidence categories. The actual claim #4 recovery and its plaintext verification remain PENDING until explicitly authorized and executed on the hosted revision.
