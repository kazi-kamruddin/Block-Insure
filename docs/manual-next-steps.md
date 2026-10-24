# Manual next steps: local application, Brevo and hosted preview

Prepared **24 October 2026** against commit `8a7b19a`, plus this handoff tooling.
Start here instead of combining commands from older startup notes.

The shadow integration already has a dated regression record. This handoff adds
read-only preparation checks; it does not repeat that campaign or activate a
hosted blockchain. No paid service is needed to use the existing local stack.

## 1. First five minutes

Open PowerShell in the repository root:

```powershell
cd 'E:\4-1\4100 thesis\project\Block-Insure'
npm run preflight:manual
```

This is offline: it reads configuration and checks installed dependencies,
without printing secret values, contacting providers or starting processes.
`PRESENT` means a file/dependency exists; `CONFIGURED` means values are present,
not that authentication or delivery succeeded. `ACTION` tells you what remains.
The command reports pending manual work rather than treating it as a test failure.

Current inspected starting point:

| Component | Inspected state | Your next action |
| --- | --- | --- |
| Node | 24.16.0 installed | Keep Node 24 for whole-project local work |
| App dependencies and research environment | Already installed | No reinstall, Python environment creation or model training needed |
| Saved backend database target | Atlas/SRV | Preserve it; select a different local target explicitly for resets |
| Local chain/application | Stopped after tests | Follow section 2; saved addresses cannot restore a lost chain |
| Existing test MongoDB container | Restored to stopped state after tests | Start it only if choosing the local disposable demo below |
| Brevo key/sender | Absent from saved backend configuration | Complete section 3 privately |
| OTP signing | Dedicated local key absent; existing JWT fallback is supported | Keep current signing secret stable; do not rotate it as a setup step |
| Hosted services | Existing off-chain preview; not inspected in this pass | Optional coordinated code redeploy in section 5 |

## 2. Bring up the application without mixing data targets

Use **two terminals**, with an optional third for readiness checks. Keep the chain
terminal running when stopping/restarting application services. Docker Desktop
alone does not start a MongoDB container. Logging into Atlas alone does not prove
that your application can connect.

### A. Existing valid chain and data: daily resume

If the chain is still running with the deployment you want to keep, preserve its
database selection and use:

```powershell
npm run dev
```

This reuses the deployment and starts API, frontend and both workers. An empty
node after a chain restart is **not** a valid deployment. If startup reports a
missing deployment, follow the fresh local option below rather than repeatedly
running reset commands against the saved Atlas target.

### B. Chain was lost: deliberate fresh, disposable local demo

This is the appropriate branch after the test teardown if you need a new manual
demo now. It does **not** restore earlier chain transactions or earlier claims.

Terminal 1:

```powershell
cd 'E:\4-1\4100 thesis\project\Block-Insure'
npm run dev:chain
```

Terminal 2: start the **existing** MongoDB container. These commands do not create
one. If the container is missing or Docker is unavailable, stop and resolve that
prerequisite rather than substituting Atlas for the reset target.

```powershell
cd 'E:\4-1\4100 thesis\project\Block-Insure'
docker start block-insure-part1-mongo
docker inspect --format '{{.State.Status}}' block-insure-part1-mongo
```

Expected container status: `running`. Set an explicit local, disposable database
for this terminal. This intentionally uses a different database from the
automated campaign's `block_insure_e2e`:

```powershell
$env:MONGODB_URI='mongodb://127.0.0.1:27019/block_insure_manual_dev'
$env:RPC_URL='http://127.0.0.1:8545'
$env:CHAIN_ID='31337'
$env:BLOCKCHAIN_RUNTIME_ENABLED='true'
$env:ORACLE_WORKER_ENABLED='true'
$env:INDEXER_ENABLED='true'
$env:INDEXER_CONFIRMATIONS='0'
$env:FORCE_PUBLIC_DNS='false'
npm run preflight:manual
```

Confirm the report says **loopback**, then choose the explicit reset below.
**This resets `block_insure_manual_dev`, deploys/seeds a new local baseline and
updates local generated addresses/ABI compatibility files.** It is not an Atlas
reset and does not change the saved backend MongoDB URI.

