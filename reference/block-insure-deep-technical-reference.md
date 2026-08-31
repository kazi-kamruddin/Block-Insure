# Block-Insure Deep Technical Reference

> A code-oriented companion to [`block-insure-current-project-overview.md`](block-insure-current-project-overview.md).
>
> This document is intentionally more detailed than the supervisor overview. It explains the implementation boundaries, state machines, data contracts, algorithms, transaction choreography, operational assumptions, and research interpretation of the current repository.

**Repository:** `Block-Insure`  
**Reference directory:** `reference/` (singular)  
**Audience:** thesis supervisor, examiner, implementer, reviewer, and future maintainer  
**Authority rule:** current source code, deployment scripts, tests, and frozen artifacts override older prose

**Last source audit:** 2026-08-29 against repository `HEAD` `7d941aa6a85eebca1ae42026f0c26d9417fc4b25` plus the current research-artifact working-tree update

**Current research manifest:** schema 4, reproducibility hash `6a99593b052be9f99d439636039395f2c60760415c16e41a478da56869853ca0`

> **Hybrid and paper-evidence update (2026-08-29):** this reference now covers the complete `blockinsure-hybrid-v1.2.0` architecture, 558,211-claim offline study, 5,000-record runtime registry, provider-risk model, comparator and ablation experiments, provider bootstrap intervals, controlled-attack routing study, reserve/evidence benchmarks, current coverage and mutation results, and the final live browser workflows. Source code and frozen JSON/CSV artifacts remain authoritative when a timing or generated timestamp changes.

---

## 0. How to read this reference

### 0.1 Three levels of truth

This project contains three kinds of information.

1. **Protocol truth**
   - Solidity storage and transitions.
   - Contract events and emitted transaction receipts.
   - On-chain hashes, balances, roots, and role assignments.

2. **Operational truth**
   - Backend projections and reconciliation records.
   - Oracle logs and health records.
   - Encrypted-file metadata and evidence-tree heads.
   - Notifications and audit exports.

3. **Research truth**
   - Public-secondary data-adaptation and weak-label assumptions.
   - Controlled synthetic attack-generation assumptions.
   - Model artifacts and evaluation metrics.
   - Gas and throughput experiments.
   - Historical design rationale in thesis drafts.

The backend can make an operational projection stale.

It cannot rewrite a mined contract event.

The model can make an advisory recommendation.

It cannot mint a payout without contract consensus.

An admin can publish a new registry root.

The request stores the root version that it selected.

### 0.2 What “current” means here

This reference describes the implementation after the five major protocol phases.

It does not describe every historical prototype state.

Old documents may still mention:

- Admin approval as the normal claim path.
- Boolean-majority oracle voting.
- Reputation-weighted oracle votes.
- An `APPROVED` claim enum value.
- A `NEEDS_MORE` auditor outcome.
- Optional or plaintext evidence handling.
- Old test counts, model sizes, thresholds, and contract sizes.

Those statements are historical unless the current source confirms them.

### 0.3 Terminology used in this file

| Term | Meaning in the current implementation |
|---|---|
| Manager | The `InsuranceManager` contract, not the backend admin |
| Coordinator | The `OracleCoordinator` contract |
| Economics | The `PolicyEconomics` contract |
| Adjudicator | The `ClaimAdjudicator` contract |
| Benefits module | The `PolicyBenefitsManager` contract |
| Registry | The hybrid healthcare-record Merkle registry (real-derived records plus controlled compatibility/attack data) |
| Evidence registry | The `EvidenceRegistry` contract and its off-chain evidence tree |
| Model | The advisory Bernoulli Naive Bayes pipeline |
| Request | An oracle verification request, identified by a coordinator request ID |
| Claim version | A versioned decision cycle; an appeal increments it |
| Root version | A historical registry snapshot version |
| Model version | The model identity hash/version bound to a request |
| Reservation | Coverage/liability reserved by `PolicyEconomics` |
| Vault | The adjudicator payout balance or benefits balance |

---

## 1. Project identity and research framing

### 1.1 The practical problem

An insurance claim requires several different kinds of trust.

The claimant must prove an event.

The insurer must apply the correct policy terms.

The hospital or external provider must supply a truthful record.

The fraud analyst must interpret anomalies.

The final decision must be funded.

An auditor must be able to explain the decision later.

In a conventional database, these concerns are often joined by a privileged workflow.

The person operating the workflow can become the effective source of truth.

Block-Insure separates the concerns into modules.

It makes the important monetary and state transitions contract-verifiable.

It keeps sensitive medical content off-chain.

It uses external observations without allowing one oracle to settle a claim alone.

It records a conservative manual path when automatic verification is unsafe.

### 1.2 The research proposition

The project tests whether a hybrid architecture can provide:

- Stronger evidence integrity than an unanchored application database.
- More explicit authority than a backend-only approval endpoint.
- Better confidentiality than storing medical documents on-chain.
- More reproducible model results than an undocumented score.
- More predictable economic behavior than ad hoc settlement code.

### 1.3 What the project does not claim

It does not claim that blockchain provides a real hospital record.

It does not claim that synthetic data proves clinical fraud performance.

It does not claim that two oracle processes prove real-world source independence.

It does not claim that browser storage is equivalent to an HSM.

It does not claim that an admin-controlled registry is decentralized governance.

It does not claim that the local Hardhat network is production infrastructure.

### 1.4 One-sentence thesis identity

> Block-Insure is a modular hybrid insurance protocol in which encrypted evidence, advisory risk analytics, Merkle-bound external records, exact multi-oracle consensus, deterministic auditor adjudication, and reserved on-chain settlement combine to produce an auditable claim lifecycle.

---

## 2. Complete architecture

### 2.1 Logical layers

The system is easiest to reason about as six logical layers.

| Layer | Main components | Primary job |
|---|---|---|
| Presentation | React, Vite, wallet provider, React Query | User actions, status displays, local encryption/decryption |
| Service | Express controllers/routes, auth, rate limits | API boundary, orchestration, reconciliation, notifications |
| Operational data | MongoDB models, IPFS/Pinata, evidence tree | Projections, encrypted bytes, logs, proofs |
| Intelligence | Feature engineering, Naive Bayes, calibration, evaluation | Advisory fraud-risk and research measurement |
| External observation | Oracle workers, hybrid registry API, Merkle snapshots | Separated registry reconstruction and result generation |
| Protocol | Solidity modules on an EVM chain | Authority, money, quorum, claims, votes, anchors |

### 2.2 Runtime process topology

```mermaid
flowchart TB
    subgraph Browser
        Claimant[Claimant UI]
        Auditor[Auditor UI]
        Admin[Admin UI]
        Wallet[Wallet signer]
        Crypto[Web Crypto + Recrypt WASM]
    end

    subgraph Service[Backend process]
        Express[Express API]
        Auth[SIWE/JWT middleware]
        Model[Risk model]
        Indexer[Blockchain indexer]
        Evidence[Evidence services]
        Mongo[(MongoDB)]
    end

    subgraph Chain[Hardhat/EVM chain]
        Manager[InsuranceManager]
        Economics[PolicyEconomics]
        Coordinator[OracleCoordinator]
        Adjudicator[ClaimAdjudicator]
        Benefits[PolicyBenefitsManager]
        EvidenceRegistry[EvidenceRegistry]
        Deployment[ProtocolDeploymentRegistry]
    end

    subgraph OraclePlane[Oracle plane]
        OracleOne[Oracle worker 1]
        OracleTwo[Oracle worker 2]
        Hospital[(Hybrid registry snapshots)]
    end

    subgraph Storage[Content storage]
        IPFS[(Pinata/IPFS encrypted bytes)]
    end

    Claimant --> Wallet
    Auditor --> Wallet
    Admin --> Wallet
    Claimant --> Crypto
    Auditor --> Crypto
    Claimant --> Express
    Auditor --> Express
    Admin --> Express
    Express --> Auth
    Express --> Model
    Express --> Evidence
    Express --> Mongo
    Express --> Manager
    Indexer --> Manager
    Indexer --> Coordinator
    Indexer --> Adjudicator
    Indexer --> Economics
    Indexer --> EvidenceRegistry
    Manager --> Economics
    Manager --> Coordinator
    Manager --> Adjudicator
    Manager --> Benefits
    OracleOne --> Hospital
    OracleTwo --> Hospital
    OracleOne --> Coordinator
    OracleTwo --> Coordinator
    Evidence --> IPFS
    Evidence --> EvidenceRegistry
    Deployment -. identifies .-> Manager
    Deployment -. identifies .-> Coordinator
```

### 2.3 The direction of authority

The normal direction of an accepted claim is:

```text
Browser evidence
  -> backend encrypted transport
  -> policy/economics validation
  -> manager claim state
  -> oracle observation
  -> coordinator exact consensus
  -> manager payout allocation
  -> adjudicator vault
  -> claimant withdrawal
```

The normal direction of a failed claim is:

```text
Browser evidence
  -> policy/economics validation
  -> fraud/registry anomaly
  -> oracle conflict/false/timeout
  -> manual-review routing
  -> four auditor assignments
  -> quorum or expiry
  -> payout allocation or rejection
```

The backend orchestrates these actions.

The contracts enforce the permitted order.

### 2.4 Data placement matrix

| Data | Browser | Backend/Mongo | IPFS | Chain |
|---|---:|---:|---:|---:|
| Plain medical document | Temporary only | No | No | No |
| Encrypted medical bytes | Optional cache | Metadata only | Yes | No |
| Evidence CID/receipt | Yes | Yes | Address | Hash/CID reference |
| AES key | Encrypted locally | No plaintext | Wrapped capsule only | No |
| Policy terms | Read cache | Projection | No | Yes |
| Claim amount/status | Read cache | Projection | No | Yes |
| Model probability | Display | Yes | No | Model identity only |
| Registry leaf | Proof workspace | Snapshot | No | Root only |
| Oracle commitment | No | Log | No | Yes |
| Oracle reveal | No | Log | No | Yes |
| Auditor vote | Wallet UI | Projection | No | Yes |
| Evidence tree root | Display | Signed head | Optional artifact | Anchor |

### 2.5 Failure containment

If MongoDB is unavailable, the chain remains the economic authority.

If IPFS is unavailable, new evidence upload should fail safely.

If the frozen model artifact is missing or fails its identity checks, the affected
service/worker fails instead of substituting an automatic positive verdict.

If one oracle is unavailable, the request waits until the commit/reveal deadlines.

If all oracles disagree, the coordinator records a conflict.

If the manager cannot fund a liability, the claim becomes `FUNDING_REQUIRED`.

If an auditor does not vote, deadline finalization remains possible.

If the claimant does not withdraw, the vault retains the pull balance.

---

## 3. Repository map and build graph

### 3.1 Top-level directories

| Path | Current role |
|---|---|
| `contracts/` | Hardhat project, Solidity sources, tests, deployment scripts, generated ABI/artifacts |
| `backEnd/` | Node/Express service, controllers, models, services, tests, model/evaluation artifacts |
| `frontEnd/` | React/Vite client and wallet/evidence UX |
| `oracle/` | Oracle worker runtime and protocol helpers |
| `scripts/` | Cross-project setup, launcher, preflight, verification, reproducibility tooling |
| `docs/` | Operational notes, security/migration notes, methodology drafts |
| `reference/` | Historical thesis material and current standalone references |
| `.dev-logs/` | Local redacted observability output when enabled |

### 3.2 Important root scripts

| Command | Meaning |
|---|---|
| `npm run setup:local` | Destructive local reset plus fresh deployment/configuration |
| `npm run setup:hybrid` | Validate and install the 5,000-record hybrid registry, then deploy and verify |
| `npm run preflight` | Environment/configuration/repository readiness checks |
| `npm run doctor` | Preflight plus synchronization and repository-artifact checks |
| `npm run install:all` | Reproducible `npm ci` across root, backend, contracts, frontend, and oracle packages |
| `npm run dev:all` | Start/reuse the expected local service topology |
| `npm run dev:hybrid` | One-command managed hybrid bootstrap and service launch |
| `npm run dev:observe` | Start development services with redacted event observation |
| `npm run verify:all` | Cross-project verification suite |
| `npm run verify:full` | Verification plus runtime synchronization checks |
| `npm run verify:sync` | ABI, address, bytecode-size, and configuration synchronization checks |
| `npm run test:e2e` | Read-only browser smoke/accessibility checks after E2E preflight |
| `npm run test:e2e:workflow` | Headed state-changing purchase/evidence/claim/auditor workflows |
| `npm run deploy:benefits:local` | Deploy the benefits extension without the complete clean reset |
| `npm run research:all` | Regenerate Phase 0–4 studies, charts, invariants, mutation results, and manifest |
| `npm run research:paper-evidence` | Generate paper-facing JSON, CSV, and SVG evidence |

### 3.3 Contract package

The contracts package uses:

- Solidity `0.8.26`.
- Hardhat `2.28.x`.
- Ethers `6.16.x`.
- OpenZeppelin `5.6.1`.
- Mocha/Chai for tests.
- Solidity coverage instrumentation.
- Optional Slither analysis when installed.

### 3.4 Backend package

The backend uses:

- Express `5.2.1`.
- Mongoose `9.6.2`.
- Ethers `6.16.0`.
- Axios `1.16.1` for external HTTP calls.
- SIWE `3.0.0` for wallet authentication.
- JSON Web Token `9.0.3` for sessions.
- Helmet `8.2.0` and CORS `2.8.6` for HTTP hardening.
- Multer `2.1.1` for bounded uploads.
- Pinata integration for IPFS.
- Recrypt node binding `0.11.1` for proxy transformation.
- A Bernoulli Naive Bayes implementation and calibrated model artifact.

### 3.5 Frontend package

The frontend uses:

- React/React DOM `19.2.6`.
- Vite `8.0.12`.
- React Router `7.15.1`.
- TanStack React Query `5.100.14`.
- Ethers `6.16.0`.
- ESLint `10.3.0`.
- Browser Web Crypto.
- Recrypt WASM binding `0.7.2`.

### 3.6 Oracle package

The oracle process uses:

- Node.js.
- Ethers `6.16.0`.
- Axios `1.16.1`.
- dotenv `17.4.2`.
- Two instance-specific environment files.
- Per-chain/per-coordinator/per-oracle cursor files.
- Structured logs and heartbeat signatures.

---

## 4. Roles, identity, and authorization in detail

### 4.1 Application roles

The backend database role is one of:

- `USER`.
- `ADMIN`.
- `AUDITOR`.
- `ORACLE`.

The chain uses role bytes32 values.

The two role systems are related but not interchangeable.

### 4.2 Wallet authentication sequence

```text
Client requests nonce
  -> backend creates random 16-byte nonce
  -> backend constructs SIWE message
  -> wallet signs message
  -> backend verifies domain, URI, chain ID, nonce, and signature
  -> backend consumes nonce
  -> backend issues JWT with issuer, audience, JTI, and expiry
```

The nonce is single-use.

The signed message includes resources when configured.

The JWT default lifetime is one hour.

The implementation reads `AUTH_SESSION_TTL_MS` to configure that lifetime.
The currently retained `JWT_EXPIRES_IN` entry in `backEnd/.env.example` is not
read by `authController.js` and should not be cited as runtime behavior.

Logout persists the token JTI in `RevokedToken`.

### 4.3 Privileged request sequence

```text
HTTP request
  -> JWT signature/expiry check
  -> JTI revocation check
  -> user lookup and current database role
  -> on-chain role check for sensitive roles
  -> controller validation
  -> contract transaction or read
```

The backend does not trust a stale role field in a JWT.

The on-chain role check prevents a removed operator from continuing through an old session.

### 4.4 Contract roles

| Role | Typical authority |
|---|---|
| `ADMIN_ROLE` | Configuration, packages, roles, registry, funding, admin operations |
| `CLAIM_OFFICER_ROLE` | Operational claim/oracle/manual routing permitted by manager |
| `ORACLE_ROLE` | Oracle membership/worker identity |
| `AUDITOR_ROLE` | Eligibility for auditor workflows |
| `EMERGENCY_ROLE` | Emergency pause behavior where permitted |

The coordinator maintains an active oracle list.

The adjudicator maintains an active auditor list.

The manager remains the owner of its configured module relationships.

### 4.5 Rate limits and bounded inputs

The backend protects:

- Nonce requests.
- Login attempts.
- Claim submission checks.
- Wallet-level daily claims.
- Oracle API calls.
- Multipart uploads.

The default claim IP limit is five requests per fifteen minutes.

The default nonce limit is thirty requests per fifteen minutes.

The default login limit is fifteen requests per fifteen minutes.

The default per-wallet submission authorization cap is three attempts in a
rolling 24-hour window. Its self-reset endpoint is disabled unless
`DEV_ALLOW_CLAIM_LIMIT_RESET=true`, which is local-testing configuration only.

Uploads are limited to ten megabytes by default.

Allowed types include PDF, JPG, PNG, and configured binary/octet-stream evidence.

---

## 5. `InsuranceManager` implementation reference

Source: [`contracts/contracts/InsuranceManager.sol`](../contracts/contracts/InsuranceManager.sol)

### 5.1 Responsibility boundary

`InsuranceManager` is the claim-facing state machine.

It is not the package-rule calculator anymore.

It is not the auditor vault anymore.

It is not the evidence byte store.

It is the authority that connects those modules.

### 5.2 Major storage groups

The manager stores:

- Package definitions.
- Policy records.
- Claim records.
- Claim documents.
- Settlement records.
- Counters for package, policy, and claim identifiers.
- Used document hashes.
- Wallet/date/type duplicate keys.
- Oracle/coordinator address.
- Economics module address.
- Adjudicator address.
- Current model identity.
- Treasury balance through native contract balance.

### 5.3 Claim status enum

The current enum contains these ordinal values:

| Ordinal | Status |
|---:|---|
| 0 | `SUBMITTED` |
| 1 | `DUPLICATE_CHECKED` |
| 2 | `FRAUD_FLAGGED` |
| 3 | `ORACLE_PENDING` |
| 4 | `ORACLE_VERIFIED` |
| 5 | `ORACLE_FAILED` |
| 6 | `MANUAL_REVIEW` |
| 7 | `PAYOUT_READY` |
| 8 | `REJECTED` |
| 9 | `SETTLED` |
| 10 | `CLOSED` |
| 11 | `FUNDING_REQUIRED` |
| 12 | `APPEALED` |

