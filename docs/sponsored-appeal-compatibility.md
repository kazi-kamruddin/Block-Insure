# Sponsored appeal proof compatibility

## Current Base disposition — 7 November 2026

Published and activated on the existing Base Sepolia manager. The v5 default is
`0x5fe2760cc2306065c60287b80df97ca66ba1da54ce3647389672e9bc5ea58e4a`.
Activation receipt:
`0x2b3789063c9d905605d00e88cf1e8efc03dce708109cb12bda8a738096ffed98`.
Hosted claim #3/version 2 completed its actual owner-authorized relayed appeal,
both v5 Oracle results and settlement withdrawal. Original claim #4 evidence
was recovered separately without replacing the claim or ciphertext.
Evidence: `verification-results/hosted-v5-acceptance-2026-11-07/summary.json`.
These are completed operations; do not repeat activation, appeal or recovery.
The rollout sections below retain the original local review and guarded procedure.
Injected testnet-signing transport is distinct from private MetaMask acceptance.

## Scope and identity

Protocol v5 keeps the frozen XGBoost bundle, feature extraction, calibration, threshold and routing policy. It changes appeal provenance: one successful configured-manager ClaimAppealed event must bind claimant/claim/reason hash, and one configured-adjudicator AppealStarted event must bind the pinned claim version. Payload/query/fact checks and receipt-before-request chronology remain. Outer relayer addresses do not substitute for those proofs.

This is a protocol-validation change, so v5 has a new request identity. Existing v4/NB requests select the exact historical direct-transaction validator. Their saved decisions, commitments and evidence are never reinterpreted. New local deployments select v5. Frozen v4 JSON, v1 operational manifest, model weights and inference sources remain unchanged. New xgboost-protocol-v5.json binds the validation policy and protected sources; strict oracle-runtime-compatibility-v2.json binds actual entrypoint/loader/scanner/readiness/validator bytes and all three supported identities. Unknown/missing/modified bindings fail closed.

## Verification boundaries

Exact final counts, source hashes and preserved failures are in verification-results/sponsored-appeal-2026-11-06/summary.json. Tests cover wrong actor/claim/hash/emitter/version, missing/duplicate events, revert, future receipt and provider outage. Round zero remains valid for the existing one-time access-preparation retry. Historical validator parity, immutable decisions and equal v4/v5 frozen inference are separately checked.

The sponsored browser test runs actual local frontend/API/contracts/Mongo and both workers. After ordinary login/rejection it installs synthetic delegated-wallet code at the local holder address using hardhat_setCode. Another authorized local signer executes its nested calls. The actual receipt has a different outer sender/target, while the manager sees the holder. This is real local EVM execution, not real MetaMask or EIP-7702 authorization. The Solidity string is a local test fixture, not a production contract/ABI change. Mock-wallet browser contexts, synthetic records and storage stubs remain explicit.

Both sponsored and direct browser runs complete rejected claim -> encrypted corrective appeal -> API registration -> both Oracle results -> allocation -> withdrawal on separate fresh deployments. The sponsored run asserts the different outer addresses. It retains encrypted/versioned evidence and checks two matching version-bound reports. No public transaction, hosted configuration change, Atlas write or live claim4 recovery occurs.

Final observed results: backend335/335, Oracle100/100, selected contract13/13, guarded local migration CLI1/1, direct browser1/1 and sponsored browser1/1. Both local API/Oracle images build and pass network-disabled integrity probes. Sync/package checks pass; the unchanged manager's existing129-byte size warning remains. Readback regressions3/3 passed after the final canonical-identity adjustment. The final test-only changes preserve existing line endings and ensure browser cleanup even if synthetic wallet restoration fails; syntax checks passed after them.

The first browser run timed out before the appeal: the Admin display stayed at its initial status while captured API replies advanced through ORACLE_PENDING to ORACLE_FAILED. It ran alongside heavy regressions. The original trace is preserved; a fresh sponsored run alone passed without changing assertions/timeouts. A new application root cause was not established. Initial harness/version mismatches and a worker-health scoping regression were corrected and retested; do not hide those first failures.

