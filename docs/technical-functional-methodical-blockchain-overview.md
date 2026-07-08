# Block-Insure Technical, Functional, Methodical, and Blockchain Overview

## 1. Purpose of the System

Block-Insure is a thesis prototype for blockchain-backed health insurance claim processing. The system combines a Solidity smart contract, an Express/MongoDB backend, independent oracle-node processes, a React frontend, and an experimental fraud-risk model.

The main objective is not to replace real insurance infrastructure. The objective is to demonstrate how blockchain can provide lifecycle integrity, settlement traceability, oracle accountability, and auditability for an insurance workflow that would normally depend on a centralized backend database.

The current implementation focuses on five technical themes:

- Policy package creation and policy purchase.
- Claim submission, duplicate detection, and lifecycle tracking.
- Multi-oracle registry verification using Merkle commitments.
- Fraud-risk scoring and auditor/manual review.
- On-chain approval, settlement, closure, and audit evidence.

## 2. High-Level Architecture

The project is organized into four main runtime layers:

| Layer | Technology | Responsibility |
| --- | --- | --- |
| Smart contract | Solidity, Hardhat, OpenZeppelin | Source of truth for policy, claim, oracle, voting, and settlement lifecycle |
| Backend API | Node.js, Express, MongoDB, ethers.js | Authentication, user-facing APIs, document handling, registry services, admin actions, analytics |
| Oracle service | Node.js, ethers.js, Axios | Watches oracle requests, checks hospital registry data, submits signed oracle results |
| Frontend | React, Vite, ethers.js | User, admin, auditor, claim, and result dashboards |

The system can run locally with Hardhat, MongoDB, backend, frontend, and one or two oracle processes. The contract is also now prepared for deployment to an EIP-170-enforcing network because the deployed bytecode size has been reduced below the 24,576-byte contract size limit.

## 3. Core Functional Workflow

### 3.1 Policy Package Management

Admins create policy packages on-chain. A package defines:

- package name
- policy type
- premium amount
- coverage amount
- duration in days
- required document type
- active/inactive status

Policy packages are stored in the smart contract. The backend and frontend read package metadata from the contract rather than treating MongoDB as the final source of truth.

### 3.2 Policy Purchase

Users purchase an active package by sending the exact premium amount to the smart contract. The contract records:

- policy ID
- package ID
- holder wallet
- start date
- end date
- coverage amount
- premium paid
- active status

Premiums remain in the contract balance and become part of the reserve used for settlement.

### 3.3 Claim Submission

A user submits a claim against an active policy. The claim includes:

- policy ID
- claim amount
- incident date
- claim type
- hospital ID
- invoice hash
- document hash
- document CID

The contract performs immediate validation:

- policy must exist
- caller must be the policy holder
- policy must be active
- incident date must be within policy period
- claim amount must not exceed coverage
- document and invoice hashes must be non-empty
- maximum claims per policy must not be exceeded

The contract also checks duplicate/fraud indicators:

- reused document hash
- reused invoice hash
- repeated user/date/claim-type combination

If a duplicate signal exists, the claim is marked `FRAUD_FLAGGED`. Otherwise, it moves to `DUPLICATE_CHECKED` and becomes eligible for oracle verification.

### 3.4 Oracle Verification

After duplicate checking, an admin or claim officer requests oracle verification. The smart contract creates an oracle request with:

- request ID
- claim ID
- oracle type
- query hash
- request timestamp
- request block number
- fulfillment status

Oracle nodes listen for requests and verify the corresponding claim against the backend mock hospital registry.

The oracle result includes:

- verified/not verified decision
- result hash
- risk level
- remarks

The contract supports quorum-based oracle confirmation. Multiple oracle accounts can submit confirmations, and the request is finalized only after the configured threshold is met.

### 3.5 Manual Review and Auditor Voting

Claims can move to manual review when:

- fraud is detected during duplicate checks
- oracle verification fails
- admin or claim officer sends a claim for review

Auditors can vote on claims in reviewable states. Votes are stored on-chain, and duplicate votes from the same auditor are rejected.

