# Advanced claim-triage candidate: Phases 1 and 2

Review and execution date: **24 October 2026, Asia/Dhaka**. Base application
commit: `26c5b10`; candidate implementation is the additional worktree. This is
an offline research implementation and evaluation, not a deployed ML upgrade.

**Follow-up:** [source-grounded engineering v2](advanced-engineering-v2.md) now
addresses availability, action labels and prevalence-shift calibration. Numbers
below remain the historical v1 study, not measurements of that revised benchmark.
Pre-revision research source is preserved under
`docs/engineered/advanced-before-engineering-v2-2026-10-24/`. To verify the old
study after source changes, append
`--snapshot docs/engineered/advanced-before-engineering-v2-2026-10-24` to the
verification command below. This checks archived source explicitly rather than
presenting older measurements as verification of current code.

## Outcome

Both requested phases are implemented within the source's stated limits. The
candidate includes continuous inputs, strictly-prior history, structural
patient–provider graph propagation, fitted day-binned temporal excitation,
regularized conditional Mahalanobis distance, XGBoost, calibration, exact native
tree-path-dependent SHAP and split-conformal routing. A standalone command
produces an explained assessment from a prepared claim/context.

**Promotion: HOLD.** More complex is not automatically more useful. The full
candidate increases controlled-attack recall but also routes more unmutated
controls, decreases F1 and fails the nominal conformal-coverage diagnostic under
the shifted test population. Its lower mean chosen cost is exploratory, depends
on declared cost weights and is not supported consistently by every seed's
paired interval. The active model and triage policy are byte-for-byte unchanged.

## Phase 1: components and boundaries

| Component | Actual implementation | Important boundary |
| --- | --- | --- |
| Observable inputs | Existing shared binary extractor plus five continuous inputs, including normalized bill ratio, care duration and invoice lag | Source reference ranges and clinical mappings are engineered, not validated clinical norms. No experiment-label inputs. |
| History | Prior 14-day patient similarity and 30-day provider counts/mean bill | Source-local records only; current, equal-date and future events excluded. Recurring treatment is not fraud. |
| Graph | 90-day patient–provider ego graph, degrees, repeat-edge share, concentration and 12 normalized bipartite propagation iterations with uniform priors | Structural ranking, not label-seeded collusion inference. No fabricated bank edges or unsupported tripartite claim. |
| Temporal | Training-only, pooled day-binned self-exciting Poisson fit with exponential kernel; 30-day burn-in and bounded excitation | Date-resolution Hawkes approximation, not continuous intraday Hawkes. First/last observed dates are imperfect observation boundaries; shared provider rates can confound excitation. The fitted branching parameter reaches its 0.95 bound. |
| OOD | Training-fit standardized covariance with 20% diagonal shrinkage and ridge; diagnosis groups need 30 rows, then treatment/pooled fallback | Many diagnoses lack support. Unusual is not fraudulent. Context information is not yet proof-bound for runtime. |
| Predictor | XGBoost 3.0.5, histogram trees, one thread, up to 80 rounds; depth 2/3 chosen by tuning log loss, early stopping | Established algorithm, not a newly invented primitive. The two-depth search is deliberately bounded. |
| Calibration | Monotone Platt fit on a separate provider group | Experimental task probabilities, not natural-fraud probabilities. |
| Explanations | Native exact tree-path-dependent SHAP, additivity verified on every test row | Raw-margin contributions, not attribution of the calibrated percentage or proof of causality. |
| Conformal | Finite-sample rank quantile on a separate calibration group, alpha 0.1; anything except control-only singleton requires review | Empirical coverage measured; exchangeability is not guaranteed under provider/prevalence shift. |
| Routing | Mandatory integrity checks unioned with threshold, OOD and conformal scrutiny | No independent fraud verdict, rejection, payout or contract transaction. |
| Portable model | Native saved JSON plus independent JS tree scorer; separate six-decimal rounding experiment | Exact export passes measured parity. Rounded export is rejected, not silently adopted. |