An attempted network-disabled image build could not install dependencies. Normal registry-access builds then passed, followed by network-disabled integrity probes. This was a build-environment restriction, not a relaxed application check. Newly created local image tags are block-insure-appeal-v5-api:local and block-insure-appeal-v5-oracle:local. Test processes are stopped; the task-owned Mongo27049 container is stopped and retained. Existing databases, manifests, credentials and unrelated containers remain intact.

## Publication and Base activation — not performed

1. Publish this reviewed batch together with the pending transaction/evidence batch. Include both new JSON artifacts; .gitignore now allows them.
2. Let Render deploy the API and both workers. Confirm the reviewed revision, worker release oracle-appeal-proof-v2, exact v5/runtime identities from the summary, readiness and suitable lag. No new frontend variable, RPC, key, provider account or paid service is required.
3. The Base default remains v4 until explicit activation. That is expected; old requests retain their old semantics. Do not demonstrate a new sponsored appeal before activation/readback.
4. Refresh this read-only check after rollout. It already reported current v4 -> candidate v5 with transactionSent=false:

```powershell
$env:DOTENV_CONFIG_PATH = (Resolve-Path 'deploy/base-sepolia.runtime.env').Path
$env:DOTENV_CONFIG_QUIET = 'true'
node -r ./backEnd/node_modules/dotenv/config scripts/migrateProtocolModel.js --manifest verification-results/base-sepolia-deployment-2026-11-01/baseSepolia-84532.json
```

5. Only after separate public-transaction authorization, use the existing CLI's --apply and --expect with the freshly observed current identity. This calls updateOracleModelVersion on the existing manager, not a deployment. Save its receipt separately and verify the default/new request identity. The task does not execute this step. Previous v4 default: 0xe722db3519fc3f2667c5ba1b8a18854b8a59357a925d37ecf38d5903ad9b6595; refresh before relying on it.
6. The CLI's existing --rollback means NB, not v4. Do not misuse it as v4 rollback. Preserve the original deployment manifest. Record activation separately; readback intentionally rejects a manifest whose recorded default differs from the current one. Any current-state manifest copy must reference the original and activation receipt, never replace old deployment evidence.
7. Verify a new hosted sponsored appeal under v5, then the separately authorized original claim4 recovery/owner decryption. No full contract redeployment or repeated L1 campaign is needed. Historical paper receipts retain their v4 source identity; do not relabel them v5 measurements.

## Reviewed staging scope

Suggestions only, alongside the exact pending transaction/evidence staging list in docs/transaction-evidence-stabilization.md. The agent has not run Git add/commit/push.

```powershell
git add -- .gitignore README.md oracle/index.js oracle/runtimeProtocol.js oracle/appealValidation.js oracle/test/sponsoredAppeal.test.js oracle/test/evaluatorCompatibility.test.js oracle/test/runtimeCompatibility.test.js oracle/test/protocolAssessment.test.js
git add -- backEnd/artifacts/xgboost-protocol-v5.json backEnd/artifacts/oracle-runtime-compatibility-v2.json backEnd/services/oracleDecisionService.js backEnd/test/protocolMigration.test.js backEnd/test/protocolMigrationCLI.integration.js
git add -- scripts/devAll.js scripts/deploymentReadback.js scripts/migrateProtocolModel.js scripts/packageProtocolModel.js deploy/backend.Dockerfile deploy/oracle.Dockerfile
git add -- e2e/support/walletBridge.js e2e/support/sponsoredWallet.js e2e/tests/unfinished-claim-finality.workflow.spec.js docs/sponsored-appeal-compatibility.md docs/oracle-backlog-recovery.md docs/transaction-evidence-stabilization.md
```

Suggested combined commit: Reconcile sponsored transactions and version Oracle appeal proofs

Independent review prompt: Review v4/v5 dispatch, trusted receipt/version binding, preserved frozen hashes/pinned decisions, migration safety and complete deployment packaging. Check the actual local sponsored receipt and both-worker results. No edits, publication or new features. Return findings before publication/activation.