There is no active `APPROVED` enum member.

`ClaimApproved` is an event retained as a compatibility/decision signal.

The payout path immediately chooses `PAYOUT_READY` or `FUNDING_REQUIRED`.

`CLOSED` is retained but is not currently assigned by an active transition.

### 5.4 Policy status enum

The current policy lifecycle includes:

- `PENDING_PAYMENT`.
- `ACTIVE`.
- `GRACE_PERIOD`.
- `LAPSED`.
- `CANCELLED`.
- `EXPIRED`.
- `RENEWED`.

`PENDING_PAYMENT` and `RENEWED` are retained enum members but are not assigned
by the current purchase/renewal implementation. A successful purchase is
created directly as `ACTIVE`.

The effective status can be derived from timestamps.

The stored status is synchronized lazily by refresh functions and transition operations.

### 5.5 Package creation

The admin creates a package with a premium and coverage definition.

The package also carries policy-level defaults.

The economics module can publish a richer rule schedule for the same package ID.

The package must exist before a policy can be purchased.

Deactivated packages cannot be newly purchased.

Existing policy terms remain the snapshot selected at purchase time.

### 5.6 Policy purchase

The purchaser calls `purchasePolicy` with the exact package premium.

The manager rejects an incorrect `msg.value`.

The policy receives a new numeric ID.

The economics module records a terms snapshot.

The first coverage interval is opened.

The waiting-period end is recorded.

The policy owner becomes the claimant authority for that policy.

### 5.7 Premium timing

The expected recurrence interval is thirty days.

The grace period is seven days.

The policy end date caps the computed due/grace dates.

`payPremium` records a premium payment.

`reinstatePolicy` pays the configured amount to revive a lapsed policy.

`cancelPolicy` is holder/admin constrained by the manager rules.

`deactivateExpiredPolicy` exposes an explicit expired-state operation.

### 5.8 Claim submission preconditions

`submitClaim` requires:

- A valid policy identifier.
- The caller to be the policy owner.
- A policy status that permits a claim.
- A non-future incident timestamp.
- A non-empty claim type.
- A non-empty hospital identifier/name.
- A non-empty invoice/document identity.
- A non-empty evidence hash/CID reference.
- A claim amount within the relevant policy constraints.
- The policy claim count below the per-policy limit.

The manager invokes economics validation/reservation before the claim advances.

### 5.9 Duplicate and structural checks

Duplicate protections include:

- Used document hash checks.
- Wallet/date/claim-type uniqueness.
- Economics-level invoice uniqueness.
- Policy-level maximum claim count.

A duplicate path is marked conservatively.

The manager calculates a structural verification confidence.

The confidence is not the backend fraud probability.

The score rewards facts such as:

- Active policy.
- Incident inside coverage.
- Amount inside coverage.
- Evidence/document presence.
- New document identity.
- Invoice uniqueness.
- Wallet/date/type uniqueness.

The score is capped at 100.

Successful oracle verification adds a bounded increment.

### 5.10 Oracle request gating

`requestOracleVerification` is allowed for the configured operational roles.

The claim must be `DUPLICATE_CHECKED` or `APPEALED`.

The manager creates the canonical query hash.

The query binds:

- Claim ID.
- Policy ID.
- Claimant wallet.
- Claim amount.
- Incident date.
- Claim type.
- Hospital identifier.
- Invoice identity.
- Document/evidence hash.
- Claim version.
- Model version.

The manager query hash does not include registry version/root. Immediately after
receiving that query, the coordinator snapshots its current registry version and
root into the `OracleRequest`; the worker result hash binds both the query hash
and that registry snapshot.

The manager moves the claim to `ORACLE_PENDING`.

### 5.11 Oracle finalization

Only the coordinator can call manager finalization.

The manager verifies that the request is associated with the claim.

The coordinator supplies the claim version and bound metadata.

On a verified result:

```text
ORACLE_PENDING
  -> ORACLE_VERIFIED
  -> calculate economics settlement
  -> allocate payout or record funding requirement
```

On a false/conflict/timeout result:

```text
ORACLE_PENDING
  -> ORACLE_FAILED
  -> record rejection reason
  -> set manual-review eligibility after routing delay
```

### 5.12 Manual-review routing

`sendToManualReview` can be called immediately by permitted operational roles.

After the configured eligibility time, the public wrapper can be used.

Only eligible failure/fraud states can be routed.

The manager calls `ClaimAdjudicator.startReview`.

The manager changes the claim to `MANUAL_REVIEW`.

### 5.13 Manual-review finalization

The adjudicator calls manager finalization.

An approved adjudicator result uses the same payout allocation path.

A rejected result calls economics release.

The manager records a decision hash and rejection reason.

The claim becomes `REJECTED` on the rejection path.

### 5.14 Payout allocation

The manager calls economics `calculateSettlement`.

The result contains insurer liability and claimant responsibility.

The manager compares its available balance with the insurer liability.

If sufficient:

```text
manager balance
  -> adjudicator payout allocation
  -> PAYOUT_READY
```

If insufficient:

```text
unfunded liability recorded
  -> FUNDING_REQUIRED
  -> later activateFundedClaim
```

The shortfall is emitted for UI/operations.

### 5.15 Claim funding activation

`activateFundedClaim` is permissionless after funding conditions are satisfied.

It moves the liability into the adjudicator vault.

It changes the claim to `PAYOUT_READY`.

It prevents the admin from silently editing the already calculated amount.

### 5.16 Withdrawal and settlement

The claimant calls `withdrawSettlement`.

The manager invokes adjudicator withdrawal.

The economics module settles the reservation.

The manager records a settlement record.

The claim changes to `SETTLED`.

The pull-payment design avoids a push transfer inside every complex state transition.

### 5.17 Appeal reset semantics

An appeal is claimant-only.

The appeal must target a rejected claim.

Economics reserves the appeal exposure.

The claim version increments.

The prior request reference is cleared.

The prior resolution fields are cleared.

The prior rejection reason is replaced by the new-cycle state.

The confidence score is reset/recomputed for the new cycle.

The adjudicator begins an appeal round.

The manager enters `APPEALED`.

The new oracle request binds the new version.

### 5.18 Manager events

Important events include:

- `PolicyPackageCreated`.
- `PolicyPackageUpdated`.
- `PolicyPackageDeactivated`.
- `PolicyPackageReactivated`.
- `PolicyPurchased`.
- `PolicyStatusChanged`.
- `PremiumPaid`.
- `ClaimSubmitted`.
- `DocumentAdded`.
- `ClaimFlagged`.
- `OracleRequested`.
- `OracleResultSubmitted`.
- `OracleTimedOut`.
- `ClaimApproved`.
- `ClaimRejected`.
- `ClaimAppealed`.
- `ClaimReopenedAfterAppeal`.
- `ClaimAppealFinalized`.
- `ClaimSentToManualReview`.
- `AuditorVoteCast`.
- `AuditorReputationUpdated`.
- `SettlementCalculated`.
- `ClaimSettled`.
- `ClaimClosed`.
- `ClaimDecisionRecorded`.
- `PayoutAllocated`.
- `ClaimFundingRequired`.
- `ClaimFundingActivated`.
- `SettlementWithdrawn`.
- `ManualReviewEligibilitySet`.
- `ClaimAdjudicatorConfigured`.
- `ContractFunded`.
- `ExcessWithdrawn`.
- `AuditorOutcomeObserved`.

### 5.19 Manager invariants

The following are intended invariants.

1. A nonexistent policy cannot be claimed.
2. A non-owner cannot submit a policy claim.
3. A claim cannot be oracle-requested twice in the same cycle.
4. An old claim version cannot finalize a new appeal.
5. Only the coordinator can submit a final oracle result.
6. Only the adjudicator can finalize manual review.
7. A payout cannot exceed the economics-calculated insurer liability.
8. A settled claim cannot be withdrawn again.
9. Excess manager withdrawal cannot violate the protected reserve.
10. A disabled package cannot be purchased.
11. A claim cannot be created after the policy terms forbid it.
12. A funding-required claim cannot activate before the manager has enough value.

---

## 6. `PolicyEconomics` implementation reference

Source: [`contracts/contracts/PolicyEconomics.sol`](../contracts/contracts/PolicyEconomics.sol)

### 6.1 Why this is a separate module

The manager is close to the EIP-170 bytecode limit.

Policy rule evaluation and accounting are high-value logic.

Moving them out reduces manager size.

It also makes the economic rule surface independently testable.

The module stores the manager address immutably.

### 6.2 Package rules

`PackageRules` may include:

- Rule version.
- Policy rule version hash.
- Allowed service codes.
- Excluded service codes.
- Waiting period.
- Claim deadline.
- Minimum document count.
- Deductible basis points.
- Deductible cap.
- Insurer-share basis points.
- Maximum claim amount.
- Formula/rule identity.
- Exclusion and required-document commitment roots.

Versions must increase strictly.

An update creates an auditable schedule.

It does not mutate the terms already snapshotted into an existing policy.

### 6.3 Policy terms snapshot

At purchase, the economics module records:

- Package ID.
- Rule version.
- Formula version.
- Coverage amount.
- Policy start/end.
- Claim deadline.
- Waiting period.
- Deductible/share configuration.
- Maximum claim.
- Versioned service-code allow/exclusion scope.
- Exclusion and required-document commitment roots.

This prevents silent in-flight rule substitution.

### 6.4 Coverage intervals

A policy has one or more coverage intervals.

An interval records:

- Start timestamp.
- End timestamp.
- Waiting-period end.

Closing an interval shortens its end timestamp; termination/exposure-closed
flags are stored separately per policy. `remainingCoverage` reflects unused
coverage after reservations and settled liability.

An interval can close when the policy ends or exposure is explicitly closed.

### 6.5 Claim validation order

The economics validation performs this order after its manager-only modifier:

```text
load policy terms
check policy holder equals claimant
check positive claim amount and snapshotted maximum
check non-future incident and claim deadline
check required document count
check invoice uniqueness
check a paid coverage interval, including waiting-period end
if a versioned rule exists: check exclusion, then allow list
calculate insurer liability
check remaining coverage
reserve exposure
```

The manager then performs its own duplicate and structural checks.

The two layers intentionally protect different invariants.

### 6.6 Settlement formula

The formula is deterministic.

Let:

```text
claimAmount = submitted amount
deductible = min(claimAmount * deductibleBps / 10,000, deductibleCap, claimAmount)
afterDeductible = claimAmount - deductible
insurerPays = afterDeductible * insurerShareBps / 10,000
claimantResponsibility = claimAmount - insurerPays
```

The actual Solidity implementation uses integer arithmetic.

Rounding behavior is therefore part of the protocol.

The research document should report the basis points and caps, not only a percentage label.

### 6.7 Reservation lifecycle

```text
no reservation
  -> validateAndReserveClaim
  -> active claim reservation
  -> releaseClaim on rejection
  -> settleClaim on withdrawal
```

An appeal creates a new reservation cycle.

The reservation is the economic backing for a possible liability.

### 6.8 Solvency configuration

The module tracks:

- Active exposure.
- Reserve ratio in basis points.
- Minimum capital buffer.

Approved unfunded liability is stored by the adjudicator and supplied as an
argument to `minimumTreasuryBalance`; it is not duplicated in economics
storage. `fundTreasury` emits a caller-supplied nonzero funding reference but
does not retain a reference mapping.

The protected balance conceptually includes:

```text
required balance
  = unfunded liability
  + minimum capital buffer
  + active exposure * reserve ratio / 10,000
```

`minimumTreasuryBalance` exposes this calculation.

Funding emits an auditable reference hash.

An underfunded claim does not disappear.

It remains a visible liability until funded or otherwise resolved.

### 6.9 Economics events

Important events include:

- `PackageRulesPublished`.
- `PolicyTermsSnapshotted`.
- `CoverageIntervalOpened`.
- `CoverageIntervalClosed`.
- `CoverageReserved`.
- `CoverageReleased`.
- `CoverageSettled`.
- `SolvencyConfigUpdated`.
- `SolvencyWarning`.
- `TreasuryFundingAttributed`.

---

## 7. `OracleCoordinator` exact-consensus reference

Source: [`contracts/contracts/OracleCoordinator.sol`](../contracts/contracts/OracleCoordinator.sol)  
Protocol mirror: [`oracle/protocol.js`](../oracle/protocol.js)

### 7.1 Coordinator responsibility

The coordinator is the protocol boundary between observations and claim state.

Oracles do not call the manager directly.

The backend does not finalize oracle results.

The coordinator validates commitment/reveal correctness.

It counts exact result digests.

It calls the manager only after finalization.

### 7.2 Request snapshot fields

An `OracleRequest` contains or is associated with:

- Request ID.
- Claim ID.
- Query hash.
- Claim version.
- Registry snapshot version.
- Registry root.
- Model version.
- Requested block/deadline data.
- Commit deadline.
- Reveal deadline.
- Expected oracle response count.
- Quorum threshold.
- Finalized flag.
- Outcome/result data.

The exact struct layout is defined by the Solidity source.

### 7.3 Registry snapshot fields

Each historical registry snapshot records:

- Snapshot version.
- Root hash.
- Tree/schema version hash.
- Publication timestamp.
- Publication block.
- Leaf count.

Snapshots are append-only by version.

Requests store the selected snapshot identity.

### 7.4 Consensus defaults

The local coordinator defaults include:

- Quorum threshold: two.
- Commit window: twenty-five blocks.
- Reveal window: twenty-five blocks.

Deployment/configuration can update the consensus settings subject to manager authorization.

The thesis should report configured values and not assume the defaults are immutable.

### 7.5 Request creation

The manager calls `createRequest`.

The coordinator checks:

1. The caller is the manager.
2. A current registry snapshot exists.
3. Enough active oracles exist for quorum.
4. The active-oracle count fits in `uint8`.
5. Query hash and model version are nonzero and claim version is positive.

The manager, rather than the coordinator, prevents a second request reference
for the same claim cycle. An appeal clears that reference and increments the
claim version before creating its new request.

The coordinator snapshots active oracle membership.

It also snapshots the quorum and expected response count.

### 7.6 Eligibility snapshot

The request stores an eligibility mapping.

An oracle active at creation is eligible for that request.

An oracle revoked after creation remains eligible for that request.

An oracle added after creation is not silently inserted.

This prevents the admin from changing the vote set mid-cycle.

### 7.7 Commitment construction

The commitment binds:

```text
requestId
claimVersion
registryVersion
verified verdict
resultHash
modelVersion
salt
```

The worker hashes the ABI-encoded values.

The salt prevents a third party from learning the answer before reveal.

The commitment is stored against the oracle address.

Duplicate commitments are rejected.

Late commitments are rejected.

Ineligible commitments are rejected.

### 7.8 Reveal construction

The reveal supplies:

- Request ID.
- Claim version.
- Registry version.
- Model version.
- Verified Boolean.
- Result hash.
- Salt.

The coordinator recomputes the commitment.

It rejects an incorrect salt.

It rejects changed metadata.

It rejects a wrong model version.

It rejects a wrong claim version.

It rejects duplicate reveals.

It rejects reveals after the reveal deadline.

The Solidity reveal function does not accept a registry root as a separate
argument. The request already stores that root, and the worker's semantic
`resultHash` binds it. Consequently, the coordinator enforces the opaque result
hash and the explicit claim/registry/model versions; it cannot decode and
independently inspect the root inside `resultHash`.

### 7.9 Reveal start condition

Reveal can start when:

- Every expected oracle has committed, or
- The commit deadline has passed.

This avoids waiting for an unavailable oracle forever.

The reveal deadline is derived from the configured window.

### 7.10 Exact result digest

The exact result digest binds the same semantic result across workers.

Conceptually:

```text
exactDigest = keccak256(
  verdict,
  resultHash,
  claimVersion,
  registryVersion,
  modelVersion
)
```

The Solidity encoding is `abi.encode(bool,bytes32,uint64,uint64,bytes32)` in
that order. Registry root and query hash are already transitively bound by the
worker-generated `resultHash`; they are not duplicated in `exactDigest`.

Two workers that disagree on any bound field do not share an exact digest.

### 7.11 Finalization outcomes

There are three important outcomes.

| Outcome | Condition | Manager result |
|---|---|---|
| Exact quorum | Same exact digest reaches threshold | Verified or false result according to the digest |
| Conflict | All relevant reveals complete but no exact digest reaches threshold | Conservative oracle failure |
| Timeout | Reveal deadline passes before finalization | Conservative oracle failure |

The coordinator calls the manager once.

The finalized flag prevents replay.

### 7.12 Permissionless timeout

`resolveTimedOutRequest` can be called by anyone after the reveal deadline.

Permissionless resolution prevents a stuck request from requiring an admin transaction.

The timeout is still a failure outcome.

It does not create a payout.

### 7.13 Coordinator events

Important events include:

- `OracleRequested`.
- `OracleCommitmentSubmitted`.
- `OracleResultRevealed`.
- `OracleRequestFinalized`.
- `OracleRegistrationUpdated`.
- `ConsensusConfigUpdated`.
- `RegistrySnapshotPublished`.

### 7.14 Coordinator invariants

1. An ineligible oracle cannot commit.
2. An ineligible oracle cannot reveal.
3. A commitment can be submitted once per request/oracle.
4. A reveal must hash to the stored commitment.
5. A reveal must match request metadata.
6. A request finalizes at most once.
7. A request cannot be finalized before a valid quorum/conflict/timeout condition.
8. A request cannot switch registry roots after creation.
9. A revoked selected oracle remains eligible for the selected request.
10. An old claim version cannot finalize a new appeal request.

### 7.15 Worker pseudocode

```text
poll coordinator events
load request
if request already finalized: stop
if this oracle is not eligible: stop
load local registry snapshot named by request
query hospital verification endpoint
reconstruct canonical leaf
verify Merkle path against request root
compare claim facts with record facts
compute verified verdict and result code
compute deterministic result hash
derive deterministic salt from oracle secret/request context
submit commitment before commit deadline
wait for reveal start
submit matching reveal before reveal deadline
record backend log and heartbeat
```

The worker does not trust a leaf hash returned by the hospital API.

It reconstructs the canonical leaf itself.

---

## 8. `ClaimAdjudicator` manual-review reference