The voting layer supports reputation metadata through auditor reputation scores. This provides a foundation for reputation-weighted review, although the current contract still keeps the final admin decision path explicit.

### 3.6 Claim Approval, Rejection, Appeal, Settlement, and Closure

Claims can be approved only after a valid oracle result or manual review state. Approved claims can then be settled.

Settlement is calculated on-chain using:

- claim amount
- deductible rate
- deductible cap
- insurer share basis points
- claimant responsibility

The contract transfers the insurer-paid amount directly to the claimant wallet. A settled claim cannot be settled again.

Rejected claims can be appealed once by the claimant. Admins can either reopen the claim for a fresh oracle cycle or finalize the rejection. Rejected claims are protected by an appeal window before closure.

Closed claims represent the end of the claim lifecycle.

## 4. Blockchain Angle

The blockchain is not used as decoration. It is used for the parts of the insurance workflow where lifecycle integrity, non-repudiation, and state transition discipline matter most.

### 4.1 On-Chain Source of Truth

The smart contract stores the authoritative state for:

- policy packages
- purchased policies
- claim status
- duplicate hash usage
- oracle request lifecycle
- oracle confirmations
- auditor votes
- settlement records
- claim closure
- registry Merkle root commitment

This means the backend cannot silently rewrite claim status, settlement outcome, or oracle verification history without leaving the contract state and event log inconsistent.

### 4.2 Event-Based Audit Trail

The contract emits events for important lifecycle changes:

- `PolicyPackageCreated`
- `PolicyPurchased`
- `ClaimSubmitted`
- `ClaimFlagged`
- `OracleRequested`
- `OracleConfirmationReceived`
- `OracleResultSubmitted`
- `OracleTimedOut`
- `ClaimApproved`
- `ClaimRejected`
- `ClaimAppealed`
- `ClaimSentToManualReview`
- `AuditorVoteCast`
- `SettlementCalculated`
- `ClaimSettled`
- `ClaimClosed`
- `RegistryRootUpdated`

The backend audit route reconstructs claim timelines from these events. This gives the project a blockchain-native audit layer rather than relying only on MongoDB logs.

### 4.3 Merkle-Anchored Registry Verification

The backend mock hospital registry can produce a Merkle root for the current registry snapshot. The smart contract stores the active registry Merkle root.

Oracle nodes compare:

- the local registry proof/root from the backend
- the registry root committed on-chain

A recent hardening change made this stricter: if the local Merkle root does not match the on-chain root, oracle verification automatically fails. This means the oracle cannot accept a hospital response if its registry snapshot is not consistent with the blockchain commitment.

This strengthens the research contribution because the oracle is not merely checking a database row. It is checking a database row in relation to an on-chain commitment.

### 4.4 Oracle Independence

The oracle layer supports multiple oracle instances. Oracle instances can run with separate:

- private keys
- environment files
- registry snapshots
- start blocks
- process terminals

The second oracle can use a divergent registry snapshot to simulate independent infrastructure and disagreement. This creates a testable basis for oracle disagreement, quorum behavior, and trust failure.

### 4.5 On-Chain Settlement

The contract performs settlement calculation and payment. This matters because the final money-moving action is not only a backend database update.

The contract enforces:

- claim must be approved
- claim must not already be settled
- contract must have enough reserve
- transfer must succeed
- settlement record is stored
- claim status becomes `SETTLED`

This supports the thesis claim that blockchain is used for settlement integrity, not only audit logging.

### 4.6 Deployment Readiness

The original contract exceeded the EIP-170 deployed bytecode limit. The contract was optimized so that its deployed bytecode is now below the 24,576-byte limit.

Key deployment-readiness changes:

- deployed size reduced from about `30,028` bytes to about `24,466` bytes
- `allowUnlimitedContractSize` removed from Hardhat config
- revert strings stripped for deployability
- metadata bytecode hash disabled
- several convenience getters replaced with public-variable or provider reads
- deployment-size regression test added

This makes the contract more credible for a real testnet/L2 deployment attempt.

## 5. Smart Contract Design

The main smart contract is `InsuranceManager`.

