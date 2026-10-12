# Evaluation artifact authority

`phase5-evaluation.json` with `schemaVersion: 4` is the authoritative fraud and
triage evaluation artifact. `research-manifest-v4.json` records its
reproducibility identity and the identities of the model, triage policy,
datasets, compiler configuration, and contract bytecode.

Files named `risk-model-*`, `threshold-*`, `roc-curve.csv`,
`precision-recall-curve.csv`, and `baseline-comparison.csv` are retained only
as legacy provenance. Runtime APIs and chart generation do not fall back to
them.

Regenerate the authoritative offline artifacts with:

```powershell
cd backEnd
npm run research:baseline
```

Phase 3/4 authoritative artifacts are `phase3-reserve-evaluation.json` and
`phase4-evidence-evaluation.json`. Regenerate them and their SVG charts with
`npm run research:phase34`. Reserve results are synthetic/advisory; evidence
storage timing uses a local content-addressed adapter and excludes public IPFS
network latency.

`hybrid-v1-evaluation.json` with `schemaVersion: 2` is the authoritative hybrid
evaluation. It contains provider-level bootstrap intervals, four comparator
baselines, feature-group ablations, and paired model/rule/combined routing
ablations. The provider label is weak provider risk; controlled injection is the
only claim-level ground truth in this artifact.

The paper-facing, cross-study snapshot is generated at repository root with
`npm run research:paper-evidence` and written to `paper-evidence/`. It references
these authoritative JSON artifacts rather than replacing them.