Source: [`contracts/contracts/ClaimAdjudicator.sol`](../contracts/contracts/ClaimAdjudicator.sol)

### 8.1 Responsibility boundary

The adjudicator owns auditor assignment, votes, finalization, decision records, and payout vault operations.

The manager owns the claim's top-level status.

The adjudicator informs the manager of the final outcome.

### 8.2 Review record

A manual review includes:

- A storage key derived from claim ID and claim version.
- Four assigned auditor addresses.
- Vote values.
- Approval/rejection counts.
- Review deadline.
- Finalized flag.
- Approved flag.

The decision hash, rejection-reason code, decision time, claim version, and
appeal round live in a separate version-keyed `DecisionRecord`. The review
struct does not store a start timestamp, finalizer address, or free-form reason.

### 8.3 Auditor assignment

The assignment seed is derived from:

```text
keccak256(claimId, claimVersion)
```

Starting at that offset, the adjudicator takes four consecutive addresses from
the active-auditor array with wraparound.

The same claim/version therefore produces the same assignment for the same active list.

An auditor can verify whether they are assigned with `isAssigned`.

### 8.4 Vote values

The current vote constants are:

- `VOTE_VALID = 1`.
- `VOTE_INVALID = 2`.

There is no current `NEEDS_MORE` enum path.

One assigned auditor can vote once.

The vote must arrive before the deadline.

### 8.5 Quorum thresholds

The review finalizes when:

- Three valid votes are recorded, or
- Two invalid votes are recorded, or
- The deadline expires.

Expiry becomes a conservative rejection.

This asymmetric threshold allows a decision before all four seats respond.

The backend `GET /api/votes/claim/:claimId` response also computes a
reputation-weighted display summary. That summary is descriptive only and does
not finalize the review. Its service still contains a legacy `NEEDS_MORE = 3`
display bucket even though the contract rejects any vote except `1` or `2`.
Likewise, the response field `minimumVoters: 4` describes the four assigned
seats, not the actual 3-valid/2-invalid contract thresholds. Thesis claims and
decision explanations must use the contract thresholds above.

### 8.6 Manual review pseudocode

```text
manager routes eligible claim
adjudicator selects four auditors
adjudicator records review deadline
auditor checks assignment
auditor decrypts evidence locally if granted
auditor casts VOTE_VALID or VOTE_INVALID
if validCount >= 3: approve
else if invalidCount >= 2: reject
else if now >= deadline: reject timeout
else remain open
```

### 8.7 Decision records

The adjudicator records decisions by claim ID and claim version.

Appeals receive a new round.

The decision record includes:

- Claim version.
- Appeal round.
- Approval flag.
- Decision hash.
- Numeric rejection-reason code.
- Decision timestamp.

This creates a historical record rather than overwriting the old decision.

### 8.8 Reputation observations

The contract records unique successful/failed outcome observations.

The smoothed Beta mean is:

```text
reputation = (successes + 1) * 100
             / (successes + failures + 2)
```

The prior contributes one success and one failure.

This avoids an undefined zero-observation score.

The admin does not assign arbitrary numeric reputation.

The score is descriptive.

It is not an on-chain vote-weight multiplier.

### 8.9 Payout vault

The adjudicator records:

- Claimant.
- Claim ID.
- Allocated amount.
- Funded amount.
- Withdrawn amount.
- Funding state.

The payout uses pull withdrawal.

The withdrawal is non-reentrant.

The recipient cannot withdraw a second time.

### 8.10 Adjudicator events

Important events include:

- `AuditorRegistrationUpdated`.
- `ReviewConfigUpdated`.
- `ManualReviewOpened`.
- `AuditorVoteCast`.
- `ManualReviewFinalized`.
- `PayoutRecorded`.
- `PayoutFunded`.
- `PayoutWithdrawn`.
- `DecisionRecorded`.
- `AppealStarted`.
- `AuditorReputationObserved`.

### 8.11 Adjudicator invariants

1. Only the manager starts a review.
2. Only an address assigned to that claim/version can vote; current active-list
   membership is not rechecked after assignment.
3. Each auditor votes once per claim/version.
4. A vote after the deadline is rejected.
5. A review finalizes once.
6. A finalized review cannot accept new votes.
7. A payout cannot be withdrawn beyond its allocation.
8. A rejected review does not leave an unaccounted reserved payout.
9. An appeal creates a separate decision key.

---

## 9. `EvidenceRegistry` and evidence transparency

Source: [`contracts/contracts/EvidenceRegistry.sol`](../contracts/contracts/EvidenceRegistry.sol)

### 9.1 Identity record

An encryption identity contains:

- Encryption public key.
- Signing public key.
- Identity version.
- Scheme version.
- Registration timestamp.
- Revocation status/time where applicable.

The identity belongs to a wallet account.

### 9.2 Identity lifecycle

```text
no identity
  -> registerEncryptionIdentity
  -> active identity
  -> revokeEncryptionIdentity
  -> revoked identity
```

An owner must register before receiving an evidence grant.

An auditor identity is resolved on-chain before transformation.

### 9.3 Two complementary evidence integrity structures

The backend maintains two structures that must not be conflated:

1. A per-claim `File` hash chain. Its first document uses the literal sentinel
   `GENESIS` as `previousEvidenceHash`; there is no separately stored genesis
   event. Each SHA-256 chain hash commits to claim ID, chain index, previous
   hash, encrypted-file hash, CID, document type, uploader, claim version,
   associated-data hash, and encryption scheme.
2. A global append-only `EvidenceEvent` transparency log. Its monotonically
   increasing `treeIndex` and canonical event JSON become RFC6962-style
   domain-separated SHA-256 leaves (`0x00` for a leaf, `0x01` for an internal
   node). Signed tree heads and proofs are built over this second structure.

The per-claim chain supports local document-order verification. The global log
supports inclusion, consistency, and optional on-chain head anchoring.

### 9.4 Tree-head anchoring

An evidence tree head contains:

- Tree size.
- Root hash.
- Previous root hash.
- Signature.
- Signer.
- Anchor transaction metadata.

The on-chain digest binds:

- Registry address.
- Chain ID.
- Tree size.
- Root hash.
- Previous root hash.

Tree sizes must increase.

The previous root creates an append-only sequence.

### 9.5 Inclusion proof

An inclusion proof contains:

- Leaf hash.
- Sibling hashes.
- Left/right orientation.
- Tree size/root identity.

Verification recomputes the root.

The verifier compares the recomputed root to the anchored head.

### 9.6 Consistency proof

A consistency proof checks that the later tree extends the earlier tree.

It does not require the verifier to download every old event.

The proof is meaningful only if both heads are authenticated.

### 9.7 Confidentiality does not come from the anchor

The evidence root proves event inclusion/integrity.

It does not reveal medical content.

It does not make ciphertext recoverable if IPFS retention fails.

It does not replace key management.

### 9.8 Evidence security boundary

The backend may transform a Recrypt capsule.

It should not receive the plaintext AES key.

The browser validates the associated-data hash and then supplies the exact
associated-data bytes to AES-GCM before decrypting. The backend validates the
document/grant/claim relationship; the current download helper does not take a
second caller-provided claim context for an independent field comparison.

The browser validates the ciphertext receipt before decrypting.

The browser validates the payload magic/version before parsing bytes.

---

## 10. Evidence cryptography format

### 10.1 File encryption inputs

The browser generates:

- A random 32-byte AES key.
- A random AES-GCM IV/nonce.
- Associated data JSON.
- Plain file bytes.

### 10.2 Associated data

Associated data binds the encrypted file to:

- Claim ID.
- Claim version.
- Uploader wallet/identity.
- Evidence type.

Changing associated data causes AES-GCM authentication failure.

This prevents moving ciphertext between claims without detection.

### 10.3 Payload envelope

The encrypted payload has a format identified by:

- Magic prefix `BINSENC2`.
- A 12-byte IV/nonce immediately after the eight-byte magic prefix.
- Web-Crypto ciphertext with the 16-byte GCM authentication tag appended.

There is no additional serialized version field in the current byte envelope;
`BINSENC2` is the format/version discriminator. The exact layout is implemented
by the frontend evidence utility.

The backend treats it as opaque bytes.

### 10.4 Recrypt capsule

The AES key is wrapped to the uploader's encryption identity.

The owner derives a transform key for the auditor's identity.

The backend receives the transform operation.

The backend returns the transformed capsule.

The auditor unwraps the AES key locally.

The backend never needs to decrypt the evidence.

### 10.5 Recovery backup

The private identity is stored in browser IndexedDB.

A wallet-signature-derived encrypted backup can restore it.

The backup is still protected by the wallet/device boundary.

Loss of both wallet and backup can make evidence inaccessible.

Production deployment should use managed key custody.

### 10.6 Evidence grant lifecycle

```text
owner identity registered
  -> auditor selected for manual review
  -> owner grants transform key
  -> backend validates grant and identities
  -> backend performs PRE transformation
  -> auditor downloads ciphertext
  -> auditor decrypts locally
  -> owner may revoke future access
```

The grant does not rewrite the original ciphertext.

It authorizes a new way to unwrap the existing AES key.

### 10.7 Evidence access audit

The backend records:

- Grant creation.
- Grant revocation.
- Transformation request.
- Transformation result metadata.
- Download/access metadata.
- Verification outcome.

The evidence tree can anchor these events.

---

## 11. Hybrid registry and Merkle implementation

### 11.1 Why a hybrid registry exists

The project needs an external record source to test:

- Oracle observation.
- Record lookup.
- Merkle inclusion.
- Data mismatch detection.
- Source disagreement.
- Registry version binding.

The current runtime registry therefore uses 4,995 deterministic records adapted
from a public-secondary Medicare claims benchmark and five compatibility presets
that keep the original UI demonstration paths stable. Controlled attack variants
are created separately for research evaluation. This provides realistic claim
distributions without pretending to be a live hospital integration, which would
still require consent, legal controls, independent APIs, and production security.

### 11.2 Canonical record fields

The current canonical leaf commits, in source-defined insertion order, to:

```text
hospitalId, hospitalName, licenseStatus, patientHash, treatmentType,
diagnosisCode, admissionDate, dischargeDate, invoiceDate, billAmount,
expectedBillMin, expectedBillMax, invoiceNumber, invoiceHash, invoiceStatus,
recordStatus, fraudLabel, datasetProfile, baseDataOrigin, claimSetting,
providerPotentialFraud, providerLabelType, scenarioInjected, scenarioType,
scenarioVersion, sourceClaimAmountUsd, sourceProcedureCode,
amountNormalizationVersion, amountNormalizationDivisor, previousClaimCount,
providerVelocityAnomaly, claimantVelocityAnomaly, nearDuplicateAdvisory,
isMissingOrNoisy, dataQuality, recurringLegitimate, fraudSignals
```

`fraudSignals` is an ordered object containing `usedInvoice`,
`cancelledRecord`, `inflatedAmount`, `blacklistedHospital`, and `dateMismatch`.
Dates are ISO strings or `null`; invoice hashes are lowercased; other values
retain their JSON number/string/Boolean/null representation.

### 11.3 Canonicalization requirements

Canonicalization must specify:

- Field ordering.
- Empty-value representation.
- Numeric formatting.
- Timestamp formatting.
- Case normalization.
- Unicode handling.
- Boolean encoding.
- Array/list ordering.

Without canonicalization, two honest workers can hash different bytes.

### 11.4 Leaf hashing

The current registry leaf hash is:

```text
leaf = 0x || SHA256_UTF8(JSON.stringify(canonicalRecord))
```

Unlike the separate evidence-transparency tree, the registry tree does **not**
use RFC6962 `0x00`/`0x01` domain prefixes. This distinction is an implementation
fact and must be preserved when reproducing proofs.

The service returns the leaf hash and proof to an oracle.

The oracle reconstructs the leaf independently.

It does not blindly accept the returned leaf hash.

### 11.5 Tree construction

Leaves are sorted deterministically.

The current ordering compares
`lowercase(invoiceHash) + "-" + invoiceNumber` using JavaScript
`localeCompare`.

Sibling pairs are hashed as SHA-256 over the UTF-8 text of the two concatenated
64-character lowercase hex digests, after removing each `0x` prefix:

```text
node = 0x || SHA256_UTF8(strip0x(left) || strip0x(right))
```

An unpaired final node is duplicated as both left and right children.

The root is published with a tree/schema version hash.

The leaf count is published.

### 11.6 Proof verification

The oracle verifies:

1. Presence of a found record, leaf hash, root, canonical record, and proof list.
2. The reconstructed canonical leaf equals the returned leaf hash.
3. Every sibling entry has a hash and `left`/`right` orientation.
4. Folding the proof produces the returned root.
5. The worker separately compares that returned root with the root snapshotted
   in the oracle request.

`leafIndex` is returned for inspection but is not an input to the worker's proof
fold. Proof orientation determines the reconstruction.

A failure becomes a non-verified result.

### 11.7 Historical roots

The coordinator stores roots instead of only the latest root.

An old request can be verified against the root it selected.

An admin cannot silently replace the dataset for an in-flight request.

The backend still needs to retain historical record trees.

Without old leaves/proofs, a later auditor may see the root but not reconstruct the proof.

### 11.8 Source independence boundary

Oracle 1 and Oracle 2 use:

- Separate wallets.
- Separate API credentials.
- Separate snapshot collections.
- Separate cursor files.
- Separate process instances.

They may still depend on the same hybrid adapter, generator, and operator.

The design therefore demonstrates operational separation, not independent truth.

---

## 12. Oracle worker runtime

### 12.1 Instance configuration

The workers are distinguished by:

- `ORACLE_INSTANCE_ID=1` or the second instance value.
- Private key.
- API key.
- Registry snapshot name.
- Cursor directory.
- Backend heartbeat endpoint.

The second worker uses a separate environment file, commonly `.env.oracle2`.

### 12.2 Event polling

The worker polls coordinator events from a configured start block.

It stores progress in a cursor.

The cursor is scoped to chain/coordinator/oracle.

A retry does not create a second commitment if the chain already contains one.

Finalized requests are skipped.

### 12.3 Worker verification stages

The worker executes these stages:

- Request loaded.
- Snapshot selected.
- Hospital query started.
- Hospital record received.
- Canonical leaf reconstructed.
- Proof verified.
- Claim facts compared.
- Result code selected.
- Result hash generated.
- Commitment submitted.
- Reveal submitted.

The current console/observability stream records startup identity, retries,
commit transaction, and reveal transaction/result. After a successful reveal,
the worker posts one structured backend oracle log containing query data,
hospital response/proof, independent assessment, result/commitment hashes,
model identity, transaction hash, and elapsed response time. It does not persist
a separate backend row for every intermediate stage.

### 12.4 Result categories

The worker can produce a verified or non-verified result.

The non-verified path is intentionally broad.

It includes:

- Record missing.
- Proof invalid.
- Root mismatch.
- Hospital mismatch.
- Invoice mismatch.
- Patient/claim mismatch.
- Date mismatch.
- Amount anomaly.
- Invalid record status.
- Suspended or blacklisted provider.

The exact result code is part of the canonical result hash.

### 12.5 Deterministic result hashing

The result hash binds:

- Request ID.
- Claim ID.
- Query hash.
- Claim version.
- Registry version.
- Registry root.
- Model version.
- Verified flag.
- Result/code hash.
- Reconstructed leaf hash.

Nondeterministic timestamps are not included.

Wallet identity is not included in the semantic result.

The oracle address is still the signer of the transaction.

### 12.6 Heartbeats

The worker sends an authenticated heartbeat.

The backend records health state.

An admin health view can show:

- Last seen time.
- Instance ID.
- Chain/coordinator identity.
- Cursor position.
- Error/retry state.
- Current request activity.

### 12.7 Oracle safety properties

The worker does not:

- Call manager finalization directly.
- Change a request's registry version.
- Reveal with a changed salt.
- Reuse a previous claim version.
- Trust a provider-returned leaf without reconstruction.
- Submit a result after the reveal deadline.

---

## 13. Fraud-risk model: feature engineering

Source areas: [`backEnd/services/featureEngineeringService.js`](../backEnd/services/featureEngineeringService.js), risk scoring, model artifacts

### 13.1 Model identity

The current model identity includes:

- Model version `bernoulli-fraud-v3.1.0` (current frozen artifact; older narrative sections may describe the v3.0 routing policy).
- Feature schema `fraud-features-v3`.
- Source Git commit.
- Training-data hash.
- Artifact hash.
- Model identity hash.
- Calibration artifact identity.
- Threshold.

The values are retained in [`backEnd/model-params.json`](../backEnd/model-params.json).

### 13.2 Feature vector

The 18 current features are:

1. `clean_registry_match`
2. `registry_record_missing`
3. `hospital_id_mismatch`
4. `invoice_hash_mismatch`
5. `claim_exceeds_registry_bill`
6. `bill_range_anomaly`
7. `treatment_type_mismatch`
8. `date_mismatch`
9. `invalid_record_status`
10. `used_invoice`
11. `cancelled_record`
12. `license_suspended`
13. `license_blacklisted`
14. `repeat_claim_pattern`
15. `provider_velocity_anomaly`
16. `claimant_velocity_anomaly`
17. `near_duplicate_advisory`
18. `missing_or_noisy_record`

### 13.3 Feature semantics

`clean_registry_match` represents a complete matching record.

`registry_record_missing` indicates no usable external record.

`hospital_id_mismatch` indicates provider identity disagreement.

`invoice_hash_mismatch` indicates invoice identity disagreement.

`claim_exceeds_registry_bill` compares the submitted amount with the record.

`bill_range_anomaly` checks configured range expectations.

`treatment_type_mismatch` compares the service description/code.

`date_mismatch` compares incident and record dates.

`invalid_record_status` captures invalid provider-record status.

`used_invoice` captures an invoice previously bound to a claim.

`cancelled_record` captures a cancelled record.

`license_suspended` captures provider suspension.

`license_blacklisted` captures provider blacklisting.

`repeat_claim_pattern` captures claimant repetition.

`provider_velocity_anomaly` captures high provider activity.

`claimant_velocity_anomaly` captures high claimant activity.

`near_duplicate_advisory` captures fuzzy similarity without making it a hard duplicate.

`missing_or_noisy_record` captures degraded source quality.

### 13.4 Hard versus soft signals

Some comparisons are blocking.

Some are fuzzy/advisory.

