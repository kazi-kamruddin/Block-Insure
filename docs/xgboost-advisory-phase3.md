# XGBoost runtime advisory integration

**Historical integration stage, 24 October.** For the current authoritative
risk-routing arrangement, read [the 27 October migration](xgboost-protocol-migration.md).
The results below remain evidence for their original model, policy and source
configuration. No retraining or new natural-fraud accuracy claim is implied by
the later worker integration.

Review date: **24 October 2026 (Asia/Dhaka)**. Baseline: `856fd7f`, plus
this implementation. The current package is a runtime advisory integration,
not a replacement of the Oracle verification protocol.

## User decisions implemented

- XGBoost is the **default primary advisory in Admin claim details**.
- Bernoulli NB is displayed alongside it as the current protocol comparison.
- All advanced components remain: observable continuous features, prior
  patient/provider history, structural graph propagation, normalized daily
  temporal excitation, Mahalanobis OOD, calibration, exact Shapley explanations
  and label-conditional conformal sets.
- Uncertainty is visible. OOD/conformal warnings do **not each independently
  compel review** in the new balanced policy. OOD remains an input to XGBoost.
- The primary validation review-budget ceiling is 30%, with 20% and 50%
  sensitivity comparisons. This is not a quota or a runtime capacity guarantee.
- Existing integrity/manual-review rules remain mandatory within the advisory
  recommendation. There is no automatic rejection from the model.

The application now executes the full XGBoost pipeline for actual claims opened
by an Admin. It is not just displaying offline example scores. Its recommendation
has no write authority over claim state, Oracle results, auditor votes, reserves
or payouts. NB remains in the existing proof-bound Oracle verification path.
The next protocol-model change would need a separately versioned, coordinated
backend/worker/model-identity rollout; this integration does not masquerade as
that change.

## Balanced policy and evidence

The original full-policy study remains untouched. Its uncertainty gates routed
70.30% of primary-cohort observations. The new policy selects a **score
threshold on the existing policy partition**, preserving mandatory rules and
minimizing the already declared 10/1/0.25 experimental cost within the requested
budget. It never chooses a threshold from test labels or forces the queue to
consume its entire budget.

The tracked design is `backEnd/research/phase3-plan.json`. It was written after
earlier results; this is exploratory policy engineering, not an independent
confirmatory study. The runtime artifact uses seed **503**, the first seed in
the previous plan, fixed before the new evaluation. It is not the best test
seed. All three seeds and four test cohorts remain in the results.

Completed run: `docs/engineered/advanced-phase3-20261024T082620Z/summary.json`.
Three-seed primary-cohort means:

| Configuration | Simulated-action recall | Review rate | F1 | Assumed cost |
| --- | ---: | ---: | ---: | ---: |
| Earlier rules / frozen NB | 54.03% | 12.43% | 0.5110 | 0.6095 |
| Earlier complete uncertainty-gated policy | 93.83% | 70.30% | 0.2583 | 0.8440 |
| New balanced XGBoost advisory | 56.48% | 16.79% | 0.4613 | 0.6346 |

This is an explicit trade-off, **not evidence of overall superiority**. The
fixed seed-503 runtime policy has threshold 0.086932212, validation review rate
15.73%, primary-test review rate 13.33% and recall 53.67%. Other seeds illustrate
variation; they are not silently substituted. A score is calibrated against
engineered billing actions, not an adjudicated natural-fraud probability.
The prior exact-30%-workload ranking diagnostic is a different experiment and
must not be presented as this threshold policy's runtime result.

Frozen-policy shift results (three-seed means):

| Cohort | Simulated-action recall | Review rate |
| --- | ---: | ---: |
| Primary matched mechanism | 56.48% | 16.79% |
| 50% intervention prevalence | 57.25% | 34.63% |
| Larger severities | 56.79% | 17.72% |
| Held-out coordinated-billing family | 6.56% | 11.22% |

