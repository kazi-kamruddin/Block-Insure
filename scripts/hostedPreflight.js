const normalizeUrl = (label, value) => {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${label} must be a valid URL`);
  }
  if (url.protocol !== "https:") throw new Error(`${label} must use HTTPS`);
  if (url.username || url.password) throw new Error(`${label} must not include credentials`);
  if (["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) {
    throw new Error(`${label} must not use a loopback host`);
  }
  if (url.search || url.hash) throw new Error(`${label} must not include query or fragment`);
  return (url.origin + url.pathname).replace(/\/+$/, "");
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

const validateResponses = ({ frontend, backend, oracleOne, oracleTwo, frontendConfiguration }, { full = false, chainId, modelIdentity, oracleWallets, components, backendOrigin, frontendOrigin } = {}) => {
  if (!/Block-Insure/i.test(frontend.body)) {
    throw new Error("Hosted frontend did not return the Block-Insure application");
  }
  if (!backend.body?.success || !["ready", "limited"].includes(backend.body.status)) {
    throw new Error("Hosted backend is neither fully ready nor in explicit limited preview mode");
  }
  for (const [label, response, expectedId] of [["Oracle 1", oracleOne, "1"], ["Oracle 2", oracleTwo, "2"]]) {
    if (!response.body?.success || String(response.body.oracleInstanceId) !== expectedId ||
      typeof response.body.workerEnabled !== "boolean") {
      throw new Error(`${label} liveness response is invalid`);
    }
    if (response.body.workerEnabled && response.body.status !== "ready") {
      throw new Error(`${label} is enabled but is not ready`);
    }
  }
  if (full) {
    const sameAddress = (actual, expected) => typeof actual === "string" && typeof expected === "string" && /^0x[a-f\d]{40}$/i.test(actual) && actual.toLowerCase() === expected.toLowerCase();
    if (!modelIdentity || !Array.isArray(oracleWallets) || oracleWallets.length < 2 ||
      backend.body.status !== "ready" || backend.body.services?.database !== "connected" ||
      backend.body.services?.blockchainRpc !== "connected" || backend.body.services?.contract !== "deployed" ||
      String(backend.body.services?.chainId) !== String(chainId)) throw new Error("Full release requires a connected backend on the selected deployment");
    if (!components || !sameAddress(backend.body.deployment?.managerAddress, components.InsuranceManager)) throw new Error("Backend deployment address differs from selected manifest");
    const configured = frontendConfiguration?.body;
    if (configured?.schema !== "block-insure-public-release-v1" || String(configured.chainId) !== String(chainId) ||
      !sameAddress(configured.managerAddress, components.InsuranceManager) || !sameAddress(configured.economicsAddress, components.PolicyEconomics) ||
      !sameAddress(configured.evidenceRegistryAddress, components.EvidenceRegistry) || !sameAddress(configured.benefitsAddress, components.PolicyBenefitsManager) ||
      (configured.apiOrigin === "same-origin" ? frontendOrigin !== backendOrigin : configured.apiOrigin !== backendOrigin)) throw new Error("Frontend build configuration differs from selected deployment");
    const workers = [oracleOne.body, oracleTwo.body];
    for (const [index, worker] of workers.entries()) {
      if (!worker.workerEnabled || worker.status !== "ready" || worker.protocolModel?.identity !== modelIdentity ||
        String(worker.deployment?.chainId) !== String(chainId) || !sameAddress(worker.deployment?.managerAddress, components.InsuranceManager) ||
        !sameAddress(worker.deployment?.coordinatorAddress, components.OracleCoordinator) ||
        worker.registrySnapshot !== (index === 0 ? "primary" : "oracle2") ||
        !oracleWallets.some((wallet) => wallet.toLowerCase() === String(worker.oracleWallet).toLowerCase())) throw new Error(`Oracle ${index + 1} is not ready for the selected release`);
    }
    if (String(workers[0].oracleWallet).toLowerCase() === String(workers[1].oracleWallet).toLowerCase()) throw new Error("Full release requires distinct Oracle wallets");
  }
};

const main = async () => {
  const args = require("./operatorArguments").parseOperatorArguments(process.argv.slice(2), { values: ["--manifest"], switches: ["--full"] });
  if (args["--full"] && !args["--manifest"]) throw new Error("Full verification requires --manifest and matching RPC_URL");
  let deployment;
  if (args["--full"]) {
    const fs = require("node:fs");
    const { ethers } = require("../backEnd/node_modules/ethers");
    if (!process.env.RPC_URL || new URL(process.env.RPC_URL).protocol !== "https:") throw new Error("Full hosted verification requires an explicit HTTPS RPC");
    const transport = new ethers.FetchRequest(process.env.RPC_URL); transport.timeout = 10000;
    const provider = new ethers.JsonRpcProvider(transport);
    try { deployment = await require("./deploymentReadback").verifyDeployment({ manifest: JSON.parse(fs.readFileSync(args["--manifest"])), provider }); }
    finally { provider.destroy(); }
  }
  const requiredUrls = {
    frontend: process.env.HOSTED_FRONTEND_URL,
    backend: process.env.HOSTED_BACKEND_URL,
    oracleOne: process.env.HOSTED_ORACLE_ONE_URL,
    oracleTwo: process.env.HOSTED_ORACLE_TWO_URL,
  };
  const urls = Object.fromEntries(
    Object.entries(requiredUrls).map(([label, value]) => [label, normalizeUrl(label, value)])
  );
  const [frontend, backend, oracleOne, oracleTwo, frontendConfiguration] = await Promise.all([
    fetchWithWakeRetry(urls.frontend),
    fetchWithWakeRetry(`${urls.backend}/health/ready`, { expectJson: true }),
    fetchWithWakeRetry(`${urls.oracleOne}/health/${deployment ? "ready" : "live"}`, { expectJson: true }),
    fetchWithWakeRetry(`${urls.oracleTwo}/health/${deployment ? "ready" : "live"}`, { expectJson: true }),
    deployment ? fetchWithWakeRetry(`${urls.frontend}/release-config.json`, { expectJson: true }) : null,
  ]);
  validateResponses({ frontend, backend, oracleOne, oracleTwo, frontendConfiguration }, deployment ? { full: true, chainId: deployment.chainId, modelIdentity: deployment.modelIdentityHash, oracleWallets: deployment.oracleWallets, components: deployment.components,
    frontendOrigin: new URL(urls.frontend).origin, backendOrigin: new URL(urls.backend).origin } : {});

  console.log(JSON.stringify({
    status: "PASS",
    scope: deployment ? "FULL_RUNTIME_READINESS" : "PREVIEW_READINESS",
    workflowAcceptance: "Separate end-to-end and actual-user acceptance are still required",
    deployment: deployment || null,
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

if (require.main === module) {
  main().catch((error) => {
    console.error("[Hosted preflight] Failed: check explicit HTTPS origins, selected deployment, RPC and worker readiness privately.");
    process.exitCode = 1;
  });
}

module.exports = { normalizeUrl, validateResponses };