A near-duplicate advisory must not become a hard rejection by itself.

The distinction is important for attack evaluation.

It also prevents minor formatting differences from becoming irreversible denial.

### 13.5 Bernoulli Naive Bayes

Each feature is treated as present or absent.

For class `c` and feature vector `x`, the log score is conceptually:

```text
log P(c | x) ∝ log P(c)
  + Σ [x_i * log P(x_i=1|c)
      + (1-x_i) * log P(x_i=0|c)]
```

Laplace smoothing uses alpha one.

Log-space arithmetic reduces underflow.

The model returns a fraud probability.

### 13.6 Calibration

The raw posterior is passed through a Platt calibration artifact.

The current calibration identity is `platt-v1`.

The calibration was trained on the latest twenty percent temporal validation split.

Current recorded parameters include slope approximately `0.5386002105` and intercept approximately `-0.5857824076`.

The probability is still a synthetic-data estimate.

It is not a legal fraud finding.

### 13.7 Risk bands

Current cutoffs are:

- `LOW`: probability below `0.35`.
- `MEDIUM`: probability from `0.35` to below `0.70`.
- `HIGH`: probability at or above `0.70`.

These labels are presentation/workflow bands.

They do not change contract authority.

### 13.8 Recommendation logic

The current recommendation is conceptually:

```text
if authoritative registry-integrity failure:
    REJECT_ORACLE_VERIFICATION
else if fuzzyOnly or probability >= verified capacity-aware policy threshold:
    MANUAL_REVIEW_RECOMMENDED
else:
    AUTO_VERIFY_RECOMMENDED
```

The exact implementation should be treated as authoritative if thresholds change.

### 13.9 Model limitations

Naive Bayes assumes conditional feature independence.

The deployed protocol-irregularity model is trained on controlled synthetic
features. The separate provider-risk model is evaluated on real-derived claims
with a weak provider label. These two models answer different questions and must
not be collapsed into one real-world fraud claim.

The positive class is smaller than the legitimate class.

Provider/claimant correlations can cause leakage.

Temporal shift can reduce calibration.

The model is intentionally used as an advisory gate.

Manual adjudication is the conservative fallback.

---

## 14. Model training and evaluation methodology

### 14.1 Current training artifact

The current recorded training set contains:

- 480 records.
- 49 fraud examples.
- 431 legitimate examples.
- 18-feature schema.
- Laplace alpha one.
- Temporal latest-twenty-percent calibration.

### 14.2 Phase-5 synthetic profiles

The evaluation includes:

1. Normal operation.
2. High-fraud stress.
3. Provider compromise.
4. Temporal distribution shift.

Each profile contains 600 generated records.

### 14.3 Cross-validation design

The evaluation uses five folds.

Seeds include 11, 29, and 47.

Connected claimant/provider components are grouped.

This reduces train/test leakage through repeated actors.

Calibration is fitted inside the training fold.

The latest temporal slice is held out separately.

### 14.4 Aggregate metrics

The current phase-5 artifact reports:

| Metric | Value |
|---|---:|
| Accuracy | 0.9200 |
| Precision | 0.7241 |
| Recall | 0.3443 |
| F1 | 0.4667 |
| ROC AUC | 0.841476 |
| PR AUC | 0.546749 |
| Brier score | 0.0638634 |
| Calibration error | 0.0385384 |

### 14.5 Temporal holdout metrics

The current temporal holdout reports:

- Model-fit size: 384.
- Calibration size: 96.
- Test size: 120.
- True positives: 13.
- True negatives: 82.
- False positives: 4.
- False negatives: 21.
- Accuracy: 0.7917.
- Precision: 0.7647.
- Recall: 0.3824.
- F1: 0.5098.
- ROC AUC: 0.79071.
- PR AUC: 0.63811.
- Brier score: 0.153614.
- Calibration error: 0.083008.

### 14.6 Attack checks

The frozen evaluation reports:

- Zero fuzzy-duplicate automatic-rejection attacks.
- Zero connected-group leakage detections.

These results are bounded to the tested synthetic generation assumptions.

They do not prove immunity to a real adversary.

### 14.7 Evidence proof experiment

The recorded proof experiment uses tree size 512.

The current schema-v4 run reports build-and-prove time approximately 4.9522 ms.

The inclusion proof has nine nodes.

The inclusion payload is approximately 288 bytes.

The consistency proof uses one/32-style recorded proof metadata.

Verification is recorded as true.

### 14.8 Metrics interpretation

ROC AUC measures ranking quality across thresholds.

PR AUC is informative under class imbalance.

Precision matters when false fraud flags are costly.

Recall matters when missed fraud is costly.

Brier score evaluates probability quality.

Calibration error measures probability reliability.

The system intentionally routes uncertain cases to manual review.

---

## 15. Backend API and service reference

### 15.1 Process startup

The backend:

1. Loads environment configuration.
2. Connects to MongoDB.
3. Runs the first confirmation-aware indexing pass.
4. Starts the evidence-anchor scheduler and notification listener.
5. Starts the Express listener and serves the already-mounted API routes.

Missing `MONGODB_URI` is a startup-fatal configuration error. Missing JWT,
manager-address, or RPC configuration currently emits a startup warning and
causes the dependent routes/services to fail when used; the server does not
globally fail closed for all three at process start. `preflight`/`doctor` are the
intended stricter readiness gates.

### 15.2 Route families

| Prefix | Responsibility |
|---|---|
| `/api/auth` | Nonces, SIWE login/logout, session state |
| `/api/users` | Profile/identity and user-facing data |
| `/api/documents` | Encrypted file metadata, grants, receipts, transformations |
| `/api/policy-packages` | Public package catalog, rule/scenario previews, quotes, eligibility simulations |
| `/api/policies` | Holder policy reads and purchased-policy eligibility previews |
| `/api/policy-benefits` | Benefit-term, beneficiary/request-state, and policy-document reads |
| `/api/claims` | Claim prechecks, submission, reconciliation, detail/status |
| `/api/appeals` | Appeal metadata and history |
| `/api/votes` | Auditor/admin vote-summary reads; votes themselves are wallet-signed contract calls |
| `/api/evaluation` | Model/evaluation summaries |
| `/api/admin` | Role/configuration/routing/funding/operations |
| `/api/audit` | Timeline and audit export |
| `/api/oracle` | Logs, heartbeat, health, authenticated oracle operations |
| `/api/notifications` | User notifications |
| `/api/indexer` | Indexed block/event visibility |
| `/mock/hospital` | Hybrid healthcare-registry lookup and verification |
| `/api/evidence-log` | Tree heads and inclusion/consistency proofs |

### 15.3 Claim controller responsibilities

The claim controller handles:

- Request validation.
- Wallet/policy ownership checks.
- Submission attempts.
- Transaction hash recording.
- Transaction receipt reconciliation.
- Abandoned submission state.
- Claim status projection.
- Model/risk preview.
- Oracle/manual routing requests.

The controller does not finalize the contract decision itself.

### 15.4 Document controller responsibilities

The document controller handles:

- Encryption identity registration lookup.
- Recipient identity lookup.
- Encrypted upload.
- Claim attachment.
- Receipt/hash verification.
- Decryption-key transformation.
- Grant creation/revocation.
- Access logging.

Plaintext evidence is not an expected backend payload.

### 15.5 Policy controller responsibilities

The policy controller handles:

- Active package listing.
- Rule catalog/scenario previews.
- Historical rule preview.
- Risk/pricing quote display.
- User policy listing.
- Eligibility queries.
- Premium and reinstatement transaction preparation.

On-chain terms remain authoritative.

### 15.6 Admin controller responsibilities

Admin services include:

- Package lifecycle.
- Economic rule publication.
- Oracle request creation.
- Timeout resolution.
- Manual-review routing.
- Benefits term confirmation.
- Registry publishing.
- Reserve/settlement intelligence.
- Evaluation summaries.
- Role synchronization.
- Action audit logging.

Admin APIs must not be described as direct claim approval when they only initiate protocol actions.

### 15.7 Oracle controller responsibilities

Oracle endpoints include:

- Structured result logs.
- Heartbeat ingestion.
- Health display.
- API-key verification.
- Mock-hospital verification.

The endpoint cannot bypass coordinator commitment/reveal.

### 15.8 Notification service

Notifications are deduplicated by status and transaction identity.

Typical messages explain:

- Claim received.
- Evidence attached.
- Oracle verification pending.
- Oracle verified and payout allocated.
- Oracle failed and manual review available.
- Funding required.
- Review vote pending.
- Appeal cycle started.
- Settlement withdrawn.
- Benefit approved/rejected/settled.

### 15.9 Core Mongo models

| Model | Function |
|---|---|
| `User` | Wallet, role, profile, identity metadata |
| `RevokedToken` | JWT JTI logout/revocation |
| `File` | Encrypted evidence metadata and CID/receipt |
| `EvidenceEvent` | Append-only evidence event projection |
| `EvidenceTreeHead` | Signed tree-head metadata |
| `EvidenceGrant` | Owner-to-recipient transformation authorization |
| `EvidenceAccessLog` | Evidence access/transformation history |
| `Appeal` | Appeal workflow metadata |
| `ClaimSubmissionAttempt` | Precheck/transaction/reconciliation attempt |
| `AdminActionLog` | Administrative action audit |
| `OracleLog` | Oracle request/result/commit/reveal metadata |
| `OracleHealth` | Heartbeat and liveness projection |
| `MockHospitalRecord` | Primary hybrid runtime-registry snapshot |
| `MockHospitalRecordOracle2` | Oracle-2 hybrid registry snapshot |
| `VotingFinalization` | Manual review finalization projection |
| `Notification` | Deduplicated user messages |
| `IndexedBlock` | Confirmation-aware block record |
| `IndexedBlockchainEvent` | Normalized chain event |
| `IndexerCheckpoint` | Resume/reorg state |

---

## 16. Indexer and reorganization behavior

### 16.1 Why an indexer exists

Smart-contract reads are authoritative but not convenient for dashboards.

The indexer creates queryable projections.

It allows timelines to combine multiple contracts and backend events.

### 16.2 Indexed contracts

The indexer tracks:

- `InsuranceManager`.
- `OracleCoordinator`.
- `ClaimAdjudicator`.
- `PolicyEconomics`.
- `EvidenceRegistry`.

`EvidenceRegistry` is included only when its address is configured. The current
indexer service does **not** index `PolicyBenefitsManager` or
`ProtocolDeploymentRegistry`; those modules are read through their own contract
and service paths.

### 16.3 Confirmation policy

The default confirmation depth is three blocks.

Events below the safe head are projected.

The most recent `INDEXER_CONFIRMATIONS` blocks are not projected yet; they do
not exist as provisional event rows in MongoDB.

This reduces display of events from a short-lived reorganization.

### 16.4 Chunking

The default event scan chunk is exactly 500 blocks.

Chunking avoids provider range limits.

The service records the last scanned block.

### 16.5 Reorganization recovery

The checkpoint contains the last trusted block/hash.

At the start of a pass, the service compares its latest indexed block hash with
the canonical block at the same height. While they disagree it deletes events
and indexed-block rows from that height, steps backward one stored block, and
repeats until a canonical stored block is found. If none remains it deletes the
checkpoint. It then rewrites the checkpoint and rescans forward. There is no
separate configured rollback-window limit in the current implementation.

The chain remains authoritative.

The Mongo projection is repairable.

### 16.6 Audit timeline assembly

An audit export may combine:

- Package/policy events.
- Premium/coverage events.
- Claim submission/document events.
- Oracle request/commit/reveal/finalization.
- Registry snapshot publication.
- Manual-review opening/votes/finalization.
- Appeal start/new version.
- Funding/payout/withdrawal.
- Evidence-tree anchor.
- Backend admin/oracle/action logs.

The timeline should distinguish chain timestamps from backend receipt time.

---

## 17. Frontend implementation reference

### 17.1 Route groups

Public routes include:

- Home.
- Wallet login.

Claimant routes include:

- Dashboard.
- Policy list.
- Policy purchase.
- Claim list.
- New claim.
- Claim detail.
- Benefits.
- Notifications.

Admin routes include:

- Admin dashboard.
- Package creation/management.
- Benefits management.
- Healthcare registry.
- Thesis/evaluation dashboard.
- Audit actions.
- Role health.
- Claim list/detail.
- Notifications.

Auditor routes include:

- Auditor dashboard.
- Registry/proof view.
- Claim lookup/history.
- Vote list.
- Vote detail.
- Reputation.
- Document verification.

### 17.2 Wallet behavior

The wallet supplies:

- EIP-1193 provider.
- Account address.
- Chain ID.
- SIWE signature.
- Contract transaction signatures.

The UI expects local chain ID `31337` for the demo.

### 17.3 Claim form choreography

```text
choose policy and claim facts
  -> generate predicted claim ID/version metadata
  -> encrypt evidence in browser
  -> upload ciphertext/metadata
  -> submit on-chain claim
  -> attach/reconcile backend metadata
  -> refresh indexed status
```

The form must handle a wallet rejection separately from an upload failure.

### 17.4 Appeal choreography

The appeal page:

- Displays the rejected claim.
- Collects an appeal reason hash/reference.
- Optionally encrypts new evidence.
- Calls the appeal contract function.
- Attaches evidence metadata after the transaction.
- Refreshes the new claim version.

### 17.5 Auditor workflow

The auditor:

1. Connects a wallet.
2. Loads assigned review.
3. Verifies assignment.
4. Requests/transforms evidence access after owner grant.
5. Checks receipt/associated data locally.
6. Decrypts evidence locally.
7. Reviews registry/audit information.
8. Casts one vote.

### 17.6 Admin workflow

The admin dashboard surfaces:

- Package/rule versions.
- Registry root/version/leaf count.
- Oracle health.
- Claim routing eligibility.
- Review/funding state.
- Reserve and settlement intelligence.
- Benefits term/request state.
- Action audit records.

The UI should describe actions in protocol terms.

---

## 18. Deployment and configuration reference

### 18.1 Local setup sequence

The preferred current hybrid demonstration path is:

```text
start MongoDB
npm run dev:hybrid
connect wallet
```

`dev:hybrid` runs preflight, starts a managed Hardhat chain when necessary,
always executes the destructive hybrid setup, verifies the deployment, and then
starts backend, frontend, Oracle 1, and Oracle 2. It waits for backend and
frontend readiness before declaring the stack ready.

For a previously deployed chain that must be reused without reset, use
`npm run dev:all`; it verifies chain ID `31337` and manager bytecode before
starting application services.

### 18.2 What the setup commands do

`setup:hybrid` first validates the frozen hybrid dataset, then resets MongoDB
with the 5,000-record primary/oracle-2 snapshots. `setup:local` instead resets
to the legacy controlled synthetic runtime. Both then perform the common chain
deployment/configuration sequence:

1. Funds local operator accounts.
2. Deploys `InsuranceManager`.
3. Uses manager-created `OracleCoordinator`.
4. Uses manager-created `PolicyEconomics`.
5. Sets model identity from `backEnd/model-params.json`.
6. Deploys/configures `ClaimAdjudicator`.
7. Deploys `EvidenceRegistry`.
8. Creates the Health Basic package.
9. Deploys `PolicyBenefitsManager`.
10. Publishes the default benefit schedule.
11. Funds the benefits module.
12. Deploys `ProtocolDeploymentRegistry`.
13. Commits the migration manifest hash.
14. Registers component addresses/interface versions.
15. Grants local roles.
16. Funds the manager reserve.
17. Publishes the primary Merkle registry.
18. Synchronizes ABI/configuration files.
19. Runs profile-appropriate clean-state verification.

### 18.3 Destructive boundary

`setup:local`, `setup:hybrid`, `dev:bootstrap`, and `dev:hybrid` can be
destructive to local demo data when they invoke setup. In particular,
`dev:hybrid` deliberately performs a clean hybrid reset on every launch.

It should not be used against a valuable Mongo database.

It should not be used against a shared test chain without confirmation.

`dev:all` never performs setup. Bootstrap modes announce setup explicitly;
`dev:hybrid` redeploys protocol modules and resets the configured Block-Insure
Mongo collections but does not erase the Hardhat chain's prior block history.

### 18.4 Deployment manifest

The protocol deployment registry records:

- Protocol version.
- Component ID.
- Component address.
- Interface version.
- Deployment block/time metadata.
- Migration manifest hash.

The manifest is a reproducibility identity.

It is not a proxy upgrade authority.

### 18.5 Environment groups

Backend configuration normally includes:

- RPC URL.
- Chain ID.
- Contract addresses.
- Backend signing key where required.
- Mongo URL.
- JWT secret/configuration.
- SIWE domain/URI.
- Pinata credentials.
- Recrypt/proxy configuration.
- Oracle API keys.
- Rate limits.

Frontend configuration includes:

- API base URL.
- Chain ID.
- Contract addresses.
- Public wallet/network settings.

Oracle configuration includes:

- Instance identity.
- Private key.
- Backend URL/API key.
- Coordinator address.
- Registry snapshot identity.
- Polling/cursor settings.

### 18.6 Secrets policy

Secrets belong in ignored environment files or a production secret manager.

The repository should retain `.env.example` templates.

No private key should be committed.

No Pinata secret should be committed.

No Recrypt private identity should be committed.

No production JWT secret should be committed.

### 18.7 Launcher invariant

Before starting application services, the launcher verifies:

- RPC availability.
- Chain ID `31337`.
- Configured manager address.
- Deployed bytecode at that address.

If the check fails, the operator must start the chain and run setup.

This prevents a backend from connecting to an empty chain.

---

## 19. Transaction choreography and reconciliation

### 19.1 Why transaction reconciliation exists

A wallet can submit a transaction while the browser loses connectivity.

The backend may receive a hash without a confirmed receipt.

The indexer may see the chain event later.

The application therefore records attempts separately from final state.

### 19.2 Claim submission attempt lifecycle

```text
precheck started
  -> wallet transaction hash recorded
  -> receipt pending
  -> receipt confirmed
  -> chain event indexed
  -> evidence metadata attached
  -> attempt reconciled
```

Failure paths include:

- Validation rejected.
- Wallet rejected.
- Transaction reverted.
- Receipt timeout.
- Event not yet indexed.
- Attachment mismatch.

### 19.3 Idempotency principles

Retrying a read should be safe.

Retrying reconciliation should not create a second claim.

