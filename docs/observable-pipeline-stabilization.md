# Six-step observability and demonstration stabilization

Review date: 24 October 2026 (Asia/Dhaka). Base revision: `7f14bf7`;
the changes described here are an uncommitted worktree, not a deployment.
This follows the independent observations but corrects their inaccurate premises.

Use Node 24 for full-repository development and the next Vercel build. The
frontend supports Node 22.13+ (22.x) or 24.x; backend/Oracle Render Node 20 settings
remain unchanged. PDF.js is pinned to 6.4.299 after checking the
[upstream scripting advisory](https://github.com/advisories/GHSA-hq66-cqwq-w95j).
The frontend production dependency audit reports zero known vulnerabilities on
this review date; that is not a complete application-security certification.

## Implementation and boundaries

| Step | Implemented | Practical value and boundary |
| --- | --- | --- |
| 1. PDF preview and invoice readiness | Local, lazy-loaded PDF.js canvas/text preview; authenticated invoice-binding check; explicit recovery messages. The upload panel supplies the document ID and ciphertext hash; Escape restores focus. | Removes Chromium's blocked sandbox-plugin preview without permitting document scripts. Readiness discloses only an invoice bound to the current wallet; it is advisory, not authorization or a medical verdict. |
| 2. Feature alignment | One dependency-free observable feature contract feeds backend, independent workers and new training/evaluation. Probability calibration and policy freezing use the same extractor. Target values are included in new training-data hashes. | Label/marker changes cannot alter inference inputs. The historical extractor remains explicitly historical; the active model's old weights are not silently retrained. |
| 3. Scenario validity | Versioned candidate-claim context exists before registry mutation; date mismatch changes a genuine comparison input. Prior history is preserved from source chronology. | Hidden provider compromise and advisory-only near-duplicates remain negative controls, not newly planted detection signals. Suspicious invoice status is an integrity finding, not a cryptographic proof of fraud. |
| 4. Safe rebuild/evaluation | New complete engineered rows and manifests under ignored `docs/engineered/`; bounded deterministic training/evaluation; separate model and policy artifacts; input checksums and source-change checks. | Existing data, deployed identities, runtime weights, paper and historical measurements remain unchanged. The staged dataset is not seeded into MongoDB. |
| 5. Lifecycle/recovery | Terminal allocation rejects competing pending/approved benefits and releases only their reserved amounts; secondary-only registry rows are reconciled using revision-checked deletes. | Avoids stranded liability and publication deadlock while retaining pull payments, historical requests, existing medical reservations and archived roots. This is not distributed-publisher certification. |
| 6. Incremental ablations | Rules, observable NB, NB+rules, binary LR+rules, and continuous LR+rules compared on the same held-out examples. Numerical LR mode is explicit; old binary mode remains the default. | Establishes an honest measured ladder, not an automatic ML upgrade. GBDT, graph/OOD, exact SHAP and conformal coverage are not implemented by this change. |

## New research record

The retained full rebuild is
`docs/engineered/observable-2026-10-23T19-34-11-717Z/`.
The retained final evaluation and staged models are in
`docs/engineered/observable-2026-10-23T19-35-43-482Z/`.
Directory timestamps are UTC; these runs took place on 24 October in Dhaka.
Earlier development runs are superseded, not extra independent replications.
Only this task's superseded pilot dataset/evaluation directories were removed
to reclaim space; they can be regenerated. Pre-existing historical datasets,
research numerics and paper artifacts were preserved.

The source remains the existing Medicare provider benchmark: **558,211 unique
claims**. Engineering reconstructs registry records and controlled attack truth;
it does **not** convert weak provider labels into natural claim-level fraud labels.
Rows preserve the newly computed `observableHistory`. The four full processed
files total about 1.57 GB; large generated records and staged artifacts are ignored.

For the new bounded experiment, all patients seen in the full training partition
are excluded from calibration/test; all calibration patients are excluded from
test. Model-calibration and policy-selection subsets use different providers,
with overlapping patients purged again. Every sampled partition pair is checked
for **zero patient and provider overlap**. There is no temporal-generalization
claim. Purging changes the evaluation population and does not establish universal
out-of-distribution performance.

Training uses **4,000** examples. Probability calibration uses **1,667**;
policy selection uses **2,277**; testing uses **4,000**, including **2,047**
controlled attacks. Deterministic seed: `20260828`. Thresholds are selected before
test scoring. Normalization is fit on training rows only. Five added continuous
inputs describe bill magnitude, bill/range ratio, care duration, invoice lag and
past-claim count; procedure-code presence is not treated as a fraud signal.

| Method | Controlled-attack recall | False routing on unmutated rows | F1 |
| --- | ---: | ---: | ---: |
| Rules only | 75.33% | 6.04% | 0.8319 |
| Observable NB only | 63.21% | 6.04% | 0.7482 |
| Observable NB + rules | 75.33% | 6.04% | 0.8319 |
| Binary LR + rules | 75.33% | 6.04% | 0.8319 |
| Continuous LR + rules | 76.99% | 11.26% | 0.8202 |

Here a positive decision means additional scrutiny / failed automatic
verification, **not a final fraud conviction**. Unmutated rows are not adjudicated
legitimate claims; “false routing” is relative to the controlled label definition.
NB adds no incremental detections to rules in this sample. Continuous LR adds
34 detected attacks but also 102 additional routes among unmutated examples;
its F1 is worse. No significance, population confidence interval, real-world
fraud accuracy or improvement over the frozen paper experiment is claimed.

All **253** hidden provider-compromise examples and **281** advisory-only duplicate
examples have unchanged observable feature vectors. Occasional routing of these
examples is also present in their unmutated inputs, not evidence of discovering
the concealed attack. All 260 suspicious-invoice examples route through the
invoice-status check even though their model feature vector is unchanged.

This is why model promotion remains deliberately **off**. The final staged model
has its own model identity, policy identity, dataset manifest/checksums and source
hashes. It cannot be substituted into a running committed Oracle configuration
by merely editing a file. A future promotion must coordinate model/policy identity,
deployment configuration, both workers, source-row compatibility and new
authenticated regressions. Do not copy the staged dataset into the historical
`hybrid-v1` paths or seed an Atlas database as an informal promotion step.

## Reproduction

Fresh versioned rebuild and bounded evaluation (no database, wallet or chain):

```powershell
npm --prefix backEnd run evaluate:observable
```

To re-evaluate the retained dataset without generating another 1.57 GB:

```powershell
node --max-old-space-size=768 -e "require('./backEnd/scripts/evaluateObservablePipeline').run({datasetRoot:'docs/engineered/observable-2026-10-23T19-34-11-717Z'}).catch(e=>{console.error(e.message);process.exitCode=1})"
```

This writes a new timestamped evaluation directory and verifies source-data
checksums. An existing final evaluation is never overwritten. The legacy
`train:model`, `freeze:model`, `freeze:triage` and `research:artifacts` commands
still have their documented mutating behavior; they are not a safe substitute
for this staged workflow. In particular `freeze:model` trains its own synthetic
model rather than freezing a preceding MongoDB training run, and the capacity-cost
policy is not conformal prediction. Newly generated freeze artifacts now carry
their real generation date rather than reusing an August training date.

## Verification

See [the dated verification record](../verification-results/observable-stabilization-2026-10-24.json)
for exact commands, observed outcomes, initial failures and final reruns. Local
browser verification uses the existing resource-limited MongoDB container,
disposable loopback database, simulated Pinata, local Hardhat, two workers and
one Playwright worker. No Atlas, Render, Vercel or public chain is changed.

The Manager remains **24,320 bytes**, below the **24,448-byte** maintenance
budget but with only 256 bytes of EIP-170 headroom. Benefit cleanup is in
`PolicyBenefitsManager` (**10,918 bytes**), not in the size-constrained Manager.
No ABI signatures, event layouts, four-auditor quorum thresholds, PRE scheme or
pull-payment design were changed. Contract changes require a fresh deployment;
this work does not upgrade an already deployed contract.
