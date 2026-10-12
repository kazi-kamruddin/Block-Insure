# Phase 0/1/2 Research and Assurance Implementation

## Scope

This implementation establishes a reproducible research baseline, expands
insurance-specific state-machine assurance, and adds capacity- and cost-aware
fraud triage. It does not change deployed Solidity or claim settlement
authority.

## Authority boundary

The probabilistic model is advisory. It may recommend automatic registry
verification or abstain to manual review. It may not reject oracle verification
solely because a probability is high. Rejection remains tied to explicit
integrity failures such as a missing registry record, invoice mismatch, reused
invoice, cancelled record, or blacklisted provider. Oracle consensus and manual
adjudication remain the authorities that progress the on-chain claim.

The frozen triage policy records this boundary in `backEnd/triage-policy.json`.
The policy is hashed independently and bound to the active model artifact and
feature schema.

## Reproducible research pipeline

Run:

```powershell
cd backEnd
npm run research:baseline
```

The pipeline performs these steps:

1. Regenerate the four deterministic synthetic registry profiles.
2. Verify their file hashes and manifest hash.
3. Freeze the capacity/cost policy against the existing calibrated model.
4. Run schema-v4 evaluation.
5. Generate charts from the schema-v4 artifact rather than legacy v2 files.
6. Write `evaluation-results/research-manifest-v4.json`.

The research manifest records the Git state, compiler configuration, package
manifests, contract bytecode sizes and hashes, model identity, policy identity,
dataset integrity, evaluation identity, seeds, and reproduction commands.
Volatile timestamps and wall-clock timings are excluded from reproducibility
hashes.

## Corrected evaluation design

The schema-v4 evaluation makes the following methodological changes:

- Claimant-provider connected components remain intact across grouped folds.
- Calibration is selected using a chronological partition inside training.
- Temporal evaluation uses the earliest 64% for model fitting, the next 16% for
  calibration, and the latest 20% for testing.
- A separate provider holdout excludes the selected providers and overlapping
  claimants from training.
- Feature ablations use grouped out-of-fold predictions instead of evaluating
  on their own training data.
- Confidence intervals use claimant-provider component percentile bootstrap
  rather than a normal approximation over fold summaries.
- F2 and Matthews correlation coefficient supplement accuracy, precision,
  recall, F1, ROC-AUC, PR-AUC, Brier score, and calibration error.

## Capacity- and cost-aware triage

The evaluation compares:

- rule-only ranking;
- uncalibrated Bernoulli Naive Bayes;
- Platt-calibrated Bernoulli Naive Bayes;
- Platt-calibrated logistic regression;
- class-weighted logistic regression;
- random review as a lower reference; and
- perfect ranking as a non-deployable upper reference.

Default review capacities are 5%, 10%, 20%, 30%, and 50% of non-hard-blocked
claims. Default scenario costs are deliberately dimensionless because no real
insurer cost study is present:

| Scenario | Missed fraud | Legitimate escalation | Manual review |
|---|---:|---:|---:|
| Balanced | 5 | 1 | 0.25 |
| Fraud averse | 10 | 1 | 0.25 |
| Severe missed fraud | 20 | 1 | 0.50 |

For costs \(C_{FN}\), \(C_{E}\), and \(C_R\), review is economically useful
above:

\[
p > \frac{C_R + C_E}{C_{FN} + C_E}
\]

The final operating threshold is the greater of this crossover and the
calibration-set threshold imposed by the nominal review capacity. The runtime
artifact describes an offline-derived planning point; it explicitly does not
claim to enforce a live queue capacity guarantee.

## Contract invariants and mutation campaign

The executable invariant catalogue is stored at
`contracts/test/invariants/protocol-invariants.json`. The Phase 6 stateful suite
checks cross-contract coverage, reservation, outstanding liability, unfunded
liability, claimable payout, replay, appeal, voting, and authority invariants
across generated claim sequences.

Run the stateful suite:

```powershell
cd contracts
npm run test:stateful
```

Run the isolated functional mutation campaign:

```powershell
cd contracts
npm run test:mutations
```

Every mutant is applied to a generated workspace below
`contracts/.mutation-workspace`, compiled, and executed against a targeted
regression property. Production Solidity sources are not modified. Compiler,
startup, timeout, and invalid-mutant failures are classified separately and
cannot be counted as killed mutants.

The initial fault families cover quorum thresholds, finalization access,
coverage bounds, invoice replay, reserve calculation, and payout-state guards.
The generated report is `contracts/mutation-results.json`.

## Interpretation limits

- Synthetic labels do not establish clinical or production fraud validity.
- Scenario costs do not represent a real insurer until supported by an
  operational study or credible source.
- The static runtime threshold is a nominal planning policy, not a distributed
  real-time work scheduler.
- Stateful and mutation testing are not formal verification.
- Random and perfect rankings are evaluation references, not deployable models.
