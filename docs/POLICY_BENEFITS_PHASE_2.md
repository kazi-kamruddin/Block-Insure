# Policy Realism — Phase 2

## Outcome

Phase 2 adds optional beneficiary, death, surrender, and maturity workflows through `PolicyBenefitsManager`, a separate contract that reads authoritative policies from `InsuranceManager`. The original contract remains unchanged because it has only limited EIP-170 runtime headroom.

## Benefit Lifecycle

1. An administrator signs a strictly increasing benefit schedule version with the connected browser wallet; the backend verifies and audits the confirmed transaction.
2. A policyholder accepts the current schedule when first enrolling, then registers one to three beneficiary wallets whose shares total 100%. Later package versions do not change that policy retroactively.
3. A beneficiary may request a death benefit with a hashed evidence reference. Beneficiaries are locked after the request.
4. A policyholder may request surrender only after cancelling the base policy and satisfying the minimum installment rule.
5. A policyholder may request maturity only after the base policy expires and only when maturity is enabled.
6. An administrator approves or rejects a request. Approval reserves the complete liability.
7. An administrator allocates an approved request. Each recipient withdraws independently, so one incompatible recipient cannot block another.

## Security Properties

- Separate deployment avoids increasing the nearly full `InsuranceManager` runtime.
- Policy ownership, effective status, and administrator authority are read from the base contract; there is no second admin registry that can become ownerless or drift out of sync.
- Concurrent or already-allocated duplicate requests are prohibited; rejected requests may be corrected and resubmitted.
- An administrator may revoke an approval before allocation; the reserved liability is released atomically.
- Benefit calculations and the applicable terms version are snapshotted at request time.
- Approved and allocated-but-unclaimed liabilities cannot be withdrawn as excess funds.
- Pull-based withdrawals, checks-effects-interactions, and reentrancy protection isolate recipient failures.
- Beneficiary shares, duplicate addresses, zero addresses, and self-beneficiaries are rejected.
- Private evidence is not stored on-chain; only a cryptographic reference is recorded.
- For death requests, the administrator UI hashes the privately received reference locally and enables approval only when it matches the on-chain commitment.

## Interfaces

- Policyholders manage beneficiaries, projections, surrender, maturity, and downloadable Markdown terms under **My Policies**.
- Beneficiaries submit evidence-backed death requests under **Beneficiary Benefits**.
- Administrators publish schedules and resolve requests under **Benefits** using their connected wallets; the backend never signs these benefit transactions.

## Local Deployment

Run the existing clean local setup. It now deploys both contracts, publishes a conservative default schedule for Health Basic, funds the separate benefit reserve, and synchronizes `POLICY_BENEFITS_ADDRESS` / `VITE_POLICY_BENEFITS_ADDRESS`.

To preserve an already-running local chain and its existing data, run `npm run deploy:benefits:local` instead. Restart the backend and frontend afterward so they load the synchronized extension address.

The default Health Basic schedule enables death and surrender benefits but leaves maturity disabled. Administrators can publish a higher schedule version to enable it for products that are explicitly designed to include maturity value.
