# Section 2: Oracle, Security, and Fraud Model Improvements

This section strengthens the prototype's oracle availability, API-session security,
claim-submission controls, and fraud-model evaluation. It also makes the remaining
prototype trust boundaries explicit.

## Oracle 2 Network-Delay Simulation

Oracle 2 uses `ORACLE2_SIMULATED_NETWORK_DELAY_MS` before submitting its answer.
The delay simulates realistic network propagation variance between geographically
distributed oracle nodes. It is not a retry delay, fraud signal, or artificial
processing delay, and Oracle 1 does not apply it.

The default Oracle 2 example configuration uses:

```env
ORACLE2_SIMULATED_NETWORK_DELAY_MS=3000
ORACLE_REGISTRY_SNAPSHOT=oracle2
```

## Independent Oracle Registry Simulation

The backend exposes two synthetic registry snapshots:

- `primary`: the default registry used by Oracle 1.
- `oracle2`: a separately seeded MongoDB collection used by Oracle 2.

The Oracle 2 seed intentionally differs on one invoice so the two oracle nodes can
produce independent results. Registry, summary, Merkle-root, Merkle-proof, and
verification responses identify the snapshot they served.

This is a simulation boundary, not full decentralization. Both oracle processes
still call the same backend deployment and MongoDB server. In production, each
oracle should query an independently operated hospital registry, national health
database node, or other authoritative data provider. Its own authenticated data
source and infrastructure should determine its result.

Because the simulated snapshots may differ, Oracle 2's Merkle root can differ from
the primary root stored on-chain. The oracle logs that mismatch for auditability.

## Oracle Timeout Resolution

Each oracle request stores the block at which it was created. The contract's
`oracleTimeoutBlocks` value defaults to `50` and can be updated by an administrator.

After the timeout passes, an administrator can call `resolveTimedOutOracle(claimId)`.
The contract marks the request fulfilled with a failed result, changes the claim to
`ORACLE_FAILED`, and emits `OracleTimedOut`. This prevents a claim from remaining
permanently stuck when the oracle quorum is unavailable. Late oracle submissions
are rejected after timeout resolution.

The admin claim-detail page exposes this operation through the backend route:

```text
POST /api/admin/claims/:id/resolve-oracle-timeout
```

## JWT Revocation

Every issued JWT includes a unique `jti`. Authenticated logout stores that `jti` in
the `RevokedToken` collection until the token's original expiration time. The
authentication middleware checks the revocation collection before accepting a
token, and MongoDB's TTL index removes expired revocations automatically.

Logout is available at:

```text
POST /api/auth/logout
```

The frontend clears its local session even if the revocation request fails, so a
backend outage cannot trap the user in the UI. A failed revocation request means
the unexpired token may still be valid and should be treated as a security event.

## Claim-Submission Rate Limits

The official claim-submission flow performs an authenticated preflight request
before uploading evidence or opening the wallet transaction:

```text
POST /api/claims/submission-check
```

Two limits apply:

- An `express-rate-limit` IP/API limit, defaulting to 5 attempts per 15 minutes.
- A MongoDB-backed wallet limit, defaulting to 3 attempts in a rolling 24 hours.

The values can be configured with:

```env
CLAIM_SUBMISSION_RATE_WINDOW_MS=900000
CLAIM_SUBMISSION_RATE_LIMIT=5
CLAIMS_PER_WALLET_24H=3
```

An attempt is counted when the preflight succeeds, even if the later upload or
wallet transaction fails. This conservative behavior limits transaction-spam
preparation. The blockchain remains permissionless, so a user can bypass the
backend and call the contract directly. The on-chain per-policy maximum claim count
is therefore the final enforcement backstop.

## Trained Fraud-Model Parameters

The runtime Bayesian scorer loads likelihoods from `backEnd/model-params.json`
instead of using hardcoded likelihood values. Generate the artifact from the
current primary synthetic registry with:

```powershell
cd backEnd
npm run train:model
```

Training calculates every evidence-factor likelihood from MongoDB records using
Laplace `+1` smoothing. The generated artifact records the training timestamp,
source, class distribution, prior fraud probability, and factor likelihoods.
Runtime scoring fails loudly if a required trained factor is missing.

The fraud label is used only as the training target. It is not exposed to the model
as an evidence feature, avoiding direct target leakage.

## Held-Out Evaluation

Run the evaluation after seeding the registry:

```powershell
cd backEnd
npm run evaluate:risk
```

The evaluator applies a deterministic 80/20 split after stable record sorting:
four of every five records train the model, and the remaining record is held out.
Model parameters and anomaly statistics come only from the training set. Accuracy,
precision, recall, F1, AUC, confusion-matrix values, and scored-record details are
calculated only from the held-out 20 percent.

The evaluation prediction uses the posterior fraud score with a fixed threshold of
`50`. It does not use the record's fraud label or rule-based blocking decision as
an input.
