# Evidence, review and recovery

This release requires a new compatible contract deployment and a separately
selected application database. Its directory version is
`BLOCK_INSURE_COMPLETION_PHASE2_V3`. Do not attach these services to an old
coordinator/adjudicator or reset existing Atlas data to make them compatible.

## Encrypted submissions

A claim contains one required primary hospital invoice and up to four optional
supporting PDFs, JPEGs or PNGs. Each original file is limited to 8 MiB; the initial
bundle is limited to 20 MiB. Encrypted upload limits account for the authenticated
encryption envelope. An appeal can add one bounded attachment, with at most seven
files in a review set across the ordinary appeal and one access-preparation retry.

The browser encrypts each file separately with AES-256-GCM and protects its key
with Recrypt PRE. Associated data binds deployment, submission/claim identity,
source claim version, uploader, document type, slot and unique file identity.
The server stores ciphertext, encrypted key capsules and metadata. It cannot
verify that encrypted bytes contain a genuine invoice from their MIME declaration.
Optional pictures support human inspection; the XGBoost pipeline evaluates
structured billing/claim context and does not perform image or PDF recognition.

The ordered evidence manifest binds all file references, ciphertext hashes,
authenticated-metadata hashes and source versions to the deployment and claim
version. Sealing is immutable. A later appeal constructs another manifest and can
reference existing encrypted files without rewriting their original envelopes.
The initial on-chain claim still commits its primary file; the manifest has a
signed transparency record and later tree anchoring. Manual-review activation
also commits the exact reviewed set hash on chain. These are distinct guarantees.

Partial uploads remain attached to the original attempt. Use **Continue an
unfinished claim** to reselect missing files, or explicitly continue with the
uploaded contiguous set. No optional selected file is silently discarded.
Before wallet submission the server seals the uploaded slots and retains the
attempt without a TTL. The application persists the returned transaction hash;
recovery can also match the exact primary commitment in bounded on-chain events
if the browser disappears before recording that hash. An unknown result stays
pending. Do not automatically resubmit or delete evidence after a network error.

Unsealed upload authorizations last 24 hours; finish or explicitly abandon partial
uploads within that window. Sealed wallet-submission records do not expire. MongoDB
TTL expiry is not Pinata deletion: expired orphan ciphertext pins require operator
cleanup, and unpinning cannot recall copies already retained elsewhere. This
prototype does not claim an automatic storage-retention/erasure service.

The deployment-binding record refuses reuse of an evidence database on a different
chain/manager creation-block identity. Explicit clean setup clears the new
collections only under the normal reset safeguards; ordinary startup never does.

## Reviewer access and voting

Routing to manual review snapshots exactly four active auditors. Assignment
starts a maximum three-day access-preparation period; the substantive voting
deadline is initially zero. The panel remains fixed during activation.

Each auditor prepares or restores their encryption identity from their workspace.
The claimant uses **Authorize assigned reviewers** once for every file and all
four assigned recipients. The backend checks owner, deployment, claim version,
manifest, recipient identity versions and transform envelopes. A durable batch
stores the original authorization before individual grant materialization.
Partial materialization and activation resume from that batch after restart.

The insurer operator attests technical availability and submits the activation
transaction. The chain binds the evidence-set and grant commitments, then starts
the full three-day voting period. Blockchain cannot inspect MongoDB or prove that
an auditor read or understood evidence. The operator remains a trusted availability
boundary; this transaction grants no power to change the quorum outcome.

Before activation, direct contract votes fail as well as disabled UI actions.
After activation, three approvals allocate payout, two rejections reject, and
expiry without quorum rejects. Approval, funding, allocation and withdrawal remain
separate states. Payouts use the existing pull-payment pattern.

Once authorization is stored, the claimant can close their browser. Assigned
auditors later retrieve transformed capsules and decrypt in their own browsers.
No claimant master key is given to the backend. Another wallet, hospital staff or
an unassigned auditor cannot use these grants. Grants apply to the current sealed
set and version, including original files explicitly carried into an appeal.

The underlying PRE transform key delegates between encryption identities; file and
claim restrictions are enforced by the authenticated service. It is not a separate
mathematical per-file capability. The thesis must retain that backend authorization
trust assumption, including the risk of a compromised proxy colluding with a
recipient that already holds a relevant delegation. Encryption is not a claim that
the proxy can ignore its own access rules without consequences.

Revocation blocks supported future transformations, not already downloaded
plaintext. Explicit owner resumption can restore the same pinned authorization;
a background retry never silently reverses revocation. Browser key loss can use
the existing encrypted backup. Registered identity rotation invalidates the old
key-version grant and never changes the panel or resets voting time. Restore the
original supported identity where possible; otherwise the bounded expiry/recovery
path applies. Continued availability after activation is not guaranteed by the
initial readiness attestation; three remaining reviewers can still reach quorum.

If preparation expires, anyone can finalize it as **evidence access incomplete**.
The claim reservation is released, no vote is fabricated and no fraud/reputation
judgment is made. One preparation retry may create a new claim version without
consuming the ordinary appeal quota. Further retries use the ordinary bounded
appeal allowance and the existing policy/invoice eligibility rules. There is no
unlimited reservation or retry loop.

## Appeals and anchoring

Appeal intent is stored before correction transactions. Hospital and treatment
identity remain fixed; supported invoice/amount corrections are recorded on chain.
An optional attachment is retained under the next version. A sealed appeal records
its exact reason payload/hash before requesting the wallet transaction.

