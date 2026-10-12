# Free-tier staging deployment

This guide prepares a **research/demo staging environment** with no paid
runtime. It is not a mainnet or real-data deployment.

## Topology and boundaries

| Component | Free host | Initial state |
| --- | --- | --- |
| React SPA | Vercel Hobby | Fully hosted |
| Express API | Render free web service | Off-chain preview |
| Oracle 1 | Render free web service | Hosted but worker disabled |
| Oracle 2 | Render free web service | Hosted but worker disabled |
| MongoDB | Atlas Free | Persistent synthetic staging database |
| Evidence | Existing Pinata allowance | Encrypted synthetic files only |
| Blockchain | Sepolia later | Required for full hosted workflows |

The hosted environment never connects to a Hardhat node on a developer PC.
Local deterministic testing remains independent and continues to use
`npm run dev:hybrid`.

## Safety rules

- Use a distinct Atlas database whose name ends in `_dev` or `_test`, for
  example `block_insure_staging_dev`.
- Store only synthetic identities, policies, claims, records, and evidence.
- Never put a private key, MongoDB password, Pinata token, JWT secret, or Oracle
  API key in Git or a Vercel `VITE_*` variable.
- Create fresh staging wallets before enabling Sepolia. Never reuse a mainnet
  wallet or a wallet containing real assets.
- Render and Vercel values belong in their encrypted dashboards. The tracked
  example files contain names only.

## 1. Prepare Atlas

Create or reuse the Atlas Free cluster and create a separate database user with
access only to `block_insure_staging_dev`. Render free services do not provide a
stable outbound IP, so Atlas may require a broad network entry. If `0.0.0.0/0`
is necessary, compensate with a unique high-entropy database password and
least-privilege database user. Do not reuse the cluster administrator.

Copy the connection string into a password manager. Do not put it in any local
tracked file.

## 2. Create the Vercel frontend

1. In Vercel, select **Add New > Project** and import this Git repository.
2. Set **Root Directory** to `frontEnd`.
3. Confirm **Framework Preset** is Vite.
4. Use build command `npm run build` and output directory `dist`.
5. Deploy once without blockchain variables to obtain the final `vercel.app`
   URL. The SPA fallback is already defined in `frontEnd/vercel.json`.
6. Record the exact HTTPS origin without a trailing slash.

The first frontend deployment can render the public shell even before the API
URL is final. After Render is created, set `VITE_API_BASE_URL` to the exact
backend `https://...onrender.com` URL and redeploy. Variable names for the later
Sepolia phase are listed in `deploy/vercel.env.example`.

## 3. Create the three Render services

Use the same Render account as the other thesis projects. Before creating the
Blueprint, open **Billing > Monthly Included Usage**: the 750 free instance
hours are shared by every free web service in that workspace. This design stays
within the allowance by letting all Block-Insure services sleep and waking them
only for genuine work; do not keep existing projects or these services awake
with permanent pingers.

1. In Render, select **New > Blueprint** and connect the same repository.
2. Render reads the root `render.yaml` and proposes:
   - `block-insure-api`
   - `block-insure-oracle-one`
   - `block-insure-oracle-two`
3. Keep every service on the **Free** plan.
4. Enter the following backend values when prompted:

| Variable | Initial value |
| --- | --- |
| `BLOCKCHAIN_RUNTIME_ENABLED` | `false` |
| `INDEXER_ENABLED` | `false` |
| `MONGODB_URI` | Atlas URI for `block_insure_staging_dev` |
| `ALLOWED_ORIGINS` | Exact Vercel HTTPS origin |
| `SIWE_URI` | Exact Vercel HTTPS origin |
| `SIWE_DOMAIN` | Vercel hostname only, without `https://` |
| `PINATA_JWT` | Deployment-specific Pinata JWT |
| `PRE_PROXY_SIGNING_KEYS_JSON` | Locally generated Recrypt proxy signing JSON |

Generate the proxy key JSON locally with:

```powershell
npm --prefix backEnd run keys:pre:generate
```

Move the result directly into the Render secret field and do not save it in
documentation, screenshots, or Git.

5. For both Oracle services, enter `ORACLE_WORKER_ENABLED=false` initially.
   Their `/health/live` endpoints will operate, but they will not attempt chain
   access.