It uses:

- OpenZeppelin `AccessControl`
- OpenZeppelin `Pausable`
- OpenZeppelin `ReentrancyGuard`

### 5.1 Roles

The contract defines project roles:

- `ADMIN_ROLE`
- `CLAIM_OFFICER_ROLE`
- `ORACLE_ROLE`
- `AUDITOR_ROLE`
- `EMERGENCY_ROLE`

Role management is hardened so the final admin cannot be removed. The default admin role is not directly managed through project role wrappers.

### 5.2 Pausing and Emergency Control

Emergency responders can pause the contract, but only admins can unpause it. Pausing blocks high-risk actions such as:

- policy purchase
- claim submission
- oracle result submission
- settlement

This gives the system an emergency brake without letting emergency accounts restore normal operation unilaterally.

### 5.3 Claim State Machine

Claim status values include:

- `SUBMITTED`
- `DUPLICATE_CHECKED`
- `FRAUD_FLAGGED`
- `ORACLE_PENDING`
- `ORACLE_VERIFIED`
- `ORACLE_FAILED`
- `MANUAL_REVIEW`
- `APPROVED`
- `REJECTED`
- `SETTLED`
- `CLOSED`

The contract restricts transitions. For example:

- claims cannot be settled before approval
- settled claims cannot be settled again
- oracle results cannot be submitted after fulfillment
- auditor votes cannot be duplicated
- claims cannot be closed unless settled or properly rejected

### 5.4 Settlement Model

The settlement model uses:

- deductible rate in basis points
- deductible cap
- insurer share in basis points

The contract exposes `calculateSettlement` and uses the same calculation inside `settleClaim`, so the displayed settlement breakdown and actual transfer logic are consistent.

## 6. Backend Design

The backend is responsible for integration rather than final lifecycle authority.

Main backend responsibilities:

- wallet login and JWT issuance
- user and role APIs
- policy and claim APIs
- document upload and IPFS integration
- Merkle registry generation
- mock hospital registry verification
- oracle helper endpoints
- admin action APIs
- audit endpoints
- fraud model evaluation scripts
- thesis chart generation

### 6.1 Authentication

Users authenticate through wallet signature login:

1. User requests a nonce.
2. Backend stores nonce for the wallet.
3. User signs the nonce message.
4. Backend verifies signature recovery.
5. Backend issues a JWT.

Recent hardening added:

- token ID (`jti`)
- token revocation support
- issuer validation
- audience validation
- configurable token expiry

### 6.2 CORS Hardening

The backend previously accepted all origins with credentials. It now uses an allowlist.

Configuration:

- `ALLOWED_ORIGINS=http://localhost:5173,http://127.0.0.1:5173`

If no allowlist is provided, development localhost defaults are used.

### 6.3 Backend Admin Action Audit Logs

The system already has on-chain event audit trails. A backend audit log was added to capture server-signed admin actions.

The new `AdminActionLog` records:

- authenticated actor wallet
- actor role
- action name
- target type
- target ID
- transaction hash
- block number
- route method/path
- IP address
- user agent
- metadata

This is important because the backend uses an admin private key to send some transactions. The log ties backend-signed transactions back to the authenticated user who triggered them.

Logged actions include:

- policy package creation/update/deactivation/reactivation
- registry Merkle-root push
- oracle verification request
- claim approval
- claim rejection
- claim settlement
- oracle timeout resolution
- claim closure
- manual review transition

An admin-only audit endpoint exposes these logs.

## 7. Oracle Design

The oracle process watches the smart contract for oracle requests and submits verification results.

Oracle verification uses:

- claim data from the contract
- mock hospital registry endpoint
- registry Merkle proof/root
- on-chain registry Merkle root
- local oracle wallet signature

The oracle result is submitted to the contract with:

- request ID
- verified flag
- result hash
- risk level
- remarks

### 7.1 Merkle Mismatch Failure

The oracle now treats Merkle-root mismatch as a verification failure.

This means:

- hospital record can match the query
- but if the local registry root does not match the on-chain root
- the oracle result is still failed