The allowlisted context boundary is `backEnd/research/context.js`. Context
ordering is canonicalized and tested against reversed input order. Labels and
scenario names exist only in evaluation metadata, not predictor inputs. No
provider/patient identifier is an explicit model feature. Source identifiers in
the prepared export are hashed and remain ignored local research data.

Prepared history from training/calibration can include earlier observable
modified records, but never their labels. Test context is built from the
unmutated source partition, not future test outcomes. This asymmetry and the
source's engineered chronology remain study limitations.

## Phase 2: design and actual results

The plan is `backEnd/research/advanced-plan.json`; each run copies it and records
source/data hashes **before training**. Prior test exposure is explicit: these
are exploratory runs on an already examined source/scenario generation, not a
new independent untouched validation. Seeds 71/113/197 change sampling and model
randomness, not the source dataset or attack mechanism.

Each seed samples 3,000 training and 3,000 test rows. The source calibration
sample is divided into tuning, probability-calibration, conformal-calibration
and policy-selection provider groups. Shared patients are purged before sampling
across parent partitions, and between those calibration groups. Each exported
partition pair is checked independently in Python for patient/provider/claim-ID
overlap. This is not a temporal-generalization experiment. Historical contexts
remain local to each group; splitting/purging changes the evaluated population.

Three test samples yield **9,000 evaluations of 7,703 unique source claims**.
They overlap and must not be counted as 9,000 independent observations.

Final command: `npm --prefix backEnd run evaluate:advanced`.
Retained input directory: `docs/engineered/advanced-2026-10-24T07-28-37-781Z/`.
Retained final study: its `study-20261024T073342Z/` subdirectory.
Two earlier pilots remain under `advanced-2026-10-24-phase12/`; they are not extra
replications. An OOD-path ablation correction and context insertion-order check
were completed before the end-to-end run. The final sanity pass then unified
float32 preprocessing before OOD and reran the full study on the retained export;
all 9,000 packaged feature vectors now exactly match evaluation preprocessing.
The `study-20261024T072919Z` predecessor remains historical. Numerical full-model
results were unchanged and were not selected from the better pilot.

Arithmetic means across the three sampling seeds:

| Method (with common integrity rules) | Attack recall | Unmutated-inclusive review rate | F1 | Declared cost |
| --- | ---: | ---: | ---: | ---: |
| Rules only | 76.85% | 41.48% | 0.8402 | 1.2919 |
| Frozen runtime NB, offline replay | 76.85% | 41.49% | 0.8401 | 1.2921 |
| Retrained observable NB | 76.85% | 41.48% | 0.8402 | 1.2919 |
| Binary LR | 76.85% | 41.48% | 0.8402 | 1.2919 |
| Continuous LR | 76.85% | 41.48% | 0.8402 | 1.2919 |
| Base GBDT | 76.85% | 41.48% | 0.8402 | 1.2919 |
| Complete candidate | 78.19% | 44.96% | 0.8235 | 1.2621 |

Cost is `(10*missed_attacks + unmutated_routes + 0.25*all_routes)/N`, a declared
experimental preference, not measured financial or human-review cost. The policy
partition selects thresholds under a 60% requested union-review budget, raised
if unavoidable checks exceed it. The test population can shift; these observed
rates are **not workload-matched test outcomes**. They must not support a claim
that the full candidate improves recall at identical operational workload.

Removal ablations cover new history, graph, temporal, OOD, calibration and
conformal layers. When a feature branch is removed, OOD is refit without that
branch, preserving the remaining gates. Common legacy binary/history-derived
baseline inputs are retained. Full details, probability metrics, family counts,
OOD fallback counts and timing scope live in each seed's evaluation JSON.

Paired provider-cluster bootstrap uses 500 repetitions. Full-minus-rules cost
intervals are approximately [-0.0652,-0.0100], [-0.0416,+0.0071] and
[-0.0776,-0.0057]. One includes zero. Cross-provider patient dependence,
overlapping seeds, synthetic construction and multiplicity preclude a blanket
superiority claim.

Nominal 90% conformal coverage is only **72.77%, 75.13%, 73.43%** on the shifted
test cohorts. Calibration is roughly 12% injected attacks versus roughly 50% in
test; class-specific coverage is also reported. This is a failed coverage
diagnostic, not a supported uncertainty guarantee. No post-test adjustment of
alpha or calibration mixture was made to conceal it.