```powershell
npm run dev:hybrid
```

Keep both terminals open. If this fails, inspect the failing layer; do not run
additional standalone deployment/funding commands blindly. The setup already
performs account funding, deployment, role grants, reserve funding and Merkle
publication. The [README command inventory](../README.md) lists subsystem commands
when a specific setup stage needs diagnosis.

In Terminal 3:

```powershell
cd 'E:\4-1\4100 thesis\project\Block-Insure'
npm run preflight:manual -- --local
```

Expected runtime rows: API/database, both Oracles, frontend and chain/deployment
are `READY`. The helper uses only bounded loopback probes; no email is sent.
It checks that code exists at the manifest manager address. The actual launcher
also verifies the deployed protocol model identity. It does not prove all
contracts, roles, reserves or business workflows are correct by itself.

Open [the local application](http://localhost:5173). Use MetaMask's local network:

| Field | Value |
| --- | --- |
| RPC URL | `http://127.0.0.1:8545` |
| Chain ID | `31337` |
| Currency | `ETH` |
| Explorer | Leave blank |

Use separate browser profiles for User, Admin, Bank, Hospital and Auditors. Use
only the configured local demo identities; compare their public addresses and
roles with the current setup. Do not copy the historical September runbook's
address table as though it represented today's deployment. The existing
`npm run preflight:metamask` can inspect its configured E2E/manual identities
after startup; missing actor configuration means configure those identities,
not import an unrelated historical account. Never use Oracle wallets as browser
identities or paste private keys into the application.

To restart after changing backend configuration: `Ctrl+C` in Terminal 2, then
`npm run dev` **in that same terminal**, retaining the local overrides. Do not
rerun `dev:hybrid` for a normal restart. A new terminal needs the same override
block again; otherwise the saved Atlas selection takes effect. After rebuilding
a chain, reset MetaMask activity/nonce data only when stale transactions require
it; preserve application site data and evidence identities.

## 3. Configure Brevo privately

Your account actions are the remaining prerequisite. You may reuse an existing
Brevo account if its transactional sending is available; create a project-specific
key rather than changing another application's working key.

1. Sign in to Brevo and complete any required account/sending approval.
2. Register and verify a sender you control, with any required domain setup.
3. Under **Settings → SMTP & API → API Keys & MCP**, generate a normal API key
   for Block-Insure. This integration uses HTTP, not an SMTP password or an MCP
   key. Save it privately when displayed.
4. In the existing, ignored `backEnd/.env`, add/update only:

```dotenv
OTP_DELIVERY_MODE=brevo
BREVO_API_KEY=<paste the API key privately here>
BREVO_SENDER_EMAIL=<the registered sending address>
```

Never paste credentials into this Markdown file, Git, chat, screenshots or
frontend `VITE_` variables. Retain existing JWT/OTP keys and other settings.
Check that `backEnd/.env` is ignored:

```powershell
git check-ignore backEnd/.env
npm run preflight:manual
```

If you previously set `OTP_DELIVERY_MODE` or Brevo values directly in the launch
terminal, those take precedence over `.env`; remove the stale override privately
or use a fresh terminal with the local database override block. Restart the
backend through the application launcher. Oracles need no email configuration.

Official references, checked 24 October 2026:
[API-key setup](https://help.brevo.com/hc/en-us/articles/209467485-Create-and-manage-your-API-keys),
[sender registration](https://developers.brevo.com/docs/sender-creation-and-management),
[transactional API](https://developers.brevo.com/docs/send-a-transactional-email).
The existing adapter uses `POST /v3/smtp/email`. No webhook, template or new npm
dependency is required for this OTP walkthrough. Stay within the account's
available allowance; this guide requires no paid upgrade.

## 4. Prove the actual mailbox flow

Use your own test recipient mailbox and synthetic insurance data.

1. Connect the policyholder wallet; open **My profile** (`/user/profile`). Save
   your recipient email. This may differ from the Brevo sender address.
2. Click **Request email verification code**. Check inbox and spam; the screen
   should describe email acceptance without displaying/prefilling a real code.
3. Enter the received six-digit code and confirm. Expect **Email verified**.
   This proves mailbox access, not KYC/legal identity.
4. Wait at least one minute after the last email request. In **Banking**
   (`/user/banking`), select your active policy and its eligible linked demo bank
   account, then click **Make a manual bank payment**. If none is available,
   complete those existing UI prerequisites first; email setup does not create
   a policy or bank account.
5. Enter the payment code from the new email. Confirm, wait for the blockchain
   transaction and inspect transfer history, paid installments and the premium
   ledger. Brevo acceptance alone cannot mark a premium paid.
6. On a separate challenge, enter one incorrect code and then the correct code.
   An incorrect code must not create payment. A consumed or five-minute-expired
   code must not pay again. Do not exhaust all three attempts before trying the
   correct code on that challenge.

Shared application limits are at least one minute between sends and ten per
wallet/inbox per 24-hour window, 100 across the application. Provider failures
also consume application quota. Avoid repeated clicks while investigating.

| Symptom | Next check |
| --- | --- |
| Simulated inbox appears | Backend still uses simulation; check `.env` versus terminal overrides and restart |
| 503 / delivery unavailable | Private API-key/sender configuration, sender approval and Brevo sending status/logs; never post provider credentials |
| Email accepted but no inbox message | Spam folder, recipient spelling and Brevo transactional logs; acceptance is not delivery proof |
| 429 | Wait for the applicable resend/daily window; do not bypass limits |
| Profile verification disappears | Changing saved email invalidates its verification |
| Payment unavailable despite verified email | Check active policy, account ownership/balance and chain/service readiness |

For an offline local demo, deliberately set `OTP_DELIVERY_MODE=simulation` and
restart the backend. Production disallows simulation. In Brevo mode, delivery
failure does not fall back to an exposed on-screen code. Automated campaigns
explicitly select simulation so they do not send your real email.

## 5. Optional: update the existing hosted preview

Use the existing Vercel project and three Render services; do not create another
Blueprint or add a subscription. Follow the
[coordinated deployment handoff](shadow-deployment-handoff.md). Review/commit/push
the intended revision and deploy API, both Oracles and frontend from it.

Preserve the hosted preview settings: backend `BLOCKCHAIN_RUNTIME_ENABLED=false`,
`INDEXER_ENABLED=false`; both workers `ORACLE_WORKER_ENABLED=false`. The shadow
flag does not activate a dormant worker. The hosted preview cannot complete
local-chain wallet/payment workflows.

Brevo variables, if configuring hosted email, belong **only** in the Render API
service's private Environment settings. Vercel needs no Brevo key. Local `.env`
changes never automatically configure Render.

After your deployment finishes, run the existing read-only check:

```powershell
$env:HOSTED_FRONTEND_URL='https://block-insure.vercel.app'
$env:HOSTED_BACKEND_URL='https://block-insure-api.onrender.com'
$env:HOSTED_ORACLE_ONE_URL='https://block-insure-oracle-one.onrender.com'
$env:HOSTED_ORACLE_TWO_URL='https://block-insure-oracle-two.onrender.com'
npm run preflight:hosted
```

Expected preview: API `limited`, database connected, blockchain disabled; both
worker flags false. A passing health check does not identify the deployed Git
revision or prove transactions. Compare revision IDs in both hosting dashboards.

## 6. What to bring back

Share the readiness statuses, the step that succeeded/failed, HTTP status and
redacted screenshots if needed. For real email, record whether profile and
payment messages reached the inbox and whether payment completed. Do not share
codes, private keys, recipient addresses, API keys or full environment files.

The previous application assurance remains tied to its original source/evidence
snapshot. New handoff tooling has its own focused checks. A changed README or
package script can make the old content snapshot intentionally stale; do not
rewrite historical test results to call the new files fully regression-tested.
Prepare a new reviewed release snapshot when freezing the next release.