Retrying oracle polling should not create a second commitment.

Retrying notification creation should deduplicate by event/status/transaction.

Retrying evidence attachment should verify the claim/CID association.

### 19.4 Backend versus chain timestamps

The chain timestamp represents protocol block time.

The backend timestamp represents service observation time.

Audit exports should display both when available.

They should not be used interchangeably in consensus hashes.

---

## 20. State-machine reference

### 20.1 Claim state graph

```mermaid
stateDiagram-v2
    [*] --> SUBMITTED
    SUBMITTED --> DUPLICATE_CHECKED
    SUBMITTED --> FRAUD_FLAGGED
    DUPLICATE_CHECKED --> ORACLE_PENDING
    ORACLE_PENDING --> ORACLE_VERIFIED
    ORACLE_PENDING --> ORACLE_FAILED
    ORACLE_VERIFIED --> PAYOUT_READY
    ORACLE_VERIFIED --> FUNDING_REQUIRED
    ORACLE_FAILED --> MANUAL_REVIEW
    FRAUD_FLAGGED --> MANUAL_REVIEW
    MANUAL_REVIEW --> PAYOUT_READY
    MANUAL_REVIEW --> FUNDING_REQUIRED
    MANUAL_REVIEW --> REJECTED
    FUNDING_REQUIRED --> PAYOUT_READY
    PAYOUT_READY --> SETTLED
    REJECTED --> APPEALED
    APPEALED --> ORACLE_PENDING
```

The graph omits internal validation reverts.

It omits the retained but currently unused `CLOSED` transition.

### 20.2 Policy state graph

```mermaid
stateDiagram-v2
    [*] --> ACTIVE
    ACTIVE --> GRACE_PERIOD: premium due
    GRACE_PERIOD --> ACTIVE: premium paid
    GRACE_PERIOD --> LAPSED: grace expires
    LAPSED --> ACTIVE: reinstated
    ACTIVE --> CANCELLED: holder/admin cancellation
    ACTIVE --> EXPIRED: policy end
```

`CANCELLED` takes precedence in effective-status calculation and therefore does
not later become `EXPIRED`. `PENDING_PAYMENT` and `RENEWED` are retained enum
members without current transition functions. Stored status synchronization is
timestamp-aware for the active/grace/lapsed/expired path.

### 20.3 Benefit state graph

```mermaid
stateDiagram-v2
    [*] --> REQUESTED
    REQUESTED --> APPROVED
    REQUESTED --> REJECTED
    APPROVED --> REJECTED
    APPROVED --> ALLOCATED
```

Withdrawal is a balance operation after `ALLOCATED`; it zeroes the recipient's
claimable balance and reduces reserved liability but does not change the request
to a `WITHDRAWN` enum value. Rejection can also reverse an `APPROVED` request
before allocation.

The benefits manager has its own request/status enum (`NONE`, `REQUESTED`,
`APPROVED`, `REJECTED`, `ALLOCATED`).

It is separate from claim status.

### 20.4 Oracle request graph

```mermaid
stateDiagram-v2
    [*] --> CREATED
    CREATED --> COMMITTING
    COMMITTING --> REVEALING: all commits or deadline
    REVEALING --> FINALIZED: exact quorum
    REVEALING --> CONFLICT: all reveals without quorum
    REVEALING --> TIMED_OUT: reveal deadline
```

Conflict and timeout are failure outcomes sent to the manager.

---

## 21. Formal-style invariants for a thesis appendix

### 21.1 Version binding

For every finalized oracle result:

```text
revealedClaimVersion    == request.claimVersion
revealedRegistryVersion == request.registryVersion
revealedModelVersion    == request.modelVersion
```

The coordinator rejects a reveal when any explicit equality fails. The worker
protocol additionally defines:

```text
resultHash == H(... request.queryHash, request.registryRoot, ...)
```

That root/query binding is verified by honest worker recomputation and exact
agreement; because `resultHash` is opaque `bytes32`, Solidity cannot decode it
to prove which root a malicious oracle hashed.

### 21.2 Exact quorum

Let `D` be the multiset of exact result digests.

Finalization by quorum requires:

```text
max_count(D) >= quorumThreshold
```

The count is for one exact digest.

Two results with different semantic `resultHash` values do not share an exact
digest, even when both submit `verified=true`.

### 21.3 Coverage conservation

For a policy interval:

```text
remainingCoverage
  = initialCoverage
  - activeReservations
  - settledClaimExposure
```

The implementation applies integer arithmetic and reservation state.

### 21.4 Payout conservation

For a claim:

```text
allocated
  = withdrawn
  + remainingPullBalance
```

`withdrawn` cannot exceed `allocated`.

### 21.5 One vote

For an auditor `a` and claim version `v`:

```text
votes(claimId, v, a) ∈ {not cast, valid, invalid}
```

There is no fourth vote state.

### 21.6 One finalization

For a request ID:

```text
finalized(requestId) changes false -> true at most once
```

For a review key:

```text
finalized(claimId, version) changes false -> true at most once
```

### 21.7 Evidence authenticity

A valid evidence download requires:

```text
hash(downloadedCiphertext) == storedReceipt
hash(associatedData) == storedAssociatedDataHash
payloadMagic == BINSENC2
AES-GCM authentication succeeds
```

The backend separately authorizes the document/grant/claim relationship. The
current download utility authenticates the stored associated-data string but
does not accept a second caller-supplied claim context for field-by-field
comparison at decryption time.

### 21.8 Migration identity

The deployment registry should satisfy:

```text
keccak256(migrationManifestBytes) == committedManifestHash
```

The deployment script establishes this equality and an external verifier can
recompute it. The registry itself accepts a nonzero admin-supplied hash and does
not parse the manifest; its current value can be replaced by the administrator.

---

## 22. Threat model

### 22.1 Threat actors

The design considers:

- A dishonest claimant.
- A dishonest provider record.
- A compromised single oracle.
- A colluding subset below quorum.
- A stale/replayed claim submission.
- A backend operator altering a projection.
- An auditor who votes outside their assignment.
- A user attempting evidence substitution.
- A wallet/session attacker.
- A treasury operator attempting excess withdrawal.
- A service outage or chain reorganization.

### 22.2 Dishonest claimant

The claimant may submit false facts.

Policy terms and duplicate checks reduce obvious replay.

Registry mismatches become features/results.

Oracle exact consensus prevents one false worker from deciding.

Auditor review handles ambiguous cases.

The system cannot prove that every real-world event happened.

### 22.3 Dishonest single oracle

One oracle can submit a false commitment/reveal.

It cannot finalize alone when quorum is two or higher.

It can cause conflict if it disagrees with an honest oracle.

Conflict fails conservatively and routes to review.

The protection depends on an honest quorum.

### 22.4 Colluding oracle quorum

If enough eligible oracles collude, exact consensus can still be false.

The protocol protects consistency and auditability.

It does not create truth from dishonest source data.

Operational source independence is therefore a primary limitation.

### 22.5 Backend tampering

A backend operator may alter a Mongo projection.

Chain events allow the projection to be rebuilt.

Evidence tree heads expose anchored history changes.

Raw medical bytes remain ciphertext.

The backend can still affect availability and UI presentation.

### 22.6 Evidence substitution

Associated data binds ciphertext to claim/version/uploader/type.

Receipt hashes bind the uploaded bytes.

AES-GCM authenticates the ciphertext.

An altered file should fail verification/decryption.

### 22.7 Auditor impersonation

Auditor actions require wallet signatures.

The contract checks assignment.

The backend checks the current on-chain role.

The evidence grant targets the auditor identity.

### 22.8 Replay after appeal

The claim version increments.

The query hash includes the version.

The coordinator reveal includes the version.

Old results therefore fail the new-cycle binding checks.

### 22.9 Treasury abuse

The economics module calculates protected reserve requirements.

The manager protects excess withdrawal.

The payout vault uses explicit allocation and withdrawal.

The protocol still trusts the configured admin with treasury funding/operations within those bounds.

### 22.10 Reorganization

The indexer waits for confirmations.

The checkpoint stores block/hash state.

The indexer can roll back projections.

The chain's canonical history remains the source of truth.

---

## 23. Security controls checklist

### 23.1 Solidity controls

- Role checks.
- Manager-only extension calls.
- Non-reentrant withdrawals.
- Pause/unpause where configured.
- Exact state preconditions.
- Deadline checks.
- Claim-version checks.
- Registry/model/root binding.
- Protected excess withdrawals.
- Immutable module links where appropriate.

### 23.2 Backend controls

- SIWE nonce consumption.
- JWT issuer/audience/JTI checks.
- Token revocation.
- Current database role check.
- Current on-chain role check.
- Helmet/CORS.
- Rate limits.
- Upload type/size bounds.
- API keys for oracle endpoints.
- Transaction receipt reconciliation.
- Confirmation-aware indexing.

### 23.3 Frontend controls

- Local encryption before upload.
- AES associated-data binding.
- Receipt verification.
- Recrypt identity use.
- Wallet signing.
- Chain ID checks.
- Local proof/decryption verification.

### 23.4 Operational controls

- Separate oracle wallets.
- Separate oracle snapshots.
- Cursor persistence.
- Heartbeats.
- Redacted event logs.
- Action audit logs.
- Deployment manifest.
- ABI synchronization checks.

---

## 24. Test and verification map

### 24.1 Contract tests

Contract tests cover:

- Package and policy lifecycle.
- Premium/grace/lapse behavior.
- Claim validation.
- Duplicate detection.
- Economics reservation/release/settlement.
- Coordinator commit/reveal.
- Exact-result conflicts.
- Timeout resolution.
- Claim-version replay protection.
- Auditor assignment/vote/finalization.
- Payout funding/withdrawal.
- Appeals.
- Evidence identities/tree heads.
- Benefits terms/beneficiaries/requests.
- Deployment registry.

### 24.2 Stateful/invariant tests

Stateful tests exercise sequences rather than isolated calls.

They are important for:

- Reservation conservation.
- State transition order.
- Repeated withdrawal attempts.
- Deadline transitions.
- Appeal cycles.

### 24.3 Backend tests

Backend tests cover:

- Analytics metrics.
- Feature schema.
- Risk recommendations.
- Model artifact identity.
- Claim submission integrity.
- Evidence access/grants.
- Indexer behavior.
- Policy/benefit service behavior.

### 24.4 Oracle tests

Oracle protocol tests cover:

- Result hash determinism.
- Commitment determinism.
- Salt mismatch rejection logic.
- Version/root/model binding.
- Exact digest behavior.
- Canonical registry proof flow.

### 24.5 Frontend checks

Frontend verification includes:

- ESLint.
- Production build.
- ABI/configuration synchronization.

### 24.6 Recorded suite results

The latest cross-project verification and live-validation records report:

- 127 passing Solidity tests in the full verification suite.
- 63 passing backend analytics and unit tests.
- 13 oracle protocol tests.
- Passing frontend lint/build.
- Passing repository integrity, reproducibility, and runtime synchronization checks.
- Five passing browser smoke/role tests and two passing complete policy/claim
  settlement workflows on the 5,000-record hybrid runtime.

The current coverage run reported 126 passing instrumented tests plus one
instrumentation-only pending size case; use the structured verification report
for current non-coverage suite counts.

### 24.7 Coverage

The current Solidity coverage run records:

- Statements: 93.77%.
- Branches: 65.07%.
- Functions: 90.59%.
- Lines: 94.39%.

Branch coverage is lower than statement coverage.

That difference should be acknowledged in a thesis.

### 24.8 Dependency audits

Production dependency audits for backend/frontend/oracle/contracts reported zero findings in the recorded run.

The full development Hardhat/toolchain tree still reported transitive findings.

Those findings are not silently eliminated with a force upgrade.

They require toolchain maintenance and compatibility review.

### 24.9 Optional analyzers

Slither, Forge, Echidna, and Solhint are not assumed to be installed.

Their absence does not mean the contracts are formally proven.

Their use should be recorded when available.

---

## 25. Gas, size, and performance reference

### 25.1 Contract size

Recorded deployed bytecode sizes are:

| Contract | Bytes | EIP-170 limit |
|---|---:|---:|
| `InsuranceManager` | 24,262 | 24,576 |
| `OracleCoordinator` | 7,014 | 24,576 |
| `ClaimAdjudicator` | 10,818 | 24,576 |
| `PolicyEconomics` | 9,484 | 24,576 |
| `EvidenceRegistry` | 4,135 | 24,576 |
| `ProtocolDeploymentRegistry` | 923 | 24,576 |
| `PolicyBenefitsManager` | 9,981 | 24,576 |

The manager has approximately 314 bytes of headroom.

This is a design constraint.

### 25.2 Why module boundaries matter

Benefits logic was separated because it is not claim-manager core logic.

Economics logic was separated because settlement/accounting is independently testable.

Adjudication was separated because vote/vault state has its own lifecycle.

Evidence anchoring was separated because it has identity/tree-head state.

Deployment identity was separated because migration metadata is not claim state.

### 25.3 Hash-versus-root experiment

`GasTestContract` compares:

- Storing many individual hashes.
- Storing one Merkle root.

The experiment demonstrates an on-chain storage trade-off.

It does not claim that a root eliminates all off-chain retention requirements.

### 25.4 Throughput interpretation

Claim throughput depends on:

- Block gas limit.
- Contract call path.
- Evidence upload latency.
- Mongo/indexer latency.
- Oracle polling interval.
- Commit/reveal windows.
- Backend confirmation depth.

An application-level requests-per-second result is not the same as chain finality throughput.

---

## 26. Operational runbook

### 26.1 Clean local reset

Use only for disposable local data.

```text
stop application processes
ensure Mongo target is the local Block-Insure database
start MongoDB
run npm run dev:hybrid
```

The managed command starts Hardhat if required, validates/seeds the hybrid
registry, deploys and verifies contracts, synchronizes addresses/ABIs, and
starts backend/frontend/oracles. For the legacy synthetic-only runtime, use
`npm run dev:bootstrap` instead.

### 26.2 Existing deployment start

```text
start the already-deployed Hardhat node
verify chain 31337
verify manager bytecode at configured address
run npm run dev:all
```

The launcher should reuse the deployment.

### 26.3 If the launcher reports an empty chain

The likely causes are:

- Hardhat node is not running.
- Chain ID is wrong.
- Environment points to a new node.
- Address files are stale.
- Neither `setup:hybrid` nor `setup:local` has deployed to this chain.

For the current thesis demonstration, the normal recovery is `npm run
dev:hybrid` when a clean reset is acceptable.

### 26.4 If an oracle is stuck

Check:

- Worker process is running.
- Private key is correct.
- Worker instance ID is unique.
- Coordinator address matches.
- Cursor file is writable.
- API key is accepted.
- Registry snapshot version exists.
- Request is still within commit/reveal windows.
- Worker has the required on-chain role.

After the reveal deadline, anyone can resolve timeout.

### 26.5 If a claim is `FUNDING_REQUIRED`

Check:

- Manager native balance.
- Calculated insurer liability.
- Minimum protected reserve.
- Unfunded liability.
- Benefits vault balance separately.

Fund the manager through the authorized funding flow.

Then call `activateFundedClaim`.

### 26.6 If evidence cannot decrypt

Check:

- Claim ID/version associated data.
- Ciphertext receipt hash.
- `BINSENC2` payload prefix.
- Owner identity registration.
- Auditor identity registration.
- Grant status and recipient wallet.
- Recrypt transform response.
- Browser IndexedDB private identity.

Do not send the plaintext AES key to a support operator.

### 26.7 If the UI is stale

Check:

- Indexer checkpoint.
- Confirmation depth.
- Backend process logs.
- Contract address environment.
- Chain/network selected in wallet.
- React Query cache/refetch state.

Read the contract directly before treating a projection as final.

### 26.8 If the registry proof fails

Check:

- Root version selected by request.
- Snapshot collection used by the oracle.
- Canonical field normalization.
- Leaf ordering.
- Invoice identity.
- Proof sibling order.
- Published root and leaf count.

Do not substitute the latest root for the request's historical root.

---

## 27. Common misconceptions to avoid

### 27.1 “The backend approves claims”

The backend requests/routes operations.

The contracts finalize oracle and auditor outcomes.

Benefits have an administrative confirmation path by design.

That is not the same as a backend-only claim settlement.

### 27.2 “The model rejects claims”

The model recommends a workflow.

The oracle protocol or manual adjudicator produces the contract decision.

### 27.3 “A Merkle root stores the hospital data”

A root commits to a dataset.

The records and proofs remain off-chain.

### 27.4 “Two oracles prove truth”

Two oracles provide a quorum mechanism.

They do not prove source independence or honest data.

### 27.5 “Encrypted IPFS is automatically private forever”

Encryption protects confidentiality if keys remain protected.

IPFS pinning/retention is still an availability concern.

### 27.6 “The `APPROVED` event means the enum is approved”

The active state is `PAYOUT_READY` or `FUNDING_REQUIRED`.

The event is retained for compatibility/decision observability.

### 27.7 “`CLOSED` is reachable today”

The enum/event remains.

There is no active current transition assigning it.

### 27.8 “Reputation weights votes”

Reputation is derived and displayed.

The on-chain manual threshold is one vote per assigned auditor.

### 27.9 “Phase-5 metrics are real insurance accuracy”

They are synthetic evaluation results.

They support methodology discussion, not production performance claims.

---

## 28. Historical phase mapping

### 28.1 Phase 1: protocol hardening foundation

The first major hardening introduced:

- A dedicated oracle coordinator.
- Exact result rather than Boolean majority.
- Commit/reveal timing.
- Version/root/model binding.
- Eligibility snapshots.
- Timeout/conflict failure.
- Historical registry roots.
- Oracle-side leaf reconstruction.
- Coordinator-aware backend verification.

### 28.2 Phase 2: automatic/funded economics direction

The next stage separated policy/economic logic.

It introduced:

- Versioned policy rules.
- Coverage reservations.
- Deductible/share/cap formula.
- Funding-required state.
- Automatic allocation after verified outcomes.

### 28.3 Phase 3: manual adjudication

The adjudication stage introduced:

- Four auditor seats.
- Deterministic assignment.
- Three-valid/two-invalid thresholds.
- Timeout rejection.
- Appeal rounds.
- Payout vault.
- Derived reputation observations.

### 28.4 Phase 4: evidence and benefits

