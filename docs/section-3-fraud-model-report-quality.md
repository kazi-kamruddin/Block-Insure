# Section 3: Fraud Model and Report Quality

This section improves statistical correctness, adds comparison baselines and
threshold-independent metrics, and introduces reproducible operational studies
for scalability and auditor reputation.

## Sample Variance Correction

Z-score anomaly detection now calculates sample variance with Bessel's
correction:

```text
sample variance = sum((x - mean)^2) / (N - 1)
```

For a one-record sample, variance and standard deviation are defined as zero.
Using `N - 1` reduces the downward bias that population variance introduces when
the available registry sample represents only part of the underlying population.

## Model Comparison Baselines

Held-out model results are compared against two intentionally simple baselines:

- **Always Fraud:** predicts every held-out claim as fraudulent.
- **Amount Above Training Mean:** predicts fraud when the held-out claim amount
  exceeds the mean claim amount calculated from the 80 percent training split.

Accuracy, precision, recall, F1, and confusion-matrix values are calculated for
both baselines on the held-out 20 percent. Results are written to
`baseline-comparison.csv` and displayed beside the Bayesian model on the thesis
dashboard.

## Threshold Selection and Sensitivity

Threshold selection does not inspect the held-out test labels. The evaluator:

1. Trains model parameters using the deterministic 80 percent training split.
2. Scores the training records.
3. Evaluates thresholds from 0 to 100 in steps of 5.
4. Selects the threshold with maximum training F1, breaking ties by precision
   and then the higher threshold.
5. Applies that selected threshold once to the held-out 20 percent.

The evaluator also exports held-out threshold sensitivity for discussion, but
the best held-out threshold is not used to calculate the primary metrics.

Generated files:

```text
threshold-selection-training.csv
threshold-sensitivity.csv
```

## ROC Curve and AUC

The evaluator calculates true-positive and false-positive rates across every
integer threshold from 0 to 100, plus the no-positive-prediction boundary. AUC is
calculated with trapezoidal integration over the ROC curve.

Generated files:

```text
roc-curve.csv
evaluation-charts/roc_curve.png
```

AUC is also included in `risk-model-summary.json` and the thesis dashboard.

## Precision-Recall Curve and Average Precision

Precision and recall are calculated across the same threshold range. Average
Precision uses step-wise integration over increasing recall. The chart includes
a dashed-equivalent horizontal fraud-prevalence baseline for comparison.

Generated files:

```text
precision-recall-curve.csv
evaluation-charts/precision_recall_curve.png
```

Average Precision is included in `risk-model-summary.json` and the thesis
dashboard.

## Evaluation and Chart Commands

For the configured MongoDB registry:

```powershell
cd backEnd
npm run evaluate:risk
npm run charts:generate
```

For a deterministic offline thesis demonstration:

```powershell
cd backEnd
npm run evaluate:risk:synthetic
npm run charts:generate
```

Focused analytics assertions can be run with:

```powershell
npm run test:section3
```

## Claim Throughput and Scalability Study

The load-test script benchmarks parallel claim submission at concurrency levels
`1, 5, 10, 20, 50`. Before each timed run it purchases one policy per claim so
that per-policy claim limits and duplicate detection do not invalidate the test.
Policy setup time is excluded.

For each claim, the script separately records:

- Backend HTTP response time.
- Blockchain `submitClaim` send-to-receipt confirmation time.
- Combined end-to-end time.

The oracle service also records its event-handler-to-confirmation duration in each
backend oracle log. The thesis dashboard reports the average across logs that contain
this timing field; older logs remain valid and are excluded from that average.

It reports average, p95, minimum, maximum, wall-clock throughput, successful
claims, and failures.

Run it while the backend and local blockchain are active:

```powershell
cd backEnd
npm run loadtest:claims
npm run charts:generate
```

Generated files:

```text
claim-throughput-results.json
claim-throughput-results.csv
evaluation-charts/throughput_vs_latency.png
```

The backend measurement defaults to `http://localhost:5000/health`. This
separates basic API latency from blockchain confirmation latency; it does not
claim that the health endpoint performs claim processing.

## Auditor Reputation Validation

When an administrator finalizes voting, the backend persists the final weighted
consensus and each auditor's vote in MongoDB. Re-finalization is rejected so
historical accuracy cannot be counted twice.

The analysis script compares each recorded vote with its final consensus,
calculates historical accuracy per auditor, reads the auditor's current on-chain
reputation, and calculates Pearson correlation between reputation and accuracy.

Run it after finalizing multiple demo voting sessions:

```powershell
cd backEnd
npm run analyze:auditors
npm run charts:generate
```

Generated files:

```text
auditor-reputation-analysis.json
auditor-reputation-analysis.csv
evaluation-charts/auditor_reputation_accuracy_scatter.png
```

A positive correlation supports the claim that the reputation mechanism rewards
auditors who align with final consensus. A weak or negative result remains a
valid empirical finding and should be discussed rather than hidden.

## Thesis Dashboard

The admin thesis-results dashboard now displays:

- Held-out accuracy, precision, recall, F1, AUC, and Average Precision.
- The training-selected decision threshold.
- Bayesian-model F1 compared with both baselines.
- Claim throughput and backend/blockchain/end-to-end latency results.
- Auditor reputation-versus-accuracy correlation and interpretation.

Operational-study sections show an explicit command prompt until their datasets
have been generated.
