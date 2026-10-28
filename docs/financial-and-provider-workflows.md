# Financial and provider workflows

This describes the completion Phase 1 protocol. It requires a **new deployment**;
it is not a migration of existing policies or an instruction to reset a database.

## Hospital staff and source records

An administrator signs in with SIWE and opens **Administration → Hospital Staff**.
They provision a username, display name, strong password and contracted hospital
assignment. Staff open `/hospital/login` with an ordinary browser; no wallet
extension, signing key, transaction or gas is required. Passwords use salted
scrypt. Two-hour staff sessions have a separate JWT audience and authentication
method from SIWE. Sign-out, an operator password reset or an access-status change
revokes existing staff sessions. Every request also checks current hospital
membership and suspension status.

Staff can read and maintain only their hospital's records. The insurer's
authenticated administrator has a paginated, audited read-only source endpoint:
`GET /api/hospitals/insurer/records/:hospitalId`. A staff session cannot acquire
wallet, insurer, bank or auditor privileges. Provisioning and record changes
record the actor's staff and hospital identifiers without copying clinical
payloads into the action log.

New records hash local references with an explicit namespace:

```text
invoiceHash = keccak256(abi.encode("BLOCK_INSURE_INVOICE_V2", hospitalId, localInvoiceNumber))
patientHash = keccak256(abi.encode("BLOCK_INSURE_PATIENT_V2", hospitalId, localPatientReference))
```

Hospital IDs are trimmed and uppercased; local references are trimmed and remain
case-sensitive. An equal patient number at another hospital does not identify the
same person. Explicit claimant-wallet associations are maintained by the hospital;
they are prototype patient authorization, not independent KYC or clinical proof.
The source model has a hospital/invoice compound unique key. Historical research
records retain their original hashes. Authorized application lookups resolve the
record's actual invoice hash by hospital and invoice number, so old records are
not silently reinterpreted as new ones.

An insurer-operated publisher replicates source records to the two worker
collections, archives immutable canonical snapshots and commits a Merkle root.
Record edits remain visibly pending until publication succeeds. Revisions and
conditional updates prevent publication from clearing a newer unsaved revision.
Identity version 2 is included in new canonical payloads and in both proof
reconstruction paths. Earlier payloads and archives remain unchanged.

The new Oracle lifecycle has no per-claim hospital-wallet attestation gate.
Workers still require a contracted provider, the pinned committed record,
patient authorization and integrity/model checks. Missing or unavailable evidence
cannot automatically approve a claim; failed or timed-out Oracle processing uses
the existing manual-review recovery path. The legacy hospital registry is an
inactive compatibility component, not the source of current staff authority.

A publisher commitment proves integrity and publication by the configured
operator. It does not prove that a hospital's source facts are medically true.
Both workers ultimately rely on the same institution-maintained data source.

## Offers, acceptance and issued rules

The application presents published economic rules rather than selecting an
illustrative profile from the package name. Waiting periods, eligible service
codes, claim deadline, deductible, share and maximum claim come from the
configured contract rules. Existing policies use their immutable issued snapshot,
paid coverage intervals and remaining aggregate coverage.

One primary `HOSPITAL_BILL` commitment is supported in this phase. Unsupported
document configurations are not offered for application purchase. Additional
encrypted evidence belongs to the subsequent evidence-bundle work. Plaintext
authenticity is not established by the declared document type or commitment count.
Pre-existing-condition underwriting is outside this product's implemented scope.

`purchasePolicyWithTerms(packageId, expectedIssueHash, documentHash)` checks the
expected package/rule offer and stores the accepted document hash with the issued
policy. The API preserves the accepted document preimage under the deployment,
wallet, package and hash. A changed offer is rejected. Partially created packages
are unavailable in the public catalog until complete supported rules exist;
publication failure reports the created package ID and attempts to disable it.
Recover rules using the authenticated
`POST /api/admin/policy-packages/:id/economic-rules` endpoint, then reactivate the
same package. Do not blindly create a second package after a lost response.

The low-level `purchasePolicy` entry point remains available with the contract's
published/default rules for protocol clients and fixtures. It does not claim
application document acceptance. Such a policy is explicitly marked as lacking
an application document binding. Separate optional benefits enrollment is not
part of the medical document's promise.

Settlement applies the deductible before the insurer's share. If the resulting
liability exceeds remaining coverage, the contract rejects the claim rather than
silently capping the payment. Previews disclose their advisory status.

## One installment schedule