The held-out-family failure is substantial. Displaying OOD/conformal warnings
does not repair it or guarantee that an Admin will act on a warning. The
prevalence-shift review rate also exceeds 30%, demonstrating why a validation
ceiling cannot be called a runtime capacity guarantee. Default advisory status
reflects the user's stated trade-off preference, not empirical certification.

The first parity run exposed two threshold decisions sensitive to tiny
Python/JavaScript floating-point differences. That failed pilot remains under
ignored `docs/engineered/advanced-phase3-*`. The final policy uses integer
billionths of calibrated score for threshold selection/comparison, retaining
the full score and exact unrounded trees. This decision contract is explicit
in the plan and bundle. All **36,000** final cohort evaluations have zero
Python/JavaScript routing differences. Scores match within 1e-6. Native XGBoost
and JS exact tree-path-dependent Shapley contributions/base values agree within
1e-4 on 20 rows per seed/cohort (240 explained checks). These are reused
constructed cohorts, not 36,000 independent natural claims.

## Runtime architecture and authority

`GET /api/claims/:claimId/advisory` requires an authenticated, currently
authorized **ADMIN**. Other roles retain their existing workspaces. It accepts
only a positive decimal claim ID; it never accepts caller-supplied features,
labels, history, thresholds, model paths or recipient identities. The route
limits each wallet to 30 reads/minute; the service permits two distinct
concurrent computations and coalesces duplicate reads.

The controller reads claim/version and registry selection at one block tag.
An Oracle request for that claim version pins the historical registry version.
Without a current-version request, it uses the committed registry visible at
that read block. Older appeal requests cannot pin a new claim version to stale
facts. It checks the claim version and canonical block again before returning.
Deployment scope includes chain ID, manager address and configured deployment
block/hash, separating local redeployments.

`RegistrySnapshotChunk` supplies the archive. The service validates contiguous
chunks, caps input at 10,000 records and reconstructs the complete Merkle root
before trusting any history. Missing/corrupt/incomplete archives produce an
explicit unavailable result or dependency error, never zero risk or a silent
NB substitution. It does not use current mutable records to fill historical
archive gaps. This authenticates membership in the administrator-published
registry; it does not establish independent medical truth or independence of
the shared publisher.

The runtime history contract:

1. Allowlist only observable billing/identity/date fields.
2. Use exact patient and hospital identifiers. Never invent a mapping from a
   new wallet or demo hospital to unrelated Medicare entities.
3. Exclude the current invoice, equal-day/future observations and dates more
   than 90 days before the cutoff.
4. Use the earliest of invoice date, claim submission and snapshot publication
   as the date-level cutoff. Invoice date is an availability proxy, not an
   independently recorded submission time.
5. Recompute graph/history from the archive. Ignore `fraudLabel`, weak provider
   targets, mutation flags and pre-engineered history flags for XGBoost.
6. Expose absent patient/provider history. Zero matching entries do not prove
   the patient/provider has no history outside this bounded snapshot.

Each model uses its own frozen feature contract on the same registry snapshot;
the NB comparison is a recomputation, not an alteration of a recorded Oracle
result. The UI separately presents those existing authoritative results.

## Portable inference and storage

- `oracle/xgboostAssessment.js`: zero-dependency deterministic Node inference,
  OOD, calibration, conformal and exact cover-weighted path-dependent Shapley
  explanations. No Python installation is needed for backend or Render.
- `backEnd/artifacts/xgboost-advisory-v1.json`: small tracked portable model
  bundle. No patient records, source rows, credentials or training examples.
- `backEnd/artifacts/xgboost-advisory-manifest.json`: hashes the model and
  relevant observable sources. Missing/mismatched artifacts fail explicitly.
- `ClaimAdvisoryAssessment`: immutable, deterministic-ID records bound to
  deployment, claim facts/version, registry root/version, model/manifest and
  policy. Repeated/concurrent reads and process restarts reuse stored content.
- A bounded in-process promise cache reduces repeated root reconstruction.
  Failed computations are removed so retry can recover. An explicit local
  reset includes these advisory records; ordinary startup does not remove them.