This makes the oracle design more defensible because the oracle must prove consistency with the blockchain-anchored registry commitment.

## 8. Fraud Model Methodology

The fraud-risk model is a Naive Bayes style scoring model trained from synthetic healthcare registry records with Laplace smoothing and anomaly checks.

Signals include:

- clean registry match
- missing registry record
- hospital mismatch
- invoice hash mismatch
- claim amount exceeding registry bill
- bill range anomaly
- treatment type mismatch
- date mismatch
- invalid registry status
- used invoice marker
- cancelled record marker
- suspended or blacklisted hospital license
- repeated claim pattern

The model produces:

- posterior fraud probability
- risk score
- risk level
- recommendation
- active evidence factors
- top risk drivers
- anomaly signals

## 9. Updated Fraud Experiment Design

The earlier evaluation was too clean. It produced perfect or near-perfect values such as:

- precision `1.0000`
- recall `1.0000`
- F1 `1.0000`
- average precision `1.0000`

This looked academically suspicious because the held-out set was still mostly obvious registry classification. The model was being evaluated on cases that contained the same strong fraud markers used during training.

The evaluation was updated to use deterministic claim scenarios instead of only clean record classification.

### 9.1 Scenario Types

The current evaluator includes:

- `clean_legitimate_match`
- `noisy_legitimate_amount_rounding`
- `borderline_legitimate_date_noise`
- `obvious_fraud_registry_marker`
- `subtle_fraud_no_registry_marker`

This creates a harder held-out set with both false positives and false negatives.

### 9.2 Why the Metrics Are Now More Realistic

Noisy legitimate claims can produce false positives because the claim is legitimate but looks suspicious.

Subtle fraud cases can produce false negatives because the obvious registry markers are removed or weakened.

This produces a more believable experimental result without manually editing numbers.

### 9.3 Current Held-Out Evaluation Results

The regenerated synthetic evaluation produced:

| Metric | Value |
| --- | ---: |
| Accuracy | `0.7714` |
| Precision | `0.6667` |
| Recall | `0.8571` |
| F1 score | `0.7500` |
| AUC | `0.8758` |
| Average precision | `0.8602` |

Confusion matrix:

| Result | Count |
| --- | ---: |
| True positive | `12` |
| True negative | `15` |
| False positive | `6` |
| False negative | `2` |

This is more defensible for a thesis because the model performs well but not perfectly.

### 9.4 Baselines

The evaluation compares against simple baselines:

- always predict fraud
- amount above training mean

This helps show that the Bayesian model is not only being reported in isolation.

### 9.5 Generated Evaluation Artifacts

The backend writes evaluation artifacts to:

- `backend/evaluation-results/risk-model-summary.json`
- `backend/evaluation-results/risk-model-records.csv`
- `backend/evaluation-results/baseline-comparison.csv`
- `backend/evaluation-results/roc-curve.csv`
- `backend/evaluation-results/precision-recall-curve.csv`
- `backend/evaluation-results/threshold-sensitivity.csv`
- `backend/evaluation-results/evaluation-charts/*.png`

These files support the thesis result tables and figures.

## 10. Testing Strategy

The project uses Hardhat tests for contract behavior and backend scripts for analytics verification.

### 10.1 Contract Tests

The contract test suite covers:

- deployment and role setup
- policy package creation/update/deactivation
- policy purchase
- claim submission
- duplicate and fraud checks
- oracle logic
- oracle quorum
- admin approval/rejection
- settlement
- appeal workflow
- registry Merkle root
- risk score lookup
- pause/emergency behavior
- deployment bytecode size
- fast invariant checks

### 10.2 Fast Invariant Tests

Recent invariant-style tests were added for important safety properties:

- no settlement before approval
- no double settlement
- no duplicate auditor vote
- no voting after closure
- no oracle confirmation after timeout finalization
- no final admin role removal

These are not full formal verification, but they are stronger than ordinary happy-path tests and directly support the blockchain robustness argument.

### 10.3 Deployment Size Test

A deployment-readiness test checks that the deployed contract bytecode remains under the EIP-170 limit.

This prevents future feature additions from silently making the contract undeployable again.