| Rule | Behavior |
| --- | --- |
| First payment | Advertised package premium at purchase, covering the first period or the entire term if shorter than 90 days |
| Periods | Fixed 90-day periods anchored to the purchase timestamp |
| Payment window | Only the next unpaid installment, from 30 days before its due date |
| Early payment | Extends to the scheduled period end; it never restarts the calendar |
| Short final period | A subsequent partial period is prorated by scheduled days, rounded up in wei |
| Grace | Seven-day collection window; unpaid medical coverage still stops at the due date |
| Reinstatement | Pays the current calendar period at its scheduled price; no retrospective coverage or charge for skipped periods; issued reinstatement waiting period applies |
| Term end | No further collection after all periods are paid or the term expires |

For a 365-day policy, periods are `[0,90]`, `[90,180]`, `[180,270]`,
`[270,360]`, and `[360,365]` days from issue. The fifth installment is
`ceil(premiumWei × 5 / 90)`. There is no unlimited prepayment account or mechanism
for inflating installment counts to unlock optional benefits.

Wallet, manual OTP and EFT all submit the **expected installment ID**. The chain
rejects stale identifiers and incorrect native amounts. A manual payment therefore
cannot silently become authorization for another period after EFT wins a race.
Standing instructions derive collection dates and prices from this same schedule.

Financial operation identity includes chain ID, manager address and the manager's
creation-block hash, followed by policy and installment. The block hash separates
fresh local chains even when addresses and chain ID are reused. Configure the
correct positive `CONTRACT_DEPLOYMENT_BLOCK` when using this release.

## Simulated BDT gateway with test-ETH settlement

The BDT account ledger, ownership association, bank review and conversion are
simulated. No real account ownership check, bank debit rail or foreign-exchange
trade is performed. The fixed illustrative quote is **100,000 BDT per test ETH**;
BDT minor units round to the nearest poisha. Quote units and actual native units
are stored separately. Email OTP proves access to the configured mailbox, not
bank ownership or legal identity.

A funded, authorized gateway signer supplies test ETH and pays gas. Its atomic
payable registry call transfers the quoted native value to the medical manager
and credits exactly that installment, or reverts both. The user's wallet does
not fund this signer implicitly. The Banking screen exposes gateway readiness
and balance. The medical manager, claim payout accounting and optional benefits
vault remain separate.

Each operation conditionally reserves simulated BDT with an atomic account
marker. A unique deployment/policy/installment key coordinates workers. The
service saves signed transaction bytes, their hash and a uniquely reserved signer
nonce **before broadcast**. Restart recovery re-broadcasts those exact bytes and
reconciles the canonical receipt. It never invents another reference for an
unknown outcome. Reservations, refunds, finalization and mandate debit counts are
idempotent across a crash between database writes.

An unknown RPC response leaves status `PROCESSING`, not `FAILED`. Pending
operations are reconciled every five seconds. A preparation failure without a
durably signed transaction can restore the reservation; a confirmed reverted
transaction can restore it exactly once. A confirmed successful settlement cannot
be refunded merely because a later database write or notification failed.
An unresolved broadcast, nonce conflict or underfunded gateway remains actionable
as a pending operation: restore gateway/RPC readiness and reconcile the existing
operation rather than creating a compensating debit. The gateway signing wallet
is dedicated to this service; external transactions must not reuse its nonces.

`BANK_SETTLEMENT_CONFIRMATIONS` defaults to 1 on local Hardhat and 12 on hosted
chains. These are bounded prototype confirmation rules, not a guarantee against
arbitrarily deep chain reorganizations. Real payment processing, legal compliance,
production FX, custodial operations and institutional availability are outside
this academic prototype's scope.

## Version and recovery boundaries

Oracle commitments bind chain ID, coordinator address, submitting Oracle address,
request, claim/registry/model versions, result and salt. Copying another eligible
worker's commitment and reveal cannot supply the second confirmation. Result
digests still permit two independent workers to agree on the same assessment.

The Phase 1 package is `xgboost-protocol-v2.json`; trained XGBoost weights and
threshold remain unchanged. The old v1 artifact and NB artifacts are retained as
historical evidence. A new contract/worker release must be deployed together.
Do not attach the new commitment encoder to an older coordinator or treat a
preserved historical artifact as permission to change in-flight requests.

Use a separate application database for a fresh release. An existing collection
may still have the old global `invoiceNumber_1` unique index. Do not run a broad
index synchronization or drop historical collections. Export/review any intended
data migration explicitly; a new database creates the correct compound index
without altering Atlas or previous evidence.

Later completion phases cover the full encrypted evidence bundle, auditor-access
preparation, appeal recovery, optional-benefit scope and final hosted deployment.
Passing the Phase 1 checks does not certify those later workflows as finished.