Explanation values add to the raw margin. They are not percentage-point
probabilities, causal explanations, clinical correctness proofs or evidence that
someone inspected a medical document. Assessment APIs expose no source patient
identifiers or raw historical rows. Artifact hashes are integrity/provenance
checks, not signatures proving truthful records.

## Demonstration and operation

1. Start the existing valid local chain/application with the normal daily
   workflow; this feature does not reset or redeploy it.
2. Submit a claim and complete the usual Hospital step.
3. Open **Admin → Claims → Review Claim**.
4. Inspect **XGBoost advisory assessment**, NB comparison, uncertainty and
   history availability. Expand the exact SHAP and provenance sections.
5. Refresh the assessment. Unchanged facts/root/model retain its identity.
6. Continue the existing Oracle/manual-review/settlement workflow. The advisory
   alone has created no transaction or decision.

Run packaging integrity checks with:

```powershell
node scripts/packageXgboostAdvisory.js --check
```

Research reproduction, using the already prepared one-thread environment:

```powershell
npm --prefix backEnd run evaluate:advisory
```

It creates a new ignored study directory. Identical published bundles are
retained; a different bundle cannot overwrite the published version. If the
observable implementation changes, review/version the model contract and
explicitly repackage with `node scripts/packageXgboostAdvisory.js`; do not
automatically update hashes to silence a mismatch.

Deploying this UI/API integration requires the frontend **and backend** changes.
Render's API build filter now includes the shared XGBoost inference module.
No Oracle worker, Solidity/ABI, hosted activation flag or email configuration
change is required for this advisory release. No deployment is performed by
these packaging commands.

## Verification boundary

Fresh checks and exact source fingerprints are recorded in
`verification-results/xgboost-advisory-phase3-2026-10-24.json`.

| Fresh check | Result |
| --- | --- |
| Backend unit tests | 194 passed, including 18 new advisory cases |
| Section 3 analytics | Passed |
| Existing Oracle tests | 19 passed |
| Existing Python research component tests | 23 passed |
| Actual-Mongo advisory archive/storage/restart tests | 2 passed |
| Authenticated browser claim workflows | 2 distinct passed; final automatic path repeated successfully |
| Production-build browser suite | 7 passed, original timing/error assertions retained |
| Frontend lint / production build | Passed |
| Repository / ABI synchronization | Seven groups passed / passed, existing size warning |
| Bundle/source and historical v2 artifact verification | Passed |
| Python/Node frozen-cohort parity | 36,000 scores/routes; zero route differences |

The claim browser checks exercise the real API, committed archive, model bundle,
database and local Oracle/settlement workflow. They include Admin comparison,
SHAP/provenance expansion, immutable refresh identity, 320px layout, keyboard
focus, policyholder denial and an explicitly injected missing-snapshot response
followed by recovery. That one UI failure state is a labelled test interception,
not a substitute for normal Live responses. Storage tests use actual MongoDB
to test missing/corrupt/gapped archives and restart/concurrent persistence.

Two stored assessments in the final local run recorded feature-ready inference
and explanation at 0.57–5.73 ms. This tiny sample excludes history construction,
root reconstruction, database and RPC latency; it is not a throughput benchmark.

Earlier application/paper checks remain historical. Two initial browser runs
caught a loading-state dereference and an attempted private mapping read; both
were corrected without weakening claim assertions. A unit ABI-presence check
now protects the actual contract reader names. A production UI attempt inside
the restricted sandbox failed on Google Fonts network denial and consequent
navigation timing errors; the permitted rerun passed all seven checks without
test-source changes. Completed runs were staged, not one uninterrupted campaign.

The already existing local MongoDB container was reused with its 0.75 CPU/768 MB
limits, then returned to its original stopped state. Only disposable local test
data was reset. Owned application/worker/preview processes stopped and test ports
were released. No Atlas mutation, new container, real email, model retraining,
contract change, full contract campaign, fresh Slither run, hosted activation,
deployment or Git commit occurred in this pass.