## 11. Security Posture

The system remains a research prototype, but several production-readiness improvements exist.

Implemented hardening:

- role-based smart contract access control
- final-admin removal protection
- emergency pause
- reentrancy protection on settlement and withdrawal
- on-chain settlement calculation
- duplicate claim hash checks
- oracle quorum
- oracle timeout handling
- Merkle-root mismatch failure
- stricter CORS allowlist
- JWT issuer/audience validation
- JWT revocation
- backend admin action audit logs
- deployment-size guard

Still not fully implemented:

- real multisig admin control
- encrypted IPFS evidence
- production key custody
- full off-chain/on-chain role synchronization
- formal verification with a dedicated tool
- production monitoring and alerting

These limitations should be stated honestly in the report.

## 12. Methodological Contribution

The strongest research story is:

> Block-Insure combines Merkle-anchored registry verification, quorum-based oracle confirmation, fraud-risk scoring, auditor review, and on-chain settlement into a traceable insurance claim lifecycle.

The most defensible novelty is not simply that the system has a blockchain contract. It is that the contract anchors the key lifecycle decisions while the oracle must prove consistency with a registry commitment.

The research contribution can be framed around:

- blockchain-enforced claim lifecycle integrity
- Merkle-anchored oracle registry verification
- multi-oracle disagreement handling
- hybrid fraud-risk and manual-review workflow
- on-chain settlement traceability
- scenario-based fraud model evaluation

## 13. Current Verification Status

Recent verification results:

- Contract tests: `122 passing`
- Backend analytics tests: passed
- Oracle syntax test: passed
- Frontend lint: passed
- Frontend production build: passed

The frontend build still emits a bundle-size warning, but it is not a failure.

## 14. Practical Deployment Notes

To deploy to a real testnet or L2, the system still needs manual environment setup:

- funded deployer wallet
- RPC URL
- admin private key
- deployed contract address copied to backend/frontend/oracle env files
- oracle private keys
- backend URL
- frontend URL
- allowed CORS origins
- MongoDB URI
- Pinata/IPFS credentials if document upload is used

The smart contract is now much closer to deployment readiness because it no longer depends on Hardhat's unlimited contract size setting.

## 15. Recommended Report Framing

In the report, avoid claiming the system is production-ready insurance infrastructure. A stronger and more honest framing is:

> This project is a deployable research prototype that demonstrates how smart contracts, Merkle commitments, independent oracles, fraud-risk scoring, and auditor review can be combined to create a transparent insurance claim lifecycle.

For results, avoid presenting perfect scores as the main achievement. Instead, emphasize:

- the dataset was made harder with noisy and subtle cases
- the model now has false positives and false negatives
- the results are more realistic
- baselines are included
- threshold sensitivity is reported
- the model supports decision assistance, not autonomous final rejection

## 16. Known Limitations

Important limitations:

- Fraud data is synthetic, not real insurance data.
- Oracle services are simulated independent services, not production oracle infrastructure.
- The smart contract is deployable but still compact and monolithic.
- Revert strings are stripped to satisfy deployment size constraints.
- The backend still signs some admin transactions using an admin private key.
- IPFS evidence is not yet encrypted.
- Multisig admin control is not yet implemented.

These limitations do not invalidate the thesis. They define the boundary of the prototype.

## 17. Best Next Improvements

Most valuable next steps:

1. Deploy the optimized contract to a real testnet or L2.
2. Run two oracle instances with separate keys and divergent registry snapshots.
3. Add screenshots and transaction hashes from a real deployment.
4. Add a short ablation study for fraud signals.
5. Add a small comparison table: single oracle vs quorum oracle, no Merkle vs Merkle-anchored registry.
6. Add evidence encryption if there is enough time.
7. Move admin signing to multisig or at least document it as future work.

## 18. One-Sentence Summary

Block-Insure is a deployable blockchain insurance prototype where claim lifecycle state, oracle verification, auditor review, Merkle registry commitments, and settlement are anchored on-chain, while the backend and oracle layers provide integration, analytics, and realistic fraud-risk experimentation.
