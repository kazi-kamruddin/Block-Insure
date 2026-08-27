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
