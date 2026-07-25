# Section 1: Smart Contract and System Design Hardening

## Implemented Controls

- Claims can enter `CLOSED` only through the admin-only `closeClaim` transition. Settled claims can be closed immediately. Rejected claims can be closed after the configurable appeal window, or after an appeal has been reviewed and finalized as rejected on-chain.
- Anyone can persist expiry enforcement by calling `deactivateExpiredPolicy` after a policy end date.
- `maxClaimsPerPolicy` and `claimCountPerPolicy` enforce a configurable submission cap for every policy.
- On-chain settlement emits `ReserveLowWarning` when the remaining contract balance is below `reserveWarningThresholdWei`. The backend listens for this event and creates an admin notification.
- Approved payouts are accumulated in `totalReservedLiabilityWei`. `withdrawExcess` cannot reduce the balance below that amount, and settlement parameters cannot change while an approved liability is active.
- High-value approval records its approving admin address. The contract requires a different on-chain admin address to execute the settlement.
- Claim decisions, appeal decisions, and settlement actions are signed by the connected admin browser wallet. The backend verifies the receipt and signer before creating its idempotent audit record.
- The unused record-only settlement path was removed. Settlements are now consistently represented as on-chain payouts.
- `EMERGENCY_ROLE` can pause the contract without receiving full admin authority. While paused, policy purchases, claim submissions, oracle result confirmations, and settlements are blocked. Only an admin can unpause the contract.

The prototype defaults are five claims per policy, a seven-day rejected-claim closure window, and a `0.1 ETH` reserve warning threshold. Admin-only setter functions can change each value.

## EIP-170 Deployment Readiness

`InsuranceManager` compiles to 24,367 bytes of deployed runtime code, 209 bytes below the 24,576-byte EIP-170 limit. The build pins Solidity 0.8.26, enables the IR optimizer with one run, strips revert strings from deployed bytecode, omits the metadata bytecode hash, and targets the Cancun EVM. Hardhat's unlimited-contract-size bypass is disabled, and the deployment-readiness test independently asserts the EIP-170 boundary.

The reduction removes only duplicated read APIs and their redundant indexing arrays. Package, policy, and claim lists are reconstructed from monotonic counters and canonical record getters; active auditors are reconstructed from `RoleGranted` events and confirmed with `hasRole`. Claim documents, voting, oracle requests, appeals, approvals, and settlement records retain their canonical on-chain getters and state transitions. The backend and frontend contain the corresponding query adapters, so application behavior is unchanged.

This contract is not upgradeable. Deployments made from the optimized source therefore require a fresh contract address and ABI; the local deployment workflow synchronizes both automatically. The 209-byte margin is intentionally protected by the deployment-readiness test, so future Solidity additions must either replace existing code or further decompose the contract rather than silently reintroduce an undeployable build.

## Production Limitation: Admin-Key Custody

The prototype backend still uses an `ADMIN_PRIVATE_KEY` for configuration, registry, and voting-reputation operations. Claim and settlement decisions have moved to the authenticated admin browser wallet, but the remaining backend-held signer is still a production custody limitation.

A production deployment must replace the backend-held key with stronger custody. Suitable mitigations include a hardware wallet such as Ledger for individual signing, or preferably a Gnosis Safe-style 2-of-3 multisignature wallet so no single keyholder can execute privileged transactions alone. Operational controls should also include key rotation, signer separation, transaction monitoring, and an emergency-response procedure.
