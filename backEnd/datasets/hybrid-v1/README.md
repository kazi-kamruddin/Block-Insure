# Block-Insure Hybrid Dataset v1.2

This dataset adapter combines the public healthcare-claims benchmark files in
`raw/` with controlled Block-Insure attack scenarios. It preserves the existing
claim, registry, oracle, auditor, and settlement interfaces; the application does
not consume the original CSV columns directly at runtime.

## Required raw files

- `Train-1542865627584.csv`
- `Train_Beneficiarydata-1542865627584.csv`
- `Train_Inpatientdata-1542865627584.csv`
- `Train_Outpatientdata-1542865627584.csv`

The expected byte sizes and SHA-256 hashes are recorded in `manifest.json`.

## Label contract

- `providerPotentialFraud` is the source dataset's provider-level weak-risk label.
  It must not be described as confirmed claim fraud.
- `controlledAttackTruth` is true only for a controlled scenario injected by
  Block-Insure. `actualFraud` is retained as a deprecated compatibility alias.
- `scenarioInjected`, `scenarioType`, and `scenarioVersion` identify that controlled
  ground truth.
- `baseDataOrigin` and `claimSetting` retain source provenance.
- Claim amounts are divided by 10,000 for local demo scale. This is a research
  normalization, not a USD/ETH exchange rate.

The provider-disjoint split is deterministic: 64% train, 16% calibration, and
20% test. Amount ranges and velocity thresholds are learned only from the
training partition. `test-untouched.jsonl` has no injected attacks;
`test-attacks.jsonl` is its paired counterfactual attack set with a deterministic
50% injection rate.

## Generated outputs

- `processed/train.jsonl`
- `processed/calibration.jsonl`
- `processed/test-untouched.jsonl`
- `processed/test-attacks.jsonl`
- `runtime/hybrid-primary.jsonl`
- `manifest.json`

The full generated JSONL files require approximately 1.3 GB. They and the raw
CSV files are intentionally ignored by Git; the manifest and this documentation
remain trackable. Generated files are written to temporary paths and published
only after all rows have been produced successfully, so an interrupted build
does not replace the last complete dataset.

## Commands

From `backEnd/`:

```text
npm run build:hybrid
npm run validate:hybrid
npm run reset:hybrid
npm run evaluate:hybrid
npm run benchmark:hybrid
```

From the repository root, the one-command clean hybrid launch is:

```text
npm run dev:hybrid
```

`reset:hybrid` installs 5,000 runtime registry rows in both oracle snapshots:
five legacy UI presets plus a deterministic, order-independent sample of 4,995
hybrid training rows. Preserving the five
legacy rows keeps the existing claimant demo presets and end-to-end workflows
available.

To return to the original synthetic-only local state, run the normal bootstrap:

```text
npm run dev:bootstrap
```

## Model boundary

Hybrid v1.2 keeps two deliberately separate questions. The deployed
`bernoulli-fraud-v3.1.0` model and its 18-feature protocol interface remain in
place for controlled protocol-irregularity experiments. The separately frozen
`provider-risk-real-v1.0.0` artifact is trained and tested at provider level
using every unique public-source claim across provider-disjoint partitions. Its
weak labels must not be relabelled as claim-level fraud.

The generated evaluation currently reports provider-held-out ROC AUC `0.879659`
and F1 `0.3868`. Proof-bound rule/model routing captures all eight injected
scenario types in the paired test set, while `7.79%` of untouched records are
routed for review. That is an escalation rate, not a false fraud conviction
rate. The runtime benchmark builds a 5,000-leaf tree and verifies 100 sampled
proofs; timings are descriptive for the local machine.

## Source and limitations

The raw files come from the Kaggle public-secondary dataset
[Healthcare Provider Fraud Detection Analysis](https://www.kaggle.com/datasets/rohitrox/healthcare-provider-fraud-detection-analysis),
listed as CC0 on the dataset page. Beneficiaries can overlap provider-disjoint
partitions; their identifiers are excluded from model features, and the exact
overlap counts are disclosed in `manifest.json`. This is not a prospective
clinical or insurer validation study.