The evidence/benefits stage introduced:

- Browser encryption.
- Recrypt access grants.
- Evidence-tree transparency.
- On-chain tree-head anchors.
- Death/surrender/maturity module.
- Beneficiary shares.

### 28.5 Phase 5: reproducibility and final integration

The final stage introduced or consolidated:

- Phase-5 evaluation profiles.
- Model identity artifacts.
- Registry/model/version synchronization.
- Deployment manifest identity.
- Indexer confirmations/reorg handling.
- Launcher safety.
- Whole-repository verification.

The exact Git commit names should be checked from repository history when writing a final thesis chronology.

---

## 29. Thesis writing guidance

### 29.1 Suggested chapter mapping

| Thesis topic | Implementation evidence |
|---|---|
| Problem statement | Hybrid trust boundary and claim auditability |
| System architecture | Six-layer architecture and deployment topology |
| Blockchain design | Manager, economics, coordinator, adjudicator, benefits |
| Oracle protocol | Commit/reveal, exact digest, snapshots, timeout |
| Data integrity | Merkle registry and evidence tree heads |
| Privacy | AES-GCM, Recrypt, off-chain encrypted storage |
| Machine learning | Feature schema, Bernoulli NB, calibration, profiles |
| Evaluation | Metrics, temporal holdout, attack checks, gas test |
| Security | Roles, replay/version binding, reservations, threat model |
| Limitations | Admin roots, synthetic data, HSM, source independence |

### 29.2 What to diagram

Recommended thesis diagrams include:

- High-level hybrid architecture.
- Claim state machine.
- Oracle commit/reveal timeline.
- Evidence encryption/grant/decryption sequence.
- Merkle registry publication/proof sequence.
- Manual review assignment/vote sequence.
- Economic reservation/payout sequence.
- Indexer confirmation/reorg sequence.

### 29.3 What to measure

Report:

- Contract bytecode size.
- Gas for key state transitions.
- Root-versus-individual hash storage.
- Oracle commit/reveal latency.
- Backend/indexer latency.
- Evidence encryption/upload/decryption time.
- Merkle proof size/build/verification time.
- Model ROC AUC and PR AUC.
- Model precision/recall/F1.
- Brier/calibration error.
- Temporal holdout performance.
- Manual-review timeouts.

### 29.4 What to qualify

Always qualify:

- Hybrid registry/data adaptation and controlled attack injection.
- Local-chain deployment.
- Admin-controlled publication.
- Operational oracle independence.
- Browser key custody.
- Model label quality.
- Development dependency findings.

### 29.5 Defensible contribution statement

The strongest contribution is integration.

The project demonstrates how financial state, external data consensus, private evidence, explainable workflow routing, and audit proofs can be composed without putting medical bytes on-chain.

It is not necessary to claim that every component is novel in isolation.

The thesis can argue that the integrated constraints expose realistic engineering trade-offs.

---

## 30. Maintenance rules for future changes

### 30.1 Contract changes

Before changing a contract:

1. Check manager bytecode headroom.
2. Check interface compatibility.
3. Add or update stateful tests.
4. Update deployment wiring.
5. Update ABI synchronization.
6. Update migration manifest if addresses/interfaces change.
7. Update this reference.

### 30.2 Oracle protocol changes

Any change to hash inputs must update:

- Solidity coordinator.
- `oracle/protocol.js`.
- Oracle worker.
- Backend transaction verification.
- Protocol tests.
- Documentation and model/registry binding notes.

Hash changes are protocol changes.

### 30.3 Model changes

Any model change must update:

- Feature schema.
- Model version.
- Training-data hash.
- Artifact hash.
- Model identity hash.
- Calibration artifact.
- Evaluation output.
- Deployment identity.

The request must bind the new identity.

### 30.4 Evidence changes

Any encryption format change must update:

- Magic/version.
- Associated-data schema.
- Browser serializer.
- Browser parser.
- Backend metadata validation.
- Auditor decryption path.
- Compatibility tests.

### 30.5 Registry changes

Any canonical leaf change must update:

- Field ordering.
- Normalization rules.
- Leaf hash implementation.
- Tree builder.
- Oracle reconstruction.
- Proof verification.
- Snapshot schema version.

Never change canonicalization silently.

---

## 31. Exact source map for reviewers

### 31.1 Solidity source map

- [`InsuranceManager.sol`](../contracts/contracts/InsuranceManager.sol): policies, claims, routing, payout orchestration.
- [`PolicyEconomics.sol`](../contracts/contracts/PolicyEconomics.sol): rules, coverage, reserves, settlement.
- [`OracleCoordinator.sol`](../contracts/contracts/OracleCoordinator.sol): request snapshots, commit/reveal, exact quorum.
- [`ClaimAdjudicator.sol`](../contracts/contracts/ClaimAdjudicator.sol): auditor assignment, votes, vault, reputation.
- [`EvidenceRegistry.sol`](../contracts/contracts/EvidenceRegistry.sol): encryption identities, tree-head anchors.
- [`PolicyBenefitsManager.sol`](../contracts/contracts/PolicyBenefitsManager.sol): benefit terms, beneficiaries, requests, withdrawals.
- [`ProtocolDeploymentRegistry.sol`](../contracts/contracts/ProtocolDeploymentRegistry.sol): component/migration identity.
- [`GasTestContract.sol`](../contracts/contracts/GasTestContract.sol): root-versus-individual hash experiment.

### 31.2 Oracle source map

- [`oracle/index.js`](../oracle/index.js): worker polling and transaction orchestration.
- [`oracle/protocol.js`](../oracle/protocol.js): result hash, salt, and commitment encodings.
- [`oracle/merkleProof.js`](../oracle/merkleProof.js): independent registry-leaf reconstruction and proof folding.
- `oracle/modelArtifact.js`: frozen-model integrity and request-identity checks.
- `oracle/cursorState.js`: deployment-scoped event cursor persistence.

### 31.3 Backend source map

- `backEnd/controllers/`: HTTP controller boundary.
- `backEnd/routes/`: route registration and middleware.
- `backEnd/models/`: Mongo schemas.
- `backEnd/services/contractService.js`: contract transaction/read integration.
- `backEnd/services/blockchainIndexerService.js`: event projection/checkpoint/reorg logic.
- `backEnd/services/featureEngineeringService.js`: current 18-feature schema.
- `backEnd/services/bernoulliNaiveBayesService.js`: probability inference.
- `backEnd/services/riskScoringService.js`: bands/recommendations.
- `backEnd/services/merkleRegistryService.js`: registry leaves/trees/proofs.
- `backEnd/services/hybridDatasetAdapterService.js`: public-source adaptation, splitting, sampling, and attacks.
- `backEnd/services/hybridDatasetIntegrityService.js`: manifest/output integrity verification.
- `backEnd/services/evidenceChainService.js`: per-claim encrypted-file hash chain.
- `backEnd/services/evidenceTransparencyService.js`: global RFC6962-style event log and proofs.
- `backEnd/services/evidenceAnchorService.js`: signed tree-head anchor flow.
- `backEnd/services/preTransformService.js`: Recrypt transformation.
- `backEnd/services/phase5EvaluationService.js`: evaluation profiles/metrics.
- `backEnd/services/triagePolicyService.js`: cost/capacity routing policy.
- `backEnd/services/logisticRegressionService.js`: provider-model comparators.
- `backEnd/services/reserveSimulationService.js`: seeded loss/reserve simulation.
- `backEnd/services/evidenceBenchmarkService.js`: encryption/PRE/proof experiments.
- `backEnd/services/policyBenefitsService.js`: benefit contract reads.
- `backEnd/services/settlementIntelligenceService.js`: portfolio/reserve summaries.
- `backEnd/scripts/evaluateHybridDataset.js`: provider-risk, comparator, ablation, bootstrap, and paired-attack study.
- `backEnd/scripts/generateResearchManifest.js`: cross-artifact hashes and environment identity.

### 31.4 Frontend source map

- [`frontEnd/src/App.jsx`](../frontEnd/src/App.jsx): route topology.
- `frontEnd/src/context/WalletContext.jsx`: wallet, SIWE session, chain, and role context.
- `frontEnd/src/services/evidenceEncryption.js`: browser envelope, AES-GCM, Recrypt capsule, identity recovery, and associated data.
- `frontEnd/src/pages/SubmitClaimPage.jsx`: encrypted claim choreography.
- `frontEnd/src/pages/ClaimDetailPage.jsx`: claim, evidence, appeal, and withdrawal state.
- `frontEnd/src/pages/AuditorVotingPage.jsx`: assigned wallet-signed contract vote.
- `frontEnd/src/pages/ThesisResultsDashboardPage.jsx`: frozen evaluation/result presentation.

### 31.5 Documentation source map

- [`README.md`](../README.md): current setup and operator workflow.
- [`docs/phase-5-operational-hardening.md`](../docs/phase-5-operational-hardening.md): verification, runtime synchronization, and future-run guidance.
- [`docs/protocol-v2-migration.json`](../docs/protocol-v2-migration.json): migration identity structure.
- [`docs/phase-0-1-2-research-assurance.md`](../docs/phase-0-1-2-research-assurance.md): model, triage, invariant, and assurance work.
- [`docs/phase-3-4-reserve-evidence-research.md`](../docs/phase-3-4-reserve-evidence-research.md): reserve and evidence experiments.
- [`paper-evidence/README.md`](../paper-evidence/README.md): frozen paper results, claim boundaries, and section map.
- [`block-insure-current-project-overview.md`](block-insure-current-project-overview.md): compact supervisor narrative.

---

## 32. Final implementation checklist

Before calling the repository “ready for a demonstration,” confirm:

- Hardhat node is the intended chain.
- Chain ID is `31337` for local work.
- Manager bytecode exists at the configured address.
- ABI/configuration files are synchronized.
- Mongo points to a disposable local database.
- IPFS credentials are available for evidence tests.
- Oracle workers have distinct identities.
- Oracle snapshots match the published root versions.
- Model identity matches the deployed model metadata.
- Four active auditors exist for manual review.
- Manager and benefits vaults are funded.
- Evidence identities are registered.
- Backend role records match on-chain roles.
- Indexer checkpoints are advancing.
- Notifications are being created.
- Claim receipts reconcile.
- Conflict/timeout paths are tested.
- Appeal version increments are visible.
- Historical roots are retained.
- Test and verification commands pass.

Before calling the project “production ready,” additionally require:

- Real authenticated external data sources.
- Independent oracle governance.
- HSM/KMS key custody.
- Privacy/legal review.
- Production monitoring and incident response.
- Formal contract audit.
- Dependency patch policy.
- Disaster recovery for Mongo/IPFS/evidence trees.
- A real actuarial/economic model.
- Regulatory and insurance-domain approval.

---

## 33. Current hybrid-data architecture

This section is the authoritative bridge between the original synthetic
protocol experiment and the present paper-ready hybrid study.

### 33.1 What was actually integrated

The implemented source is the public-secondary Kaggle **Healthcare Provider
Fraud Detection Analysis** Medicare benchmark. The current repository does not
join Texas PUDF, CMS CERT, LEIE, or a separately downloaded CMS utilization
table. Those sources were considered during planning, but the implemented
adapter uses these four compatible files:

| Raw file | Purpose | Bytes | SHA-256 |
|---|---|---:|---|
| `Train-1542865627584.csv` | Provider and weak `PotentialFraud` label | 87,094 | `09315a0e0c262ddfb91df15df76b196a80de2ff1001fad46b362b562df2e7e43` |
| `Train_Beneficiarydata-1542865627584.csv` | Demographic and chronic-condition context | 11,444,821 | `1fb7fb14efeaae04b970bfeb3176cdf938c755748217377109081d6dae01ecfd` |
| `Train_Inpatientdata-1542865627584.csv` | Inpatient claims | 8,572,555 | `395bc2d01a102bf44a26ba4b36c63e7086943eaf2d5d1489c776bf47d1613ac0` |
| `Train_Outpatientdata-1542865627584.csv` | Outpatient claims | 77,391,090 | `f532ed7e25f50d6abf3ba89ceeb2a23e2a352792f90d086b13999a561fd23889` |

The join keys already exist within this source family:

```text
provider label table.Provider
        ↕
claim.Provider

beneficiary table.BeneID
        ↕
claim.BeneID
```

This is not a fabricated cross-source join. The adapter preserves original
`ClaimID`, `BeneID`, and `Provider` internally for reproducibility while exposing
hashed/pseudonymous runtime aliases.

### 33.2 Three separate truth contracts

The dataset deliberately distinguishes:

1. `providerPotentialFraud`: the public dataset's weak provider-level label.
2. `controlledAttackTruth`: claim-level truth created only by deterministic
   Block-Insure attack injection.
3. On-chain protocol truth: claims, versions, roots, votes, decisions, balances,
   and settlements established by contracts.

`actualFraud` remains a deprecated compatibility alias for controlled synthetic
truth. It must not be interpreted as a real adjudicated Medicare claim label.

### 33.3 Source scale

| Quantity | Value |
|---|---:|
| Unique source claims | 558,211 |
| Inpatient claims | 40,474 |
| Outpatient claims | 517,737 |
| Providers | 5,410 |
| Beneficiaries | 138,556 |
| Claims attached to a `PotentialFraud` provider | 212,796 |

“Inpatient” means a hospitalization-style claim with admission/discharge data.
“Outpatient” means care not represented as an inpatient admission. Both are
useful here because Block-Insure needs realistic amount, diagnosis, procedure,
date, provider, and beneficiary activity distributions; the setting is a feature
and provenance field, not the core research label.

### 33.4 Provider-disjoint split

For provider identifier `p` and seed `s = 20260828`, the adapter computes:

```text
u(p) = uint32(first_8_hex(SHA256("split:" || s || p))) / 2^32
b(p) = floor(100 * u(p))
```

Then:

```text
train       if b < 64
calibration if 64 ≤ b < 80
test        if b ≥ 80
```

All claims from one provider remain in one partition.

| Partition | Claims | Providers |
|---|---:|---:|
| Train | 343,537 | 3,420 |
| Calibration | 105,277 | 905 |
| Untouched test | 109,397 | 1,085 |
| Paired test copy | 109,397 | same 1,085 |

This is provider-held-out evaluation, not complete entity isolation.
Beneficiaries can receive services from providers in different partitions:

| Pair | Shared beneficiaries |
|---|---:|
| Train–calibration | 39,364 |
| Train–test | 41,627 |
| Calibration–test | 21,210 |

Beneficiary identifiers are not provider-model features. The overlap remains a
generalization limitation and is disclosed instead of being hidden.

### 33.5 Amount and temporal preprocessing

The original claim amount is:

```text
sourceClaimAmountUsd = InscClaimAmtReimbursed + DeductibleAmtPaid
```

The runtime demonstration value is:

```text
demoAmount = max(sourceClaimAmountUsd / 10,000, 0.0001)
```

The divisor is a deterministic local-scale normalization, not an exchange rate.

Expected amount ranges are learned by treatment/setting from the training
partition using the 5th, 50th, and 95th percentiles. Provider and claimant
velocity use strictly prior records only: providers use a 30-day window and
beneficiaries use a 365-day window. The training-only 95th-percentile thresholds
are 239 prior provider claims and seven prior beneficiary claims respectively.
Claims on the same date are not counted as prior, and future records are never
used to construct a past activity count.

Age at service is approximated as:

```text
age = floor((serviceDate - dateOfBirth) / 365.25 days)
```

and converted to `CHILD`, `ADULT`, or `SENIOR`.

### 33.6 Generated artifact graph

```text
four raw CSV files
       │
       ├── source parsing and compatible joins
       ├── provider-disjoint split
       ├── training-only ranges/velocity thresholds
       └── deterministic provenance-preserving adaptation
              │
              ├── processed/train.jsonl
              ├── processed/calibration.jsonl
              ├── processed/test-untouched.jsonl
              ├── processed/test-attacks.jsonl
              ├── runtime/hybrid-primary.jsonl
              └── manifest.json + SHA-256 identities
```

Generated raw/JSONL files total roughly 1.3 GB and are ignored by Git. The
manifest, generator, evaluation code, and compact evidence tables are tracked.
Writes use temporary files plus atomic replacement so interruption cannot publish
a partially generated dataset as complete.

### 33.7 Controlled injection policy

Selection and scenario choice are independent deterministic hashes of the source
claim ID. Training and calibration use approximately 12% injection for the
protocol model experiment; the paired test copy uses 50% to obtain sufficient
per-attack evidence. Exact injected counts are 40,969 train, 12,600 calibration,
and 54,705 test records.

| Scenario | Mutation |
|---|---|
| `USED_INVOICE` | Marks invoice and record as used; raises prior count |
| `CANCELLED_RECORD` | Marks invoice and record cancelled |
| `INFLATED_AMOUNT` | Sets bill to `1.6 × expectedBillMax` |
| `DATE_MISMATCH` | Moves invoice date 45 days beyond discharge |
| `BLACKLISTED_HOSPITAL` | Changes provider license to blacklisted |
| `NEAR_DUPLICATE` | Enables the fuzzy near-duplicate advisory |
| `PROVIDER_COMPROMISE` | Enables provider velocity anomaly and latent compromise |
| `NOISY_RECORD` | Marks the record suspicious/noisy |

The untouched and attacked test files are paired by source claim ID. This makes
the injected probability change and routing decision attributable to the
controlled intervention rather than to different base claims.

### 33.8 Runtime sampling and compatibility

The live registry is not the first 5,000 source rows. An order-independent
bottom-hash sampler chooses 4,995 training records. Five stable legacy presets
are then appended, producing exactly 5,000 unique invoice identities. The five
presets preserve known normal, inflated, reused, blacklisted, and suspicious
paths used by the UI and automated workflows.

At reset, only preset treatment dates are aligned to the new local blockchain
clock. Their identities and amounts remain stable. The research JSONL files are
not modified by this runtime compatibility step.

## 34. Two-model boundary and provider-risk study

### 34.1 Why there are two models

| Model | Input/label | Research question | Runtime authority |
|---|---|---|---|
| `bernoulli-fraud-v3.1.0` | 18 synthetic protocol features and controlled truth | Can claim/registry irregularities be routed? | Advisory; rules/oracles/contracts remain authoritative |
| `provider-risk-real-v1.0.0` | Nine provider aggregates and weak `PotentialFraud` label | Can public claims rank providers for audit attention? | Separate research model; not a claim decision |

