# Current authority and workflow map

```mermaid
flowchart TD
  Staff[Hospital staff: ordinary scoped login] --> Records[Institution-maintained records]
  Records --> Publisher[Insurer publisher: version and replicate]
  Publisher --> Registry[Committed Merkle snapshot on chain]
  Publisher --> Sources[Two snapshot collections and archived proofs]
  Holder[Policyholder: wallet plus mailbox] --> Gateway[Simulated BDT gateway: funded test ETH]
  Gateway --> Installments[One on-chain installment calendar]
  Holder --> Evidence[Browser AES and PRE: encrypted invoice/supports]
  Evidence --> Storage[Pinata ciphertext and authenticated metadata]
  Holder --> Claim[Claim and issued-policy eligibility]
  Installments --> Claim
  Registry --> Oracles[Two workers: pinned records, context and XGBoost]
  Sources --> Oracles
  Claim --> Oracles
  Oracles --> Decision{Exact result and integrity checks}
  Decision -->|Eligible automatic approval| Allocation[Funded allocation or funding required]
  Decision -->|Failure, conflict, timeout or review| Preparation[Fixed four auditors: bounded access preparation]
  Holder -->|Batch consent for current set and recipients| Preparation
  Storage --> Preparation
  Preparation -->|Operator activation| Votes[Three approvals / two rejections / expiry]
  Votes --> Allocation
  Votes -->|Reject| Appeal[Versioned correction and recoverable appeal]
  Appeal --> Claim
  Allocation --> Withdraw[Recipient pull withdrawal]
```

The chain enforces policy/payment identity, module authority, decision thresholds
and payout accounting. It cannot prove clinical truth, inspect encrypted files or
prove an auditor read them. Both workers share institutional source/publisher
trust. Their separate execution is not independent medical corroboration.

The service stores authorized PRE transforms, not the patient's private encryption
identity. File/version restrictions also depend on authenticated proxy enforcement.
Owner-offline retrieval begins after consent is stored. Revocation prevents
supported future transforms and cannot erase plaintext already downloaded.

Email verifies mailbox access. BDT ownership, debits and conversion are simulated;
premium credit requires actual funded test ETH. Medical liabilities and the
optional cancellation-refund reserve are distinct. Death/maturity are disabled.
Public metadata, deterministic panel selection, public sequential votes and trusted
administrator governance remain explicit thesis assumptions.
