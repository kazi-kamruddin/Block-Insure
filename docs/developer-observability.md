# Developer Observability Terminal

Use two terminals during browser experiments:

```powershell
npm run dev:all
```

Then start the compact observer in another terminal:

```powershell
npm run dev:observe
```

The observer reports service availability, backend HTTP activity, oracle and
chain events, warnings, failures, retries, timeouts, and process exits. Repeated
messages are collapsed into repeat summaries. Type `clear` and press Enter to
clear the display without stopping observation.

The event stream is written to `.dev-logs/events.jsonl`, which is ignored by
Git. Sensitive values are redacted before they are written: private keys,
secrets, tokens, API keys, bearer credentials, PEM blocks, JWTs, and full
64-hex values are not retained in the observability stream.

For the most complete view, start services through `npm run dev:all`, because
that launcher captures Hardhat and Vite child-process output as well. If the
services are started in separate terminals, backend requests and oracle events
are still captured directly; the observer continues to show port availability
for all three HTTP/RPC services.
