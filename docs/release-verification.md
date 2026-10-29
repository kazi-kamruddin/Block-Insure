# Release verification and acceptance

The local release campaign and external acceptance are separate gates. A passing
preview, Docker build or local campaign does not establish hosted deployment.

## Local campaign

Inspect running services and select a disposable loopback database before setup.
Preserve Atlas, saved environments, existing deployments and historical research.
Start the prepared local MongoDB instance without changing its resources. Then:

```powershell
$env:E2E_MONGODB_URI='mongodb://127.0.0.1:27019/block_insure_release_e2e'
$env:E2E_DATABASE_NAME='block_insure_release_e2e'
npm run test:release
```

The runner records a source snapshot, executes a fixed serial stage matrix and
keeps fresh deployments for time-travel scenarios. `--stage <name>` selects one
bounded stage; see `scripts/runReleaseVerification.js` for the maintained list.
It includes unit/contracts/stateful/storage, production frontend, hospital/roles,
claims/evidence, worker restart, appeals, gateway recovery, provider-stub email,
funding/refunds, RPC/security and component-measurement checks.
The explicit accelerated stage deploys the separate testnet calendar, checks an
actual elapsed local payment window and reruns mixed OTP/EFT workflows. Its
wall-clock check uses one-second local mining, without timestamp travel. Other
calendar/expiry tests use disclosed local time fixtures; neither measures public
network latency.

Each run writes a new `tmp/release-*` directory and a source snapshot beneath
`verification-results/`. Reports preserve selected scope, outcomes, logs, durations
and hashes. A failed stage stops the run. Fix affected behavior, rerun applicable
checks and record whether the final evidence is one campaign or staged follow-ups.
Never substitute old passing logs for current execution.
Success also requires a final unchanged-source check after the last stage. Stage
passes alone leave `localCampaignPassed` false until that check succeeds. Generated
ABI copies must be normalized before taking the snapshot; deployment formatting
drift invalidates it just as an executable change does.

## Measurements

Local browser stages capture canonical contract receipts and runtime code sizes
before stopping their owned chain. A manager deployment includes its constructor's
child deployments, so gas rows are not independent additive component costs.
Local automining and test-script durations do not measure public-network finality
or a person's interaction time.
Sepolia activated Glamsterdam on 6 October 2026. Its execution-plus-state gas
accounting differs from the local Cancun fixture and Base Sepolia. Public
deployment uses a direct Ethers provider and an explicit current total budget,
avoiding Hardhat 2's older automatic multiplier path's execution-cap clamp. A provider's low gas
cap can prevent estimating a valid state-heavy creation; `deploy:testnet --probe`
reports that prerequisite and `--apply` refuses to proceed without simulation.
Do not hardcode local gas or treat an L1/L2 difference solely as a rollup effect.
See the [Ethereum announcement](https://blog.ethereum.org/en/2026/09/17/glamsterdam-testnet-announcement)
and [EIP-8037 accounting](https://eips.ethereum.org/EIPS/eip-8037).
Current receipt exports use schema v2: `receiptGasFeeWei` is receipt-charged gas
times actual gas price. They do not label all Sepolia gas as execution-only.
Execution/state splits remain null unless explicitly supplied by the RPC; L2
data fees remain separate and unknown when absent. Old v1 exports are historical.

The component stage specifies three synthetic sizes (64 KiB, 1 MiB, 8 MiB), ten
observations after one discarded warmup per size, and four recipient transforms.
Browser AES/WASM, native proxy-service transformation and a complete frozen-model
fixture are measured separately. Recipient timings within a repetition are
clustered observations. No new classification-accuracy or superiority claim follows
from timing a controlled fixture. Historical research artifacts stay unchanged.

## Installation and hosting

The Node service images and hosted Node configuration use Node 24.16.0. Build all
three Dockerfiles and record their actual image identities. Verify native PRE and
model loading in the API image, portable model loading and writable non-root state
in the Oracle image, and SPA/API routing in the Nginx image. Production secrets
belong in private configuration, never in build arguments or the image context.
The proxy pins are Nginx 1.30.6 and Caddy 2.11.7, checked against the
[official Nginx advisories](https://nginx.org/en/security_advisories.html) and
[Caddy release](https://github.com/caddyserver/caddy/releases/tag/v2.11.7).

The Render Blueprint remains a preview option. Its free service lifecycle must not
be represented as guaranteed continuous scheduling. Choose hosting capacity that
can run the API, publisher, reconcilers and both workers for the intended demo.
Account access, plan choices and testnet funding are external prerequisites.

## Full hosted readiness

The existing preview preflight permits explicitly disabled workers. The full gate
requires an explicit matching HTTPS RPC and a compatible selected manifest:

```powershell
npm run preflight:hosted:full -- --manifest <selected-network-manifest.json>
```

Set `HOSTED_FRONTEND_URL`, `HOSTED_BACKEND_URL`, `HOSTED_ORACLE_ONE_URL` and
`HOSTED_ORACLE_TWO_URL` privately first. The gate reads deployed bytecode (masking
only compiler-declared immutable values for comparison), release directory,
component wiring, model identity, published registry and active roles. It checks
backend readiness, distinct active Oracle wallets, snapshot roles and packaged
identity. It sends no transactions. Shared institutional data remains a trust
assumption; successful readiness does not prove independent clinical truth.
The frontend emits an allowlisted `release-config.json` with public chain,
component addresses and API origin. The full gate rejects a same-chain service
or build pointed at another deployment. It also reads the immutable payment
profile and the two-Oracle threshold. No environment dump, RPC credential or key
is emitted. Self-hosted Oracle URL bases may include `/oracle-one` and `/oracle-two`.

## External exit gates

1. Deploy and read back Sepolia and Base Sepolia separately with dedicated funded
   signers, coherent role/module settings and isolated application data.
2. Capture real receipts and their units using `measure:network`. Missing fee
   components stay unknown; inclusion and economic finality are separate concepts.
3. Verify a primary hosted workflow with local application services stopped,
   including background jobs and restart recovery.
4. Complete actual-wallet/mailbox acceptance: real delivered profile/OTP codes,
   encryption authorization, claim decisions, supported appeal and withdrawal.
5. Finalize the source/evidence index, audit dispositions, demonstration runbook
   and paper-ready tables. Credentials, OTPs and patient data are excluded.

The user supplies private account access and performs necessary interactive wallet
and mailbox actions. Git publication follows the standing user-controlled rule.
Mainnet, real banking/FX, independent medical verification, manuscript authorship
approval and academic submission are outside these release gates.
