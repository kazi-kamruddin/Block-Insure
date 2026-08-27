# Phase 3/4 Reserve and Evidence Research

## Scope and authority boundary

Phase 3 adds an advisory reserve-adequacy experiment. Phase 4 adds a local
confidential-evidence lifecycle benchmark. Neither phase changes Solidity,
claim decisions, payout authority, or the current 5% reserve gate enforced by
`PolicyEconomics`.

## Phase 3: reserve adequacy simulation

Run:

```powershell
cd backEnd
npm run evaluate:reserve
```

The experiment uses a seeded aggregate compound Poisson–lognormal model over
5,000 synthetic annual periods and 1,000 one-ETH policy exposures. Claim
amounts are capped at coverage and converted to insurer liability using the
implemented deductible cap and insurer-share formula. It evaluates baseline,
high-frequency, heavy-tail, and combined-stress scenarios over capital ratios
from 2% to 30%. Aggregate Poisson rates above 30 use a documented normal
approximation.

Reported outcomes include shortfall probability with bootstrap intervals,
conditional expected shortfall, unfunded-loss fraction, capital utilization,
excess capital, VaR95/VaR99, and the lowest tested capital ratio reaching the
predeclared 1% shortfall target. `FUNDING_REQUIRED` is represented by a period
whose simulated insurer liability exceeds available reserve capital.

The generated `phase3-reserve-evaluation.json` is suitable for comparing the
existing fixed 5% rule against transparent stress assumptions. It is not a
pricing model, regulatory capital calculation, or insurer solvency claim.

## Phase 4: confidential evidence lifecycle

Run:

```powershell
cd backEnd
npm run evaluate:evidence
```

The benchmark performs 30 measured repetitions after warm-up for three
deterministically generated non-PII document profiles: a 16 KiB invoice PDF, a
256 KiB multipage PDF, and a 1 MiB scanned-document image. It exercises:

- AES-256-GCM encryption/decryption with claim/version AAD;
- the actual Recrypt `Api256` proxy transformation and recipient decryption for
  one, two, and four recipients;
- RFC6962-style evidence inclusion proofs for 32, 128, and 512 leaves;
- a local SHA-256 content-addressed adapter for storage overhead only; and
- ciphertext, AAD, receipt, CID, gateway-outage, proof, revocation, and
  key-version attacks; and
- key-rotation plus revocation/stale-version authorization-check timings.

The artifact reports p50/p95/mean timings, ciphertext expansion, PRE capsule
size, proof nodes/bytes, and a threat/control/result matrix. Local content-store
latency must not be presented as Pinata, public IPFS, or network performance.
Revocation prevents future transformed-key service but cannot erase plaintext
already obtained by an authorized recipient.

## Reproduction and charts

```powershell
npm run research:phase34
```

This generates both JSON artifacts, four SVG figures, and refreshes the main
research manifest. The admin Thesis Results dashboard consumes both artifacts
through the existing evaluation-summary API.

The combined whole-project research command is:

```powershell
npm run research:all
```

Phase 3 reproducibility covers seeded loss outcomes and bootstrap samples.
Phase 4's reproducibility identity covers corpus sizes, protocol parameters,
proof sizes, and adversarial outcomes; machine-dependent timing measurements
are intentionally excluded from its reproducibility hash.

## Thesis interpretation

The defensible Phase 3 claim is a quantified trade-off between simulated
shortfall risk and reserved capital under declared assumptions. The defensible
Phase 4 claim is that the implemented controls detected the specified
manipulations at measured local cryptographic cost. External loss data, real
IPFS/network trials, browser/device benchmarking, clinical PII governance, and
regulatory review remain future validation work.
