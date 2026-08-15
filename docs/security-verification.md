# Protocol security verification

The repository has three complementary security layers:

- `npm --prefix contracts test` runs deterministic unit, adversarial-recipient, oracle conflict/timeout, Merkle race, quorum, appeal, role, coverage, reserve, and end-to-end workflow tests.
- `npm --prefix contracts run test:stateful` runs the randomized multi-transition financial invariant harness and checks coverage and treasury reserve bounds after every action.
- `npm --prefix contracts run analyze:slither` runs Slither with `contracts/slither.config.json`. Slither must be installed separately (`pipx install slither-analyzer`) because it is a Python security tool, not an npm runtime dependency.

The stateful harness uses a fixed seed for reproducibility. Additional seeds can be added without changing production contracts. The protocol remains a set of normal modular contracts; there is no proxy implementation switch or single upgrade key. Versioned component addresses and the canonical V2 migration-manifest hash are committed by `ProtocolDeploymentRegistry`.