6. The Blueprint creates one shared random `ORACLE_API_KEY` environment group
   used by the backend and both Oracles. Do not replace it independently on one
   service.

The backend health URLs are:

```text
https://<api-host>/health/live
https://<api-host>/health/ready
```

In off-chain preview mode, `/health/ready` returns HTTP 200 with status
`limited`; it explicitly reports the blockchain and contract as disabled.

Each Oracle exposes:

```text
https://<oracle-host>/health/live
https://<oracle-host>/health/ready
```

`/health/live` proves the sleeping web service can start. `/health/ready`
remains 503 until its chain worker is enabled and initialized.

After all four URLs exist, run the sanitized wake/readiness check locally:

```powershell
$env:HOSTED_FRONTEND_URL = "https://<frontend>.vercel.app"
$env:HOSTED_BACKEND_URL = "https://<api>.onrender.com"
$env:HOSTED_ORACLE_ONE_URL = "https://<oracle-one>.onrender.com"
$env:HOSTED_ORACLE_TWO_URL = "https://<oracle-two>.onrender.com"
npm run preflight:hosted
```

It waits up to two minutes for free-tier cold starts and prints status only; it
does not read or output deployment secrets.

## 4. Finish the frontend connection

In Vercel, set:

```text
VITE_API_BASE_URL=https://<actual-api-host>.onrender.com
```

Redeploy the frontend, open the public catalog, and confirm the browser network
panel sends API requests to Render without CORS failures. Direct navigation to
React routes should return the SPA rather than a Vercel 404.

## 5. Free-tier wake behavior

Render free web services sleep after inactivity. Wake the backend first, then
both Oracle `/health/live` URLs. Cold starts can take about a minute. Do not run
a permanent external uptime ping: the three services share the workspace's
free instance-hour allowance.

During a genuine test session, a temporary request every 10 minutes is enough
to keep each service active. Stop it after the session. The Oracle endpoints do
not expose secrets and do not accept adjudication commands; waking a worker only
allows it to resume its authenticated blockchain scan.

## 6. Enable Sepolia later

Do not enable the workers until the contracts, roles, registry root, RPC, and
staging wallets are ready. Use `deploy/render-chain.env.example` as the variable
checklist. Then:

1. Add the backend chain addresses, RPC, deployment blocks, and signing roles.
2. Set backend `BLOCKCHAIN_RUNTIME_ENABLED=true` and `INDEXER_ENABLED=true`.
3. Add the same RPC and manager address to both Oracle services.
4. Set each Oracle's own private key (`ORACLE_PRIVATE_KEY` for Oracle 1 and
   `ORACLE_PRIVATE_KEY_2` for Oracle 2).
5. Set both Oracle `BACKEND_API_URL` and `MOCK_HOSPITAL_API_URL` to the public
   Render backend URL.
6. Set `ORACLE_START_BLOCK` to the coordinator deployment block.
7. Set `ORACLE_WORKER_ENABLED=true` on both services and redeploy.
8. Add the matching public chain values from `deploy/vercel.env.example` to
   Vercel and rebuild the frontend.

With `ORACLE_CURSOR_MODE=backend`, each worker stores its deployment-bound,
wallet-signed scan cursor through the authenticated API in Atlas. Render sleep
or filesystem replacement therefore does not discard event progress. On-chain
fulfilled/revealed checks make overlapping recovery scans idempotent.

## Verification strategy

- Full destructive and deterministic coverage stays local:

  ```powershell
  npm run dev:hybrid
  npm run test:e2e:all
  ```

- Before Sepolia, hosted checks cover SPA routing, HTTPS, CORS, API/Atlas
  readiness, service sleep/wake, and Oracle liveness.
- After Sepolia, add a small staging Playwright suite using synthetic fixtures
  and tiny testnet amounts. Never run the database-resetting local E2E sequence
  against the shared hosted environment.

## Rollback

Vercel and Render can redeploy an earlier Git revision. Application rollback
does not erase Atlas data. Contract rollback is different: the contracts are
not upgradeable, so a changed protocol requires a new deployment and a
coordinated address update across the backend, both Oracles, and Vercel.
