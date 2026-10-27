# Shadow-verification release and deployment handoff

**Historical 24 October stage.** The [27 October protocol migration](xgboost-protocol-migration.md)
supersedes its NB-default rollout description. XGBoost protocol routing is distinct
from the optional post-finality shadow reporter. `ORACLE_SHADOW_ENABLED=false`
does not disable XGBoost routing for requests bound to its protocol identity.
Keep this report's dated tests as historical evidence; do not treat them as
verification of the later migration. Its old release snapshot is preserved.

Reviewed 24 October 2026. This is preparation, not a deployed-release claim.
The API, frontend and both Oracle workers have coordinated source dependencies.
The NB protocol model, Solidity ABIs and authoritative decision rules are unchanged.

## Release order

1. Finish the dated local assurance record, then create a content-frozen candidate
   with `node scripts/prepareReleaseCandidate.js`.
2. Check it using `node scripts/prepareReleaseCandidate.js --check
   verification-results/release-candidate-2026-10-24.json`. The record identifies
   the base commit and source hashes. After committing, record the resulting Git
   revision in the release handoff; a dirty candidate is not a tagged release.
3. Deploy backend and both workers from the same reviewed revision. Deploy the
   frontend panel from that revision too. Build filters and optional Dockerfiles
   include the shared inference/context sources and portable artifact.
4. Preserve the hosted preview flags until a shared chain is explicitly ready.
   This code does not turn on blockchain processing, the indexer or workers.
5. Run the non-destructive hosted health preflight. Once a shared chain is
   deliberately activated, additionally validate roles, addresses, registry root,
   request versions, model identities and worker shadow reports on that chain.

## Service settings

| Service | Runtime / important settings |
| --- | --- |
| Vercel frontend | Node 24 build; existing Vite root/build settings; existing public API/RPC/chain variables |
| Render API | Existing Node 20.19.0 pin; existing MongoDB, origins, SIWE and secrets; no Python dependency |
| Oracle 1 | Existing instance 1/wallet/primary snapshot; shared source bundle; `ORACLE_SHADOW_ENABLED=true` when the worker runs |
| Oracle 2 | Existing instance 2/distinct wallet/oracle2 snapshot; identical bundle/observable sources; same shadow flag |

`ORACLE_SHADOW_ENABLED=false` disables the optional side channel for rollback.
It does not change the current NB commit/reveal protocol. Dormant workers remain
dormant regardless of the shadow setting. The production environment example
documents the flag; no saved secret files are rewritten.

The backend's new shadow endpoints require both the existing Oracle API key and
a fresh, purpose-separated wallet signature from an eligible current Oracle.
The worker uses `BACKEND_API_URL` for them. No new secret or public browser token
is required. Never configure private keys, Oracle API keys or email secrets in
Vercel `VITE_` variables.

## Validation and failure interpretation

- `node scripts/packageXgboostAdvisory.js --check`: shared source/model manifest.
- `npm run release:check:template`: template completeness without live activation.
- `npm run preflight:hosted`: read-only hosted health; not transaction proof.
- Admin claim detail: worker shadow status is `NO_CURRENT_REQUEST`,
  `WAITING_FOR_WORKERS`, `MATCHED`, `CONFLICT` or `UNAVAILABLE`.
- Worker liveness/readiness contains a separate `shadow` status. Shadow failures
  do not make an otherwise functioning NB worker unready.
- A report hashes the request block, chain, coordinator, claim facts/version,
  registry version/root and bundle/source identities. Different revisions must
  not be described as agreement. The backend independently recomputes reports.
- Backfill is deliberately bounded to the latest 64 finalized requests, eight
  pending assessments per pass. It is not a whole-chain archival migration.

Exact model results were not retrained or improved in this release. Matching
workers demonstrate deterministic execution over shared code and committed data;
they do not establish independent medical truth or natural-fraud accuracy.

## Rollback and scope

If only shadow processing fails, keep the ordinary claim workflow available,
inspect configuration privately, and optionally disable the shadow flag while
repairing the matched release. Never fix a mismatch by silently rewriting an
on-chain request identity or changing model hashes in place. Return all affected
services to the same known revision if a source rollback is needed.

Docker templates were aligned to the current runtime requirements and required
shared files. A static dependency-closure check is distinct from a Docker image
build; do not claim the templates were built unless that check was actually run.
The ignore file excludes local research environments, generated data, context,
reference material and temporary reports from build context.