The second model did not replace the first because invoice reuse, registry proof
failure, cancellation, oracle disagreement, and near-duplicate truth do not exist
as controlled fields in the public claims source.

### 34.2 Provider aggregates

For provider `p` with claim set `C_p`, the evaluator computes:

```text
n_p              = |C_p|
uniqueBene_p     = |{beneficiary(c): c ∈ C_p}|
meanAmount_p     = Σ amount(c) / n_p
maxAmount_p      = max amount(c)
inpatientRatio_p = Σ I[inpatient(c)] / n_p
procedureRatio_p = Σ I[procedure(c) exists] / n_p
repeatRatio_p    = Σ I[previousClaimCount(c) > 0] / n_p
meanChronic_p    = Σ chronicConditionCount(c) / n_p
activityRatio_p  = Σ I[beneficiaryVelocityAnomaly(c)] / n_p
```

Each statistic becomes a Boolean “high” feature when it is at or above the 75th
percentile calculated from training providers only. This yields nine provider
features grouped as:

- volume/activity: claim volume, unique beneficiaries, repeat ratio, beneficiary
  activity ratio;
- financial: mean and maximum claim amount;
- setting/clinical: inpatient ratio, procedure ratio, and mean chronic-condition
  count.

### 34.3 Bernoulli Naive Bayes

For class `y ∈ {0,1}` and Boolean vector `x`, the unnormalized log posterior is:

```text
log P(y | x) ∝ log P(y)
 + Σ_i [x_i log θ_iy + (1 - x_i) log(1 - θ_iy)]
```

With Laplace smoothing `α = 1`:

```text
θ_iy = (N_iy + α) / (N_y + 2α)
P(y) = (N_y + α) / (N + 2α)
```

The provider model is trained on 3,420 providers. Raw probabilities are Platt
calibrated on the 905-provider calibration partition. The operating threshold is
selected by maximum calibration F1 over 0.01 increments; the frozen value is
`0.35`.

Model identity:

```text
version: provider-risk-real-v1.0.0
identity: 0xf5ab0e8ffece79578b50c64e4c0bd034de31d02efcc966e29c1830a681f34073
artifact: 943477f2f0d209f81a4672c65f9acdb3b581c0a9619cde89868bad168033bc49
```

### 34.4 Logistic comparators

The conventional comparator uses:

```text
z = β_0 + Σ_i β_i x_i
P(y=1|x) = 1 / (1 + exp(-z))
```

It is fitted by gradient descent for 1,200 iterations with learning rate `0.08`
and L2 penalty `0.002`. The class-weighted form uses:

```text
w_positive = N / (2N_positive)
w_negative = N / (2N_negative)
```

Both comparator thresholds are selected only on calibration data. They are not
quietly substituted for the frozen primary model.

### 34.5 Platt calibration

For uncalibrated probability `p`, define:

```text
logit(p) = ln(p / (1-p))
p_cal = sigmoid(a × logit(p) + b)
```

`a` and `b` are optimized on the calibration partition by binary cross-entropy
gradient descent. Calibration never uses held-out test labels.

### 34.6 Provider held-out results

Primary confusion matrix on 1,085 test providers:

```text
TP = 41, TN = 914, FP = 87, FN = 43
```

| Model | Threshold | Accuracy | Precision | Recall | F1 | MCC | ROC-AUC | PR-AUC | Brier | ECE |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Frozen Bernoulli NB | 0.35 | 0.8802 | 0.3203 | 0.4881 | 0.3868 | 0.3324 | 0.879659 | 0.357647 | 0.061496 | 0.050887 |
| Majority negative | 0.50 | 0.9226 | 0 | 0 | 0 | 0 | 0.500000 | 0.077400 | 0.071725 | 0.017317 |
| Unweighted rule score | 0.55 | 0.8765 | 0.3047 | 0.4643 | 0.3679 | 0.3110 | 0.872705 | 0.317528 | 0.084281 | 0.121147 |
| Logistic regression | 0.28 | 0.9014 | 0.4000 | 0.5476 | 0.4623 | 0.4156 | 0.897844 | 0.385694 | 0.055629 | 0.023933 |
| Class-weighted logistic | 0.35 | 0.8995 | 0.3932 | 0.5476 | 0.4577 | 0.4107 | 0.898680 | 0.396625 | 0.058499 | 0.046057 |

The high majority-negative accuracy is caused by class imbalance and is not a
useful screening result. Logistic comparators outperform the frozen Bernoulli
model on several ranking and operating-point metrics. The defensible conclusion
is model modularity and useful-but-moderate provider ranking, not superiority of
Naive Bayes.

### 34.7 Provider bootstrap intervals

The evaluator resamples the 1,085 held-out providers with replacement 1,000
times using seed `20260829`. For metric `m`, the percentile interval is:

```text
CI_95(m) = [quantile_0.025(m*), quantile_0.975(m*)]
```

| Metric | Point | Lower | Upper |
|---|---:|---:|---:|
| ROC-AUC | 0.879659 | 0.848782 | 0.907807 |
| PR-AUC | 0.357647 | 0.263143 | 0.459932 |
| Precision | 0.3203 | 0.2403 | 0.4056 |
| Recall | 0.4881 | 0.3750 | 0.6038 |
| F1 | 0.3868 | 0.3011 | 0.4706 |
| MCC | 0.3324 | 0.2422 | 0.4222 |

The provider, not the claim, is the resampling unit.

### 34.8 Feature-group ablation

Each experiment removes one group, retrains Bernoulli NB, recalibrates, and
selects its threshold on calibration data.

| Removed group | Threshold | ROC-AUC | Δ ROC-AUC | PR-AUC | Δ PR-AUC | F1 | Δ F1 |
|---|---:|---:|---:|---:|---:|---:|---:|
| Volume/activity | 0.26 | 0.778131 | -0.101528 | 0.211370 | -0.146277 | 0.3556 | -0.0312 |
| Financial | 0.42 | 0.868205 | -0.011454 | 0.352464 | -0.005183 | 0.3919 | +0.0051 |
| Setting/clinical | 0.44 | 0.894464 | +0.014805 | 0.370565 | +0.012918 | 0.4623 | +0.0755 |

Volume/activity is the most important group in this encoding. The positive delta
after removing setting/clinical fields suggests that those Boolean features add
noise or redundancy; it is not evidence that clinical context is generally
useless.

## 35. Protocol-risk routing and attack evaluation

### 35.1 Deployed 18-feature interface

The protocol model consumes:

```text
clean_registry_match, registry_record_missing, hospital_id_mismatch,
invoice_hash_mismatch, claim_exceeds_registry_bill, bill_range_anomaly,
treatment_type_mismatch, date_mismatch, invalid_record_status, used_invoice,
cancelled_record, license_suspended, license_blacklisted,
repeat_claim_pattern, provider_velocity_anomaly, claimant_velocity_anomaly,
near_duplicate_advisory, missing_or_noisy_record
```

The frozen model threshold remains `0.5`, but the deployed capacity/cost triage
policy routes non-hard-blocked review at `0.21796945267587475`.

### 35.2 Cost/capacity threshold

For missed-fraud cost `C_m`, false-escalation cost `C_f`, and review cost `C_r`,
the economic review crossover is:

```text
t_economic = (C_r + C_f) / (C_m + C_f)
```

The frozen fraud-averse values `(10, 1, 0.25)` give:

```text
t_economic = 1.25 / 11 = 0.11363636...
```

For nominal review capacity `q = 0.20`, `t_capacity` is the probability at the
top-20% boundary of calibration scores. The deployed policy uses:

```text
t_manual = max(t_economic, t_capacity)
         = max(0.113636..., 0.217969...)
         = 0.217969...
```

The cost model for one evaluated partition is:

```text
expectedCost = FN × C_m
             + legitimateEscalations × C_f
             + manualReviews × C_r
```

This is an offline planning model. It does not implement a live auditor queue
service-level guarantee.

### 35.3 Authority-aware routing

Hard integrity features are missing record, hospital mismatch, invoice mismatch,
invalid status, used invoice, cancelled record, and blacklisted license.

Committed anomaly/manual features are amount excess, bill-range anomaly, date
mismatch, near duplicate, and noisy record.

```text
if hard comparison/feature:
    REJECT_ORACLE_VERIFICATION
else if fuzzy or committed anomaly feature:
    MANUAL_REVIEW_RECOMMENDED
else if calibratedProbability ≥ t_manual:
    MANUAL_REVIEW_RECOMMENDED
else:
    AUTO_VERIFY_RECOMMENDED
```

Only authoritative comparison failure can drive the rejection recommendation.
Probability alone abstains to review.

### 35.4 Paired routing ablation

| Strategy | Untouched escalation | Controlled attack recall | Precision | F1 | MCC |
|---|---:|---:|---:|---:|---:|
| Probabilistic model only | 0.0037% | 55.25% | 99.99% | 71.17% | 0.6177 |
| Integrity rules only | 7.7845% | 88.74% | 92.00% | 90.34% | 0.8107 |
| Combined | 7.7881% | 100.00% | 92.83% | 96.28% | 0.9255 |

The combined confusion matrix on the paired attacked file is:

```text
TP = 54,705, TN = 50,466, FP = 4,226, FN = 0
```

Combined ROC-AUC is `0.957050`, PR-AUC `0.920748`, and mean injected
probability increase `0.2167603`.

### 35.5 Scenario complementarity

| Scenario | Records | Model-only recall | Rule-only recall | Combined recall |
|---|---:|---:|---:|---:|
| Blacklisted hospital | 6,940 | 10.46% | 100% | 100% |
| Cancelled record | 6,999 | 100% | 100% | 100% |
| Date mismatch | 6,789 | 31.51% | 100% | 100% |
| Inflated amount | 6,879 | 0% | 100% | 100% |
| Near duplicate | 6,874 | 100% | 100% | 100% |
| Noisy record | 6,737 | 0% | 100% | 100% |
| Provider compromise | 6,702 | 100% | 8.09% | 100% |
| Used invoice | 6,785 | 100% | 100% | 100% |

This is the most direct quantitative evidence for the hybrid decision
architecture: rules are strong for explicit integrity mutations, while the model
adds coverage for provider compromise. The 100% result is bounded to these eight
deterministic scenarios and is not real-world fraud-detection accuracy.

## 36. Statistical formula reference

Let `TP`, `TN`, `FP`, and `FN` have their standard confusion-matrix meanings.

```text
Accuracy    = (TP + TN) / (TP + TN + FP + FN)
Precision   = TP / (TP + FP)
Recall/TPR  = TP / (TP + FN)
Specificity = TN / (TN + FP)
FPR         = FP / (TN + FP) = 1 - Specificity
F1          = 2PR / (P + R)
Fβ          = (1 + β²)PR / (β²P + R), with β = 2 for F2
```

Matthews correlation coefficient is:

```text
MCC = (TP×TN - FP×FN)
      / sqrt((TP+FP)(TP+FN)(TN+FP)(TN+FN))
```

The ROC curve plots TPR against FPR over thresholds. The implementation uses a
0.01 threshold grid and trapezoidal integration:

```text
AUC ≈ Σ (FPR_i - FPR_{i-1}) × (TPR_i + TPR_{i-1}) / 2
```

PR-AUC is implemented as average precision:

```text
AP ≈ Σ (Recall_i - Recall_{i-1}) × Precision_i
```

For probability `p_i` and binary outcome `y_i`:

```text
Brier = (1/N) Σ (p_i - y_i)²
```

Expected calibration error uses ten equal-width probability bins:

```text
ECE = Σ_b (n_b/N) × |meanProbability_b - positiveFrequency_b|
```

These metrics answer different questions: ROC-AUC measures ranking, PR-AUC
emphasizes positive retrieval under imbalance, F1 describes one operating point,
Brier measures squared probability error, and ECE measures reliability by bins.

## 37. Contract and economic formula compendium

### 37.1 Transparent advisory premium quote

The backend quote multiplies basis-point factors for risk, treatment, age, claim
history, and an optional manual factor:

```text
combinedBps_0 = 10,000
combinedBps_k = round(combinedBps_(k-1) × factorBps_k / 10,000)
quotedPremium = floor(basePremiumWei × combinedBps_final / 10,000)
```

The five `factorBps` values are risk, treatment, age, claim history, and manual
factor in that order. Claim-history multiplier is
`10,000 + 500 × min(historyCount, 5)`. A supplied manual multiplier is rounded
to basis points and clamped to `[5,000, 30,000]`; absent/invalid lookup keys use
their documented defaults. The quote is advisory; the on-chain package premium
is authoritative at purchase.

### 37.2 Claim settlement

With claim amount `A`, deductible rate `d`, deductible cap `D`, and insurer share
`s` in basis points:

```text
rateDeductible       = floor(A × d / 10,000)
deductible           = min(A, rateDeductible, D)
afterDeductible      = A - deductible
insurerPays          = floor(afterDeductible × s / 10,000)
claimantResponsibility = A - insurerPays
```

Coverage conservation requires:

```text
reservedCoverage + settledCoverage + newLiability ≤ coverageLimit
remainingCoverage = coverageLimit - reservedCoverage - settledCoverage
```

### 37.3 Solvency guard

For approved but unfunded liability `U`, minimum buffer `B`, active exposure `E`,
and reserve ratio `r` basis points:

```text
minimumTreasuryBalance = U + B + floor(E × r / 10,000)
```

The current on-chain defaults are `r = 500` basis points (5%) and
`B = 0.1 ether`; both can be changed through authorized solvency configuration.

### 37.4 Oracle exact consensus

The worker constructs the semantic result hash as:

```text
resultHash = keccak256(abi.encode(
  requestId, claimId, queryHash, claimVersion, registryVersion,
  registryRoot, modelVersion, verified,
  keccak256(UTF8(verificationCode)), leafHashOrZero
))

salt = keccak256(solidityPacked(
  oraclePrivateKeyBytes32, requestId, oracleAddress
))

commitment = keccak256(abi.encode(
  requestId, claimVersion, registryVersion, verified,
  resultHash, modelVersion, salt
))
```

A reveal is valid only when recomputation matches the stored commitment and all
explicit version fields match the request snapshot. The oracle address is bound
indirectly through salt derivation and the coordinator's per-address commitment
mapping; it is not an extra ABI field in `commitment`. Exact quorum counts:

```text
exactDigest = keccak256(abi.encode(
  verified, resultHash, claimVersion, registryVersion, modelVersion
))
```

Conflicting complete responses or timeout route the claim away from automatic
settlement.

### 37.5 Healthcare registry Merkle tree

The current registry implementation is exactly:

```text
leaf = 0x || SHA256_UTF8(JSON.stringify(canonicalRecord))
node = 0x || SHA256_UTF8(strip0x(leftChild) || strip0x(rightChild))
```

Internal hashing therefore consumes 128 hexadecimal characters as UTF-8, not
64 decoded digest bytes, and uses no domain prefix. An odd final node is paired
with itself. Proof verification folds the leaf with each sibling according to
recorded orientation. A balanced tree with `n` leaves has approximate depth
`ceil(log2 n)`; 5,000 leaves therefore require depth 13.

This formula is specific to the healthcare registry. The independent evidence
transparency log in Section 9 uses RFC6962-style byte prefixes `0x00` and
`0x01` and must not share this verifier.

## 38. Reserve-adequacy experiment

### 38.1 Model

For `N = 1,000` policies and scenario claim frequency `f`, annual claim count is:

```text
K ~ Poisson(λ), λ = Nf
```

For median severity `m`, lognormal dispersion `σ`, and `Z ~ Normal(0,1)`:

```text
X = exp(ln(m) + σZ)
```

With coverage cap `L = 1 ETH`, deductible rate `0.10`, deductible cap `0.02 ETH`,
and insurer share `0.80`:

```text
covered_i    = min(max(X_i, 0), L)
deductible_i = min(0.10 × covered_i, 0.02)
liability_i  = max(covered_i - deductible_i, 0) × 0.80
annualLoss   = Σ_{i=1..K} liability_i
```

For exposure `E = 1,000 ETH` and capital ratio `r`:

```text
capital       = E × r
shortfall     = max(annualLoss - capital, 0)
P_shortfall   = count(shortfall > 0) / periods
expectedShortfall = mean(shortfall | shortfall > 0)
unfundedFraction  = Σ shortfall / Σ annualLoss
```

The seeded Monte Carlo uses 5,000 periods, seed `410034`, ratios
`{2%,5%,8%,10%,15%,20%,30%}`, and a 1% target shortfall probability. A
250-resample loss bootstrap produces the displayed 95% interval.

### 38.2 Scenarios and results at the current 5% reserve

| Scenario | Frequency | Median | Sigma | P(shortfall) | 95% interval | Conditional expected shortfall | Recommended ratio |
|---|---:|---:|---:|---:|---:|---:|---:|
| Baseline | 0.12 | 0.35 | 0.65 | 0.22% | 0.10–0.34% | 0.6076 ETH | 5% |
| High frequency | 0.24 | 0.35 | 0.65 | 100% | 100–100% | 25.7306 ETH | 10% |
| Heavy tail | 0.12 | 0.42 | 1.15 | 28.38% | 27.34–29.43% | 3.3047 ETH | 8% |
| Combined stress | 0.24 | 0.42 | 1.15 | 100% | 100–100% | 44.0556 ETH | 15% |

The assumptions are synthetic and omit dependence, inflation, reinsurance,
expenses, premium income, and claim development. The result is a stress-control
demonstration, not statutory solvency certification.

## 39. Confidential-evidence experiment

### 39.1 Cryptographic pipeline

```text
browser plaintext
   ├── random AES-256 key
   ├── random GCM IV
   ├── claim/version metadata as authenticated associated data
   └── AES-256-GCM ciphertext + authentication tag
          │
          ├── content-addressed off-chain storage
          ├── encrypted SHA-256 receipt
          └── Recrypt capsule protecting the AES key

authorized recipient identity
   └── proxy transformation → recipient recovery → AES-GCM decryption

evidence lifecycle events
   └── RFC6962-style Merkle tree → signed/anchored tree head
```

AES-GCM provides content confidentiality and integrity. Associated data binds
the ciphertext to claim/version context. Proxy re-encryption allows recipient
access without publishing the symmetric key. The on-chain evidence registry
anchors identity versions and tree heads, not plaintext.