The exact JS export has zero routing differences on all 9,000 evaluated rows,
with maximum raw probability error below 8.3e-8. Native SHAP margin-additivity
error is below 2.4e-6. Six-decimal rounded trees exhibit up to 0.65 probability
error and 0/1/15 routing differences by seed. **Do not promote rounded artifacts.**
Successful reference parity on these observations does not establish universal
cross-platform bitwise identity or secure runtime history supply.

## Reproduction and inspection

No Docker, Atlas, API, frontend, wallet, Hardhat, Oracle worker or Pinata is needed.
The existing dataset stays in place and is checksum-verified. Generated outputs
stay under ignored `docs/engineered/advanced-*`; nothing is seeded into MongoDB.

The isolated environment was announced before creation. Pinned binary wheels
were installed there, not into global Python. NumPy/SciPy/XGBoost use one thread;
the export uses a 768 MB JS heap cap. No full-stack services were started.

```powershell
# First-time setup (already done on the reviewed host)
python -m venv backEnd/research/.venv
backEnd/research/.venv/Scripts/python.exe -m pip install --only-binary=:all: -r backEnd/research/requirements.txt

# Fresh export and study, never overwriting the earlier result
npm --prefix backEnd run evaluate:advanced

# Re-evaluate retained prepared inputs; writes a new study subdirectory
backEnd/research/.venv/Scripts/python.exe backEnd/research/run.py docs/engineered/advanced-2026-10-24T07-28-37-781Z

# One prepared claim, all layers and explanation; no transaction
backEnd/research/.venv/Scripts/python.exe backEnd/research/infer.py docs/engineered/advanced-2026-10-24T07-28-37-781Z/study-20261024T073342Z/71 docs/engineered/advanced-2026-10-24T07-28-37-781Z/study-20261024T073342Z/71/example-input.json

# Artifact/source/data verification; read-only
node scripts/verifyAdvancedStudy.js docs/engineered/advanced-2026-10-24T07-28-37-781Z/study-20261024T073342Z

# Python component + packaged inference checks
backEnd/research/.venv/Scripts/python.exe -m unittest discover -s backEnd/research -p 'test_*.py' -v
```

For Linux/macOS use `.venv/bin/python`; `RESEARCH_PYTHON` can select an explicitly
prepared interpreter. Python is an offline research dependency, **not a new
Render startup requirement**. `infer.py` consumes the prepared allowlisted
feature/context contract, not an arbitrary raw hospital file. It checks artifact
receipts and fails closed on unavailable/nonfinite inputs. Receipts detect
accidental/tampered bytes relative to a trusted receipt; they are not publisher
signatures or proof of authentic history.

## Verification and next boundary

The dated machine record is
[advanced phase verification](../verification-results/advanced-ml-phase12-2026-10-24.json).
Fresh checks: **18 Python** component/packaged-inference tests; **169 backend**
tests (including seven dedicated Node context/reference tests) plus section-3
analytics; **19 Oracle** tests; configuration/ABI synchronization; seven-group
repository integrity; and pinned-environment dependency check. Historical browser,
contract and MongoDB results were not rerun or relabeled as fresh checks here.

Adding the new npm command made the old research inventory stale. Only its
source/configuration inventory was refreshed; historical datasets, model
weights, calibration, results and manuscript were not regenerated.

Phase 3 has not begun. Runtime integration needs authenticated claim-time
historical/graph context, supported artifact loading in both workers, calibrated
decision parity at boundaries, explicit model identity publication, rollback and
authenticated regressions. Scientific promotion also needs coverage repair and
new justified evaluation—not merely switching the active JSON filename.

Method references: [XGBoost prediction/SHAP](https://xgboost.readthedocs.io/en/stable/prediction.html),
[stable model storage](https://xgboost.readthedocs.io/en/stable/tutorials/saving_model.html),
[BiRank](https://arxiv.org/abs/1708.04396),
[conformal prediction](https://arxiv.org/abs/2107.07511).