If a transaction mines but API registration is lost, **Recover appeal registration**
matches the existing event, verifies signer/target, version and committed facts,
and idempotently completes metadata and evidence-set registration. It does not
consume another appeal round. Historical rounds remain separately identified by
deployment, claim and claim version. Old votes and cryptographic grants do not
authorize the new version.

A failed appeal transaction must match the saved signer, contract and sealed
payload and have a canonical confirmed revert before recovery can reopen that
same payload for explicit user submission. A changed claim version prevents retry.
The last reverted hash remains visible; an unknown result never clears the hash
or starts another transaction automatically.

Evidence heads form a signed predecessor chain. Recovery anchors pending heads
in order, verifies already-mined anchors and reconciles canonical receipts into
local records. Signed transaction bytes and hash are saved before broadcast.
A lost response remains pending and reuses those bytes. Local confirmation depth
is one; hosted depth is twelve, without protection against arbitrarily deep
reorganizations. The evidence operator account must be coordinated with other
transaction producers; unknown nonce conflicts remain pending for investigation.

Receipts distinguish logged inclusion, signed heads and canonically verified
anchors. A signed or included event must not be presented as already anchored.

## Cancellation refunds and product scope

Death and maturity product publication is disabled in the new contract. Their
historical code/data is retained, but they are absent from enabled product promises
and the beneficiary workflow. This release implements healthcare cover with an
optional bounded cancellation refund, rather than a life/savings product.

Refund terms require a policy longer than 90 days, at least two actual scheduled
paid installments and a rate no greater than 50% of premiums paid. It is a fixed
contractual refund, not an actuarial unused-premium calculation or investment
return. The holder cancels, accepts the optional schedule and requests insurer
review. Later publication does not silently change the accepted schedule.

Refund approval reserves only available funds in the separate refund vault.
Allocation waits until outstanding medical reservations are resolved. Allocation
does not transfer money: the holder withdraws once. Cancellation closes future
medical intervals; incidents within paid intervals retain their original reporting
deadline, including after a refund. Medical run-off exposure and its reserve
remain distinct from the separate refund liability.
The same covered-incident claim retains its supported correction/appeal path after
a refund; cancellation is not a new reason to erase an existing medical appeal.
Reserving a claim after exposure closure adds its known liability back to active
exposure. Rejection releases it, an appeal re-reserves it, and settlement removes
it once; future coverage intervals remain closed.

The request remains allocated after the aggregate wallet withdrawal. The UI shows
the separate confirmed wallet withdrawal receipt rather than inventing a per-request
withdrawn state. That convenience receipt searches the latest 5,000 blocks; it is
not a complete historical statement or a per-request payment attribution.

## Institution and privacy boundaries

Hospital staff maintain source records without wallets. Insurer administrators
have audited read access to contracted records. Auditors receive assigned-claim
evidence, not unrestricted clinical-registry browsing. The two Oracle workers
still share institutional source/publisher trust. Their agreement proves consistent
execution, not independent clinical truth. Public on-chain claim metadata remains
public; attachment encryption is not whole-claim anonymity. Reputation is
observational and never replaces the fixed quorum.

Bank balances, ownership, debit rails and FX remain simulated. Their gateway settles
actual funded test ETH using the shared installment model. Email proves mailbox
access, not bank ownership or a real debit. Automated mail uses a local provider
stub; actual wallet/mailbox rehearsal and public deployment remain release tasks.

## Decisions to defend

Auditor selection is a deterministic cyclic slice of the active pool, starting
at `keccak256(abi.encode(claimId, claimVersion)) % pool.length`. It is predictable
and does not uniformly sample every possible subset. The bounded institutional
pool and exact snapshot are the implemented tradeoff; no randomness, Sybil
resistance or collusion-proof committee selection is claimed.

Votes are public and sequential. The third approval or second rejection ends
the review, so later assigned auditors may not vote. Reputation records agreement
with the resulting quorum, not independently verified medical accuracy. Public
votes permit herding. This is an auditable institutional adjudication rule, not
a new Byzantine-fault-tolerant consensus protocol or independent clinical panel.

The administrator controls membership/configuration, the source publisher and
technical access activation. Those powers can affect availability and future
participants even though the administrator cannot cast arbitrary reviewer votes
or override the fixed thresholds. Multisig, staking/slashing and independent
institutional governance remain production/future-work questions.

XGBoost remains the frozen structured-context model. Integrity checks and its
selected threshold influence automatic routing; OOD/conformal uncertainty alone
does not force review. Exact SHAP explains the model margin, not medical causality.
Admin assessment is advisory; viewing it creates no transaction. Historical NB
is retained only for supported requests pinned to that identity. Source records,
engineered action labels, missing history and calibration limitations remain
disclosed; this work adds no natural-fraud labels or superiority claim.

Workers persist each first decision for its exact request/deployment/model before
commitment. That supports replay/restart but makes backend availability a liveness
dependency. Brief context/API failures receive bounded retries before a first
decision is pinned. Persistent failures remain negative verification/manual-review
or timeout outcomes. Restart never replaces a stored first decision just to obtain
agreement or a preferable score. Old v1/v2 packages are historical artifacts;
this new v3 worker is installed with its new deployment, not switched onto pending
old XGBoost requests. Frozen NB dispatch remains supported.

Document hashes detect reuse of identical ciphertext. Encrypting the same original
again with fresh randomness produces another ciphertext/hash; no universal
plaintext-duplicate detector is claimed. Invoice identity, patient authorization
and structured record checks provide different duplicate/eligibility controls.
