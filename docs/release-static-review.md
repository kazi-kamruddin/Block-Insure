# Release static-analysis interpretation

The final 29 October 2026 local Slither run analyzed 43 contracts with 102 detectors
and reported 124 findings, including the accelerated implementation. These are
detector findings, not 124 established exploits. The preceding 42-contract / 127-
finding run is retained as earlier-source evidence; its counts are not current.
The raw report and input hashes remain in private verification output. The isolated
CRLF-to-LF analysis copy compiled to the same runtime bytecode as working artifacts;
working Solidity sources were not rewritten to accommodate Windows source maps.

| Detector group | Count | Reviewed interpretation |
| --- | ---: | --- |
| Arbitrary ETH send (High) | 4 | `activateFundedClaim` and `_allocatePayout` transfer to the fixed adjudicator using the recorded claimant/liability. Its pull path checks funding, clears entitlement and uses `nonReentrant`. Benefits `_sendValue` is reached by claimant withdrawal or authorized excess withdrawal; excess reserve guards and `nonReentrant` apply. Manager excess withdrawal is administrator-only, reserve-bounded and guarded. No attacker-selected destination bypass was established. |
| Divide before multiply (Medium) | 1 | Installment quote intentionally floors elapsed time into a calendar-period index before deriving the period's due date. It is not an amount calculation losing fractional premium value; final-period amounts use the separate prorating rule. |
| Strict equality (Medium) | 15 | Findings concern exact state enums, version/identity binding and expected installment IDs/amounts. Exact matching is required to prevent stale-state collection and replay. These are not equality tests against unpredictable contract balances. |
| Reentrancy without ETH (Medium) | 7 | Most flagged external calls are to the fixed, manager-bound economics/coordinator/adjudicator implementations. Those methods do not call an arbitrary user before returning. Actual recipient transfers are on guarded withdrawal paths; manager/adjudicator withdrawal guards and prior entitlement updates prevent repeated payout. This conclusion depends on the deployed compatible modules and trusted configuration, which deployment readback checks. |
| Uninitialized local (Medium) | 2 | The four selected auditor entries are populated by the bounded four-iteration assignment loop. Issued-term memory fields are assigned before storage; optional flags intentionally retain Solidity's zero defaults. |
| Unused return (Medium) | 5 | Calls rely on reversion and stored module state, not a discarded success code. Funding is supplied exactly or explicitly deferred; appeal round and preparation/deadline are read from the adjudicator. Reservation liability is stored by economics and read for settlement. |
| Benign/event reentrancy (Low) | 28 | Same fixed-module and guarded-recipient boundaries apply. Events are observations; projections use event identity/version rather than treating event order as independent clinical truth. No new payment authority is inferred from an emitted event. |
| Timestamp dependence (Low) | 50 | Coverage, payment and review windows intentionally use chain time. They are not randomness sources. Hosted tests must still validate actual block/deadline behavior and distinguish configured confirmation depth from economic finality. |
| Other informational/optimization | 12 | One costly loop, four low-level calls, one suggested interface inheritance, three naming suggestions for uppercase private immutable calendar fields and three constant/immutable suggestions. They do not establish a material defect. Settlement scans the policy request history without an explicit numerical cap. Repeated administrator-rejected replacement requests increase gas; the controlled demo assumes small histories. This and institutional-pool scale remain disclosed operational limits, not a demonstrated large-history guarantee. Fixed ABI compatibility is checked without expanding tight manager bytecode for cosmetic inheritance/optimization changes. |

No new exploitable High/Medium issue was established by this scoped review. This
does not certify absence of vulnerabilities or replace an independent audit.
The analyzer is configured to report findings without using their count as its
exit status; completion requires this interpretation plus applicable tests.
Both calendar implementations retain their runtime/initcode limits. The exact
on-chain interval/advance/grace values are verified after immutable-slot code
comparison; masking immutable values alone does not establish correct settings.

Relevant implementation boundaries: `InsuranceManager.withdrawSettlement` and
`withdrawExcess`; `ClaimAdjudicator.withdrawPayout`; `PolicyBenefitsManager`
withdrawal/reserve checks; manager-bound `PolicyEconomics` and `OracleCoordinator`.
Immutable four-auditor quorum, source-publisher/admin trust and prototype synthetic
data scope remain unchanged. Re-review findings when these boundaries change.
