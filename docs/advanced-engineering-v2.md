# Source-grounded dataset engineering and limitation repair

Review/execution date: **24 October 2026, Asia/Dhaka**. Application baseline:
`26c5b10` plus the offline research worktree. **No runtime model promotion.**

## Bottom line

The same 558,211-row Medicare benchmark remains the only source dataset. We
cannot manufacture adjudicated fraud ground truth by better engineering.
Instead, v2 supplies a more defensible **controlled billing-action benchmark**:
raw-source anchors, declared simulated actions, plausible benign look-alikes,
strictly prior observable histories and deliberately indistinguishable intent
pairs. Its value is testing triage behavior and limits, not certifying fraud.

The previous v1 data, models and numbers are retained. Before changes, the
research implementation was copied with hashes to the ignored
`docs/engineered/advanced-before-engineering-v2-2026-10-24/`. Current code is not
silently presented as reproducing the old code's verification.

## What changed

1. **Reconstruct pristine records from the original CSVs.** Do not attempt to
   remove old attack flags while unknowingly retaining modified amounts/status.
   Raw claim bytes are checked against the retained original manifest before
   and after reconstruction. Weak provider `PotentialFraud` labels are not read
   to generate claim targets. Demographics are neither model inputs nor copied
   into the prepared research files.
2. **Assign patient/provider groups over the complete source before sampling.**
   Inherited provider partitions are retained; patients seen in several groups
   are assigned conservatively to the earliest group. Contexts obey the same
   assignment, not just sampled rows. Train, tuning, probability, conformal,
   policy and test groups are checked for overlap.
3. **Use a knowledge-availability proxy.** A bill is considered available at its
   source invoice/end-of-care date, not merely its admission date. Same/current/
   future dates are excluded. Simulated earlier events shift admission,
   discharge and invoice dates coherently. Actual submission timestamps remain
   unavailable; these are declared date-level proxies.
4. **Generate actions independently of scores.** `scenariosV2.js` never imports
   a predictor or uses a classifier threshold to decide a target. An audit trace
   records intervention, assumed latent facts, severity, changed fields and
   additional historical events. Hidden truth is separate from observable
   record/claim/context objects. Predictors receive no family, target or intent.
5. **Include benign confounders and impossible-to-resolve pairs.** High costs,
   repeats and surges are not relabelled malicious just because a rule routes
   them. 1,200 paired cases across the three seeds have opposite simulated
   intent but exactly identical feature/context inputs and model scores.
6. **Correct the calibration experiment.** Label-conditional split conformal
   uses a separate quantile per experimental class, with conservative abstention
   for fewer than 30 calibration rows in a class. It is compared with marginal
   conformal on the same frozen predictor and calibration data.
7. **Address temporal confounding.** Fit a prior-90-day provider-normalized
   baseline plus shared day-binned self-excitation. Choose against a Poisson
   reference using the chronological last 20% of training histories. Zero
   excitation is allowed. The chosen fit has alpha about 0.695, not the earlier
   saturated 0.95. It remains an approximate temporal model, not proof of bursts
   caused by fraud or a temporal-generalization result for the classifier.
8. **Test shifts without retraining.** Primary 12% intervention, 50% prevalence,
   increased severity, and held-out coordinated-billing family use the same
   fitted model, calibration, conformal thresholds and routing policy.
9. **Separate ranking from safeguarded routing.** A label-blind finite-cohort
   allocator compares scores at exact 20/30/50% workloads, retaining mandatory
   rules and breaking score ties by hash ID. Extra conformal/OOD gates are
   deliberately omitted only in this diagnostic, not quietly disabled in the
   pipeline. An unavoidable mandatory rate above budget is reported honestly.
10. **Retain exact export.** v2 specifies float64 sigmoid of the float32 tree
    margin in Python and the JS reference, avoiding native sigmoid rounding
    differences. Six-decimal tree rounding remains rejected; no tree boundary
    is casually rounded to achieve compact deployment.

## Scenario semantics

