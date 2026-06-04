# Section 1: Smart Contract and System Design Hardening

## Implemented Controls

- Claims can enter `CLOSED` only through the admin-only `closeClaim` transition. Settled claims can be closed immediately. Rejected claims can be closed after the configurable appeal window, or after an appeal has been reviewed and finalized as rejected on-chain.
- Anyone can persist expiry enforcement by calling `deactivateExpiredPolicy` after a policy end date.
- `maxClaimsPerPolicy` and `claimCountPerPolicy` enforce a configurable submission cap for every policy.
- On-chain settlement emits `ReserveLowWarning` when the remaining contract balance is below `reserveWarningThresholdWei`. The backend listens for this event and creates an admin notification.
- The unused record-only settlement path was removed. Settlements are now consistently represented as on-chain payouts.
- `EMERGENCY_ROLE` can pause the contract without receiving full admin authority. While paused, policy purchases, claim submissions, oracle result confirmations, and settlements are blocked. Only an admin can unpause the contract.

The prototype defaults are five claims per policy, a seven-day rejected-claim closure window, and a `0.1 ETH` reserve warning threshold. Admin-only setter functions can change each value.

## Deployment Limitation: Contract Size

The current monolithic `InsuranceManager` contract still exceeds the EIP-170 deployed-bytecode limit, even after removing the record-only settlement path. Local Hardhat development permits this through `allowUnlimitedContractSize`, but a production deployment must split responsibilities into smaller contracts or libraries before targeting an EIP-170-enforcing network.

## Production Limitation: Admin-Key Custody

The prototype backend signs privileged transactions with a single `ADMIN_PRIVATE_KEY` loaded from environment configuration. This is a deliberate prototype limitation and a production single point of failure: compromise or loss of that key could expose every admin-authorized operation.

A production deployment must replace the backend-held key with stronger custody. Suitable mitigations include a hardware wallet such as Ledger for individual signing, or preferably a Gnosis Safe-style 2-of-3 multisignature wallet so no single keyholder can execute privileged transactions alone. Operational controls should also include key rotation, signer separation, transaction monitoring, and an emergency-response procedure.