Revocation prevents future transformation service; it cannot erase plaintext
already recovered by a recipient. Ciphertext size and access metadata remain
observable.

### 39.2 Document latency

Thirty repetitions per item were measured locally. The benchmark uses
deterministically generated non-clinical plaintext and a deterministic
SHA-256-derived AES key for reproducibility, but a fresh random 12-byte IV for
each measured encryption. It exercises Node's AES-256-GCM and an in-process
content-addressed store rather than the browser/Pinata network path.

| Document | Bytes | Expansion | AES enc p50/p95 ms | AES dec p50/p95 ms | Local put/get p95 ms |
|---|---:|---:|---:|---:|---:|
| Small invoice PDF | 16,384 | 28 | 0.0374 / 0.0568 | 0.0333 / 0.0562 | 0.0278 / 0.0134 |
| Multipage PDF | 262,144 | 28 | 0.3503 / 0.4773 | 0.3171 / 0.6223 | 0.3630 / 0.1914 |
| Scanned image | 1,048,576 | 28 | 1.3785 / 3.4315 | 1.2039 / 3.3405 | 2.4801 / 1.1885 |

The constant 28-byte expansion is the benchmark serialization's 12-byte IV plus
16-byte GCM tag. The browser's actual `BINSENC2` payload additionally prepends
its eight-byte magic discriminator, so its fixed envelope overhead is 36 bytes.
Local content-store times exclude Pinata, public IPFS, and network latency.

### 39.3 Proxy re-encryption latency

| Recipients | Capsule bytes | Transform p50/p95 ms | Recipient decrypt p50/p95 ms |
|---|---:|---:|---:|
| 1 | 932 | 14.7330 / 15.4792 | 18.3115 / 19.4806 |
| 2 | 932 | 14.4849 / 14.8438 | 18.1376 / 18.4857 |
| 4 | 932 | 14.5082 / 14.7843 | 18.1418 / 18.3907 |

The measurement count scales with recipients; the reported row summarizes
per-transformation/per-recipient operations rather than total batch latency.

### 39.4 Evidence proof latency

| Tree size | Proof nodes | Proof bytes | Build/prove p50/p95 ms | Verify p50/p95 ms |
|---|---:|---:|---:|---:|
| 32 | 5 | 160 | 0.1381 / 0.4264 | 0.0141 / 0.0579 |
| 128 | 7 | 224 | 0.5283 / 0.8980 | 0.0161 / 0.0237 |
| 512 | 9 | 288 | 1.9764 / 8.7425 | 0.0190 / 0.0252 |

All eight adversarial cases were detected: ciphertext bit flip, wrong associated
data, replaced receipt, replaced CID, unavailable gateway, corrupted inclusion
proof, revoked grant, and stale key version. This is 8/8 bounded test coverage,
not proof of regulatory compliance.

## 40. Runtime, gas, and deployment measurements

### 40.1 Hybrid registry benchmark

The runtime benchmark records:

```text
records                 = 5,000
real-derived records    = 4,995
compatibility presets   = 5
tree depth              = 13
cold tree build         = 90.0891 ms
mean proof build        = 0.004009 ms
mean proof verification = 0.024585 ms
heap delta              = 23,554,728 bytes
sampled proofs          = 100/100 valid
```

Proof lookup uses an invoice-hash index and one cached tree per immutable
snapshot. Timings are local-machine descriptions and are excluded from the
research reproducibility hash.

### 40.2 Merkle root gas comparison

| Records represented | Individual-hash gas | Root gas | Gas saved | Saving |
|---|---:|---:|---:|---:|
| 10 | 249,268 | 43,851 | 205,417 | 82.41% |
| 25 | 590,677 | 43,851 | 546,826 | 92.58% |
| 50 | 1,159,764 | 43,851 | 1,115,913 | 96.22% |
| 100 | 2,297,770 | 43,851 | 2,253,919 | 98.09% |
| 200 | 4,573,986 | 43,851 | 4,530,135 | 99.04% |
| 500 | 11,402,190 | 43,851 | 11,358,339 | 99.62% |

This experiment isolates storage gas. It does not include off-chain storage,
proof construction, governance, or data availability cost.

### 40.3 Local claim-load observation

| Concurrency | Attempted | Successful | Failed | Successful claims/s | End-to-end mean | p95 |
|---|---:|---:|---:|---:|---:|---:|
| 1 | 1 | 1 | 0 | 6.5740 | 151.99 ms | 151.99 ms |
| 5 | 5 | 5 | 0 | 22.7484 | 219.06 ms | 219.76 ms |
| 10 | 10 | 10 | 0 | 29.8951 | 332.19 ms | 334.39 ms |
| 20 | 20 | 20 | 0 | 48.3827 | 411.42 ms | 412.74 ms |
| 50 | 50 | 39 | 11 | 49.2880 | 787.85 ms | 790.66 ms |

The 50-concurrency row contains nonce-queue failures. It is a local saturation
observation, not production throughput. Hardhat automining, one machine, local
MongoDB, and synthetic concurrency prevent public-chain extrapolation.

### 40.4 Bytecode size

| Contract | Bytes | EIP-170 headroom |
|---|---:|---:|
| `InsuranceManager` | 24,262 | 314 |
| `OracleCoordinator` | 7,014 | 17,562 |
| `ClaimAdjudicator` | 10,818 | 13,758 |
| `PolicyEconomics` | 9,484 | 15,092 |
| `EvidenceRegistry` | 4,135 | 20,441 |
| `PolicyBenefitsManager` | 9,981 | 14,595 |
| `ProtocolDeploymentRegistry` | 923 | 23,653 |

The manager's 314-byte headroom is a material maintainability risk. Additional
logic should move to modules rather than expanding the manager.

## 41. Verification, reproducibility, and artifact authority

### 41.1 Current assurance snapshot

- Contract tests: 127 passing.
- Backend analytics/unit tests: 63 passing.
- Oracle tests: 13 passing.
- Hybrid adapter focused tests: 8 passing.
- Solidity coverage: 93.77% statements, 65.07% branches, 90.59% functions,
  94.39% lines.
- Stateful/invariant campaigns: passed.
- Mutation campaign: 8 requested, 8 valid, 8 killed, 0 survived; score 1.0.
- Frontend lint and production build: passed.
- Repository integrity and runtime synchronization: passed.

Lower branch coverage must remain visible. Passing tests and killed sampled
mutants are evidence of assurance effort, not formal verification.

### 41.2 Live end-to-end validation

On 2026-08-29 the managed hybrid stack—Hardhat, MongoDB, backend, frontend, and
two oracle workers—passed:

1. five browser smoke/role tests in 30.3 seconds; and
2. two complete workflows in approximately 84 seconds.

The workflow tests cover:

```text
policy purchase
  → encrypted claim submission
  → dual-oracle verification
  → automatic adjudication
  → payout
  → SETTLED

oracle negative-verification path
  → manual review
  → three assigned auditor votes
  → consensus
  → payout
  → SETTLED
```

These results establish demonstration functionality on the frozen local stack.
They do not establish Internet deployment availability.

### 41.3 Reproduction commands

```text
npm run research:all
npm run verify:full
npm --prefix contracts run coverage
npm run research:paper-evidence
```

For a clean live hybrid demonstration:

```text
terminal 1: npm run dev:hybrid
terminal 2: npm run test:e2e
terminal 2: npm run test:e2e:workflow
```

Only one managed local stack should run at a time. A stale dev process can index
the database while another bootstrap expects a clean state; stop the previous
process tree before a fresh `dev:hybrid` launch.

### 41.4 Artifact hierarchy

| Artifact | Authority |
|---|---|
| `hybrid-v1/manifest.json` | Dataset counts, partitions, source/output hashes |
| `hybrid-v1-evaluation.json` schema 2 | Provider and controlled-routing study |
| `provider-risk-real-v1.0.0.json` | Frozen provider model |
| `phase5-evaluation.json` schema 4 | Synthetic protocol-model/triage study |
| `phase3-reserve-evaluation.json` | Reserve simulation |
| `phase4-evidence-evaluation.json` | Evidence lifecycle benchmark |
| `research-manifest-v4.json` | Cross-artifact reproducibility identity |
| `phase5-verification.json` | Structured cross-package verification |
| `paper-evidence/paper-metrics.json` | Paper-facing aggregation of authoritative inputs |

Research reproducibility identity:

```text
6a99593b052be9f99d439636039395f2c60760415c16e41a478da56869853ca0
```

Hybrid evaluation reproducibility hash:

```text
526943f75823bf9b7738a013883d620dd90986742f87131ccbeeec2c8895fd0f
```

Generated timestamps and wall-clock timings can change. Deterministic data,
model, policy, compiler, bytecode, and semantic result identities are what make
scientific comparison possible.

## 42. Paper and defense interpretation

### 42.1 Defensible central statement

> Block-Insure combines real-world-derived healthcare claims and provider-risk
> data with controlled synthetic adversarial scenarios to evaluate provider-risk
> prioritization, claim-irregularity routing, adjudication, and protocol
> robustness while preserving a functioning decentralized insurance workflow.

### 42.2 Claims supported by the repository

- The platform implements policy purchase, premium/coverage tracking, encrypted
  claim evidence, oracle commit/reveal, exact consensus, auditor fallback,
  versioned appeals, reserve-aware payout, benefits, indexing, and audit views.
- The provider-risk model has useful ranking but moderate threshold performance
  on a provider-held-out weak-label study.
- Explicit rules and probabilistic screening are complementary on the controlled
  attack set.
- A 5,000-record hybrid runtime preserves the complete demonstration workflow.
- The reserve and evidence experiments are deterministic, bounded, and
  reproducible under their stated assumptions.

### 42.3 Claims not supported

Do not claim:

- confirmed claim-level fraud labels from `PotentialFraud`;
- 100% real-world fraud detection;
- that provider risk proves an individual claim fraudulent;
- that 558,211 records are all loaded into the live blockchain registry;
- production or public-chain throughput;
- independent real hospital oracle truth;
- statutory reserve adequacy;
- HIPAA/GDPR/regulatory compliance;
- formal verification or a professional smart-contract audit;
- public testnet deployment or production key custody;
- beneficiary-disjoint generalization;
- that demo amount normalization is a currency conversion.

### 42.4 Strongest negative results to report

Good research includes results that constrain claims:

- Logistic regression outperforms the frozen Bernoulli provider model on several
  held-out metrics.
- Setting/clinical Boolean features do not improve the simple provider model in
  the current ablation.
- Model-only routing misses inflated and noisy mutations completely.
- Rule-only routing captures only 8.09% of provider-compromise attacks.
- The fixed 5% reserve fails all simulated high-frequency and combined-stress
  periods.
- The 50-concurrency local run has 11 failures.
- Solidity branch coverage is 65.07%, below statement/line coverage.
- The manager has only 314 EIP-170 bytes of headroom.

These findings strengthen the motivation for hybrid routing, modular contracts,
stress-aware reserves, and honest limitation reporting.

### 42.5 Paper-ready evidence map

- Central metrics and boundaries: [`paper-evidence/README.md`](../paper-evidence/README.md)
- Machine-readable aggregate: [`paper-evidence/paper-metrics.json`](../paper-evidence/paper-metrics.json)
- CSV tables: [`paper-evidence/tables/`](../paper-evidence/tables/)
- Editable SVG figures: [`paper-evidence/figures/`](../paper-evidence/figures/)
- Starter BibTeX: [`paper-evidence/references.bib`](../paper-evidence/references.bib)
- Source-use register: [`paper-evidence/source-register.md`](../paper-evidence/source-register.md)

## 43. `PolicyBenefitsManager` implementation reference

Source: [`contracts/contracts/PolicyBenefitsManager.sol`](../contracts/contracts/PolicyBenefitsManager.sol)

### 43.1 Boundary and authority

The benefits module is a separate funded vault for death, surrender, and
maturity benefits. It reads policy ownership, package, lifecycle status,
coverage, premiums, and installment counts from `InsuranceManager`; it does not
modify ordinary claim status or spend the manager/adjudicator claim vault.

Publication, approval, rejection, settlement, pause, unpause, and excess
withdrawal require the caller to hold the manager's current `ADMIN_ROLE`.
Benefit confirmation is therefore an explicit administrative path, not the
oracle/auditor claim-consensus path.

### 43.2 Versioned benefit terms

Each package can publish increasing (not necessarily consecutive) `uint32`
versions containing:

- enable flags for death, surrender, and maturity;
- death benefit, surrender value, and maturity bonus in basis points;
- minimum surrender installments; and
- a nonzero external terms-document hash.

Rate fields cannot exceed 10,000 basis points. An enabled death or surrender
benefit requires a positive rate. A policy records the benefit-term version it
accepts; the first beneficiary/benefit action can lazily accept the latest
version when the holder is the caller. Later package publication does not
silently change that accepted policy version.

The local deployment publishes package 1/version 1 with 100% death cover, 50%
surrender value, maturity disabled, zero maturity bonus, and six minimum
surrender installments. It initially funds the separate benefits vault with
2 ETH. These are local demonstration defaults, not actuarial recommendations.

### 43.3 Beneficiaries

A holder may configure one to three distinct, nonzero beneficiary addresses.
The holder cannot name itself, every share must be positive, and shares must
sum to exactly 10,000 basis points. Beneficiaries become locked once a death
request exists unless that request was rejected.

### 43.4 Request eligibility and amount formulas

Only one request per policy and benefit type can be live; a rejected request can
be replaced. With policy coverage `C`, total premiums `P`, and basis-point rates
`d`, `s`, and maturity bonus `m`:

```text
deathAmount     = floor(C × d / 10,000)
surrenderAmount = floor(P × s / 10,000)
maturityAmount  = floor(P × (10,000 + m) / 10,000)
```

Death requires an effectively `ACTIVE` policy, nonzero evidence hash,
configured beneficiaries, and a beneficiary caller. Surrender requires the
holder, an effectively `CANCELLED` policy, and the minimum installment count.
Maturity requires the holder and an effectively `EXPIRED` policy.

### 43.5 Approval, allocation, and withdrawal

Approval changes `REQUESTED → APPROVED` only when the vault can cover existing
reserved liability plus the new amount. Rejection can change `REQUESTED` or
`APPROVED → REJECTED`; rejecting an approved request releases its reservation.

Settlement changes `APPROVED → ALLOCATED` and creates pull balances. Death
amounts are split by beneficiary basis points; integer-rounding remainder is
assigned to the final beneficiary so the complete amount is conserved.
Surrender/maturity goes to the holder. `withdrawBenefit` zeroes the caller's
balance before transfer and uses a reentrancy guard. Request status remains
`ALLOCATED` after withdrawal.

The admin may withdraw only balance above `totalReservedLiabilityWei`.
Pause blocks beneficiary/holder mutation, requesting, approval, allocation, and
withdrawal, while rejection remains callable so reserved liability can be
released.

## 44. `ProtocolDeploymentRegistry` implementation reference

Source: [`contracts/contracts/ProtocolDeploymentRegistry.sol`](../contracts/contracts/ProtocolDeploymentRegistry.sol)

### 44.1 Purpose

The deployment registry is a directory, not a proxy. It stores an immutable
administrator, immutable protocol-version hash, current migration-manifest
hash, and one current record per component ID:

```text
componentId → {deployment, interfaceVersion, registeredAt, active}
```

Local setup uses `keccak256("BLOCK_INSURE_V1")` as protocol identity and
registers manager, coordinator, adjudicator, economics, evidence registry, and
benefits manager with hashed `/1` interface labels.

### 44.2 Mutation and historical boundary

Only the immutable administrator can register a component or commit a nonzero
migration-manifest hash. Registration validates nonzero component, deployment,
and interface-version values, then overwrites the current mapping entry and
emits `ComponentRegistered`. Manifest commitment likewise replaces the current
hash and emits `MigrationManifestCommitted`.

Consequently, the contract is not an immutable version history: event logs are
required to reconstruct prior registrations/manifest commitments. Its safety
property is that it cannot redirect proxy execution or mutate module links
inside an already deployed manager. It provides deployment discovery and
migration commitments, not upgrade governance.

## 45. Audit-sensitive implementation distinctions

These details are easy to state incorrectly in a paper or demonstration:

- `dev:hybrid` is the current clean hybrid launcher and is intentionally
  destructive to local Block-Insure Mongo data; `dev:all` is the reuse path.
- The 558,211 real-derived claims are an offline study. Exactly 4,995 sampled
  real-derived records plus five presets form the 5,000-record live registry.
- Provider `PotentialFraud` is a weak provider-risk label, never confirmed
  claim-level fraud truth.
- Healthcare-registry Merkle hashing uses JSON/text-hex SHA-256 without domain
  prefixes; evidence-log hashing is a separate RFC6962-style construction.
- Registry root is explicit in the oracle request and worker result hash, but
  is not a separate reveal argument or exact-digest field.
- Auditor contract consensus is unweighted 3-valid/2-invalid. Backend weighted
  vote summaries and `NEEDS_MORE` are compatibility/display residue only.
- Benefit withdrawal does not create a `WITHDRAWN` request status.
- The current indexer excludes benefits and deployment-registry events.
- `AUTH_SESSION_TTL_MS`, not the retained `JWT_EXPIRES_IN` template entry,
  controls backend session duration.
- `BINSENC2` runtime ciphertext adds 36 fixed bytes; the evidence benchmark's
  smaller serialization adds 28.
- The deployment registry can overwrite directory records, but it cannot
  upgrade or redirect deployed protocol contracts.

## 46. Closing interpretation

Block-Insure is best understood as a constrained experiment in accountable automation.

The blockchain does not store the hospital record.

The oracle does not become a trusted administrator.

The model does not become a judge.

The auditor does not become an unbounded override.

The backend does not become the final ledger.

Each component has a bounded role.

The protocol's value comes from composing those roles.

Sensitive evidence remains encrypted.

External facts are committed to a versioned registry root.

Oracle claims are hidden before reveal.

Consensus requires exact semantic agreement.

Ambiguity moves to a deterministic human-review process.

Liability is reserved before settlement.

Payouts use an explicit pull balance.

Appeals create a fresh version.

Evidence histories can be anchored without exposing medical bytes.

The research contribution is therefore the system boundary and its verifiable transitions.

The limitations are part of the result.

They show exactly where cryptography ends, where administration begins, and where future production work would be required.