| Simulator action | Observable change | Benign/limitation check |
| --- | --- | --- |
| Amount inconsistency | Requested amount exceeds unchanged registry bill | A protocol inconsistency, not independent proof of criminal fraud |
| Invoice replay | Previously used invoice status, same invoice identity in prior event | Replay identity is explicitly tested |
| Date inconsistency | Claimed incident outside recorded care | Incorrect data can occur without malicious intent; this positive is a known simulated deliberate action |
| Coherent inflation | Registry and requested amount rise together | Benign high-cost counterpart has identical observations; underlying justified cost is only a simulator assumption |
| Repeated service billing | Several earlier similar bills | Benign recurring care counterpart; actually rendered service count is hidden simulator truth |
| Concealed phantom billing | No changed observable record | Simulator explicitly assumes no service was rendered; mere provider compromise is NOT treated as claim fraud |
| Coordinated billing burst | Concentrated prior provider activity | Held out from positive training families; benign surge uses the same observable mechanism; no invented bank graph |

These choices are motivated by the categories in
[CMS's educational fraud/abuse booklet](https://www.cms.gov/Outreach-and-Education/Medicare-Learning-Network-MLN/MLNProducts/downloads/Fraud-Abuse-MLN4649244.pdf)
and the [FBI healthcare-fraud overview](https://www.fbi.gov/investigate/complex-financial-crime/healthcare-fraud).
Neither source validates this simulator's severities, prevalence, clinical
necessity or ground-truth assignments. The difference between an error, abuse
and intentional fraud cannot generally be recovered from billing fields alone.

## Recorded design and provenance

Tracked plan: `backEnd/research/engineering-plan-v2.json`. Three seeds:
503/719/947. Each has 3,000 training/test anchors and 750 candidates in each of
the four calibration groups. Training and primary test use the same declared
12% intervention mechanism. Severity is drawn over overlapping benign/attack
ranges, not set just above a classifier's threshold. The positive coordinated
burst family is absent from training and introduced in its own challenge.

The generator was designed **after inspecting v1**. The first v2 pilot informed
an availability correction; the next pilot's audit tightened replay identity
and replaced the vague hidden-compromise name with explicit simulated phantom
billing. Family cardinality, intervention rates, feature definitions and model
tuning were not adjusted to force a higher score. All such runs remain pilots,
not independent replications. This is exploratory engineering, not preregistered
natural-fraud confirmation.

Reviewed export:
`docs/engineered/advanced-engineering-v2-reviewed-2026-10-24/`.
Study: its `study-20261024T075106Z/` directory. Prepared records, trace and model
artifacts are ignored; only code, documentation and a small verification summary
are tracked. Original source and runtime MongoDB are unchanged.

## Actual outcomes—not a forced win

Primary cohort, arithmetic means across three seeds:

| Safeguarded method | Simulated-action recall | Review rate | F1 | Declared cost |
| --- | ---: | ---: | ---: | ---: |
| Rules / frozen NB | 54.03% | 12.43% | 0.5110 | 0.6095 |
| Base GBDT + rules | 54.96% | 13.34% | 0.5003 | 0.6099 |
| Full class-conditional pipeline | 93.83% | 70.30% | 0.2583 | 0.8440 |
| Full candidate without conformal gate | 57.00% | 17.67% | 0.4530 | 0.6395 |

The complete pipeline's high recall is expensive abstention, not a demonstrated
overall improvement. The requested 30% policy budget is exceeded by unavoidable
conformal/OOD/rule safeguards; the selector reports the higher effective budget
instead of overriding safeguards. Cost weights remain experimental 10/1/0.25,
not measured financial costs. No part of this table warrants promotion.

A separate label-blind ranking diagnostic at **exactly 30% review** yields mean
recall about **65.96% for full-model scores vs 62.75% for NB scores**. These are
modest exploratory ranking gains on this constructed benchmark, not the 93.83%
full-policy result and not a production workload claim. Provider-cluster paired
intervals are supplied in the post-hoc audit; no universal superiority or causal
benefit is claimed.

Same-predictor coverage comparison (descriptive post-hoc audit):

| Cohort | Marginal conformal | Label-conditional conformal |
| --- | ---: | ---: |
| Matched 12% intervention | 91.24% | 90.84% |
| 50% prevalence shift | 72.22% | 92.22% |
| Larger-severity shift | 91.21% | 90.83% |
| Held-out attack family | 85.97% | 80.99% |

This isolates the **pure prevalence-shift** benefit without changing predictor
or rebalancing the test labels after seeing predictions. It does not repair
arbitrary conditional/family shift. Label-conditional assumptions and statistical
efficiency trade-offs follow [Podkopaev and Ramdas, 2021](https://proceedings.mlr.press/v161/podkopaev21a/podkopaev21a.pdf).
Mean empirical coverage is not a guarantee for every provider, subgroup or claim.

All 1,200 intent pairs have zero model-score difference. This is the correct
outcome: when observations are identical, no model can recover the hidden
rendered-service/intent distinction. Do not add a fake feature to eliminate
this apparent failure.

Exact tree export and packaged preprocessing pass primary parity checks. Rounded
exports change 35/20/15 routing decisions by seed and remain rejected. These
numbers are separate from v1's results; the benchmark populations changed.

## Reproduce / inspect

Reuse the already prepared, pinned Python environment. No new Docker container,
Atlas connection, chain, API, wallet or hosted service is needed. All model
training is one-threaded; the JS exporter has a 768 MB heap limit.

```powershell
# New full reconstruction + study, always a new ignored directory
npm --prefix backEnd run evaluate:engineered

# Reuse reviewed prepared data; writes another study directory
backEnd/research/.venv/Scripts/python.exe backEnd/research/runV2.py docs/engineered/advanced-engineering-v2-reviewed-2026-10-24

# Optional same-predictor descriptive audit, once per new study directory
backEnd/research/.venv/Scripts/python.exe backEnd/research/auditV2.py docs/engineered/advanced-engineering-v2-reviewed-2026-10-24/study-20261024T075106Z

# Read-only verification (including audit when present)
node scripts/verifyEngineeredStudy.js docs/engineered/advanced-engineering-v2-reviewed-2026-10-24/study-20261024T075106Z

# Explicitly verify OLD v1 against its archived source
node scripts/verifyAdvancedStudy.js docs/engineered/advanced-2026-10-24T07-28-37-781Z/study-20261024T073342Z --snapshot docs/engineered/advanced-before-engineering-v2-2026-10-24
```

Repeated audit calls refuse to overwrite the earlier audit. The source/data/
model hashes, plan, main results and post-hoc audit are distinguished in
[the dated verification record](../verification-results/advanced-engineering-v2-2026-10-24.json).
`infer.py` supports both old and new artifact schemas; research receipts are
integrity checks, not signatures proving truthful medical data.

## Remaining boundary

**HOLD.** Availability leakage and vague action labels were repaired; meaningful
benign controls, shared-workload comparison and shift tests now exist. Nominal
coverage under prevalence shift has a principled repair, but review burden,
unseen-family coverage and hidden intent remain real limits. No amount of
engineering transforms this dataset into naturally labelled claim fraud. Runtime
integration still requires authenticated history supply and separately scoped
regressions. The live application continues using its unchanged NB model/policy.

No paper results, contracts, hosted flags or databases were modified. Earlier
browser/contract/storage results are historical, not fresh verification of this
offline follow-up. Fresh test outcomes are recorded in the final handoff.

Fresh final checks on 24 October: **176 backend tests** plus section-3 analytics,
**19 Oracle tests**, **23 Python tests**, repository integrity (seven groups),
ABI/configuration synchronization, current v2 artifact/source/data verification,
and explicit archived-source v1 verification all passed. The 14 new research
Node cases are included in the backend total, not an additional independent
suite count. No live full-stack or browser campaign was run for this offline pass.
