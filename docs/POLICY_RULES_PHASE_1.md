# Policy Realism — Phase 1

## Purpose

Phase 1 adds an explainable policy-rules layer without changing the deployed smart contract or removing any existing claim capability. It supports realistic thesis demonstrations while keeping every case synthetic and anonymized.

## Implemented

- Versioned profiles for Standard Health, Critical Illness, and Accident/Emergency.
- Initial waiting periods, pre-existing-condition waits, explicit exclusions, covered treatment lists, policy-share limits, and coverage caps.
- Manual-review routing for non-disclosure and claim types requiring interpretation.
- Historical purchase-date and incident-date simulation.
- Live advisory previews for policies already purchased on-chain.
- Six reproducible scenarios: appendicitis, road accident, early hospitalization, disclosed and undisclosed pre-existing conditions, and cosmetic exclusion.
- Human-readable reason codes and estimated benefit calculations.

The preview is intentionally advisory. The deployed contract, policy status, oracle verification, auditor voting, and administrator settlement flow remain authoritative.

## API

- `GET /api/policy-packages/rule-catalog`
- `GET /api/policy-packages/realistic-scenarios`
- `POST /api/policy-packages/:packageId/eligibility-preview`
- `POST /api/policies/:policyId/eligibility-preview`

Historical previews accept a manual `policyStartDate`, `policyEndDate`, `incidentDate`, `claimType`, `claimAmountEth` or `claimAmountWei`, and disclosure flags. Purchased-policy previews obtain authoritative dates and coverage directly from the contract.

## Phase 2 Boundary

Phase 2 should cover beneficiary management, death benefits, surrender or premature termination values, maturity behavior, admin-managed rule publication, policy-document generation, and any separately deployed on-chain enforcement module. These changes require explicit product formulas and a contract migration strategy.
