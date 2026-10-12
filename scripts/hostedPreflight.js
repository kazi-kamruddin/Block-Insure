const REQUIRED_URLS = {
  frontend: process.env.HOSTED_FRONTEND_URL,
  backend: process.env.HOSTED_BACKEND_URL,
  oracleOne: process.env.HOSTED_ORACLE_ONE_URL,
  oracleTwo: process.env.HOSTED_ORACLE_TWO_URL,
};

const normalizeUrl = (label, value) => {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${label} must be a valid URL`);
  }
  if (url.protocol !== "https:") throw new Error(`${label} must use HTTPS`);
  if (["localhost", "127.0.0.1", "::1"].includes(url.hostname)) {
    throw new Error(`${label} must not use a loopback host`);
  }
  return url.origin;
};

const fetchWithWakeRetry = async (url, { expectJson = false } = {}) => {
  const deadline = Date.now() + 120_000;
  let lastFailure = "no response";
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
      const body = expectJson ? await response.json() : await response.text();
      if (response.ok) return { body, status: response.status };
      lastFailure = `HTTP ${response.status}`;
    } catch (error) {
      lastFailure = error.name === "TimeoutError" ? "request timed out" : error.message;
    }
    await new Promise((resolve) => setTimeout(resolve, 5_000));
  }
  throw new Error(`${url} did not wake within 120 seconds (${lastFailure})`);
};

const main = async () => {
  const urls = Object.fromEntries(
    Object.entries(REQUIRED_URLS).map(([label, value]) => [
      label,
      normalizeUrl(label, value),
    ])
  );
  const [frontend, backend, oracleOne, oracleTwo] = await Promise.all([
    fetchWithWakeRetry(urls.frontend),
    fetchWithWakeRetry(`${urls.backend}/health/ready`, { expectJson: true }),
    fetchWithWakeRetry(`${urls.oracleOne}/health/live`, { expectJson: true }),
    fetchWithWakeRetry(`${urls.oracleTwo}/health/live`, { expectJson: true }),
  ]);

  if (!/Block-Insure/i.test(frontend.body)) {
    throw new Error("Hosted frontend did not return the Block-Insure application");
  }
  if (!backend.body?.success || !["ready", "limited"].includes(backend.body.status)) {
    throw new Error("Hosted backend is neither fully ready nor in explicit limited preview mode");
  }
  for (const [label, response] of [["Oracle 1", oracleOne], ["Oracle 2", oracleTwo]]) {
    if (!response.body?.success || !response.body?.oracleInstanceId) {
      throw new Error(`${label} liveness response is invalid`);
    }
  }

  console.log(JSON.stringify({
    status: "PASS",
    frontend: { status: frontend.status },
    backend: {
      status: backend.status,
      mode: backend.body.status,
      blockchain: backend.body.services?.blockchainRpc || "unknown",
    },
    oracleOne: {
      status: oracleOne.status,
      workerEnabled: oracleOne.body.workerEnabled,
      workerReady: oracleOne.body.status === "ready",
    },
    oracleTwo: {
      status: oracleTwo.status,
      workerEnabled: oracleTwo.body.workerEnabled,
      workerReady: oracleTwo.body.status === "ready",
    },
  }, null, 2));
};

main().catch((error) => {
  console.error(`[Hosted preflight] ${error.message}`);
  process.exitCode = 1;
});
