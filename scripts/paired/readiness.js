const { setTimeout: delay } = require("node:timers/promises");

function serviceOrigins(urls, local) {
  return ["api", "oracle1", "oracle2"].map((name) => {
    const url = new URL(urls[name]);
    if (url.username || url.password || url.search || url.hash ||
        (local ? url.protocol !== "http:" || !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) : url.protocol !== "https:")) {
      throw new Error("Invalid readiness origin for " + name);
    }
    return url.href.replace(/\/$/, "");
  });
}

function validateReadiness([api, oracle1, oracle2], deployment, now = Date.now()) {
  const manager = deployment.components.InsuranceManager.toLowerCase();
  const coordinator = deployment.components.OracleCoordinator.toLowerCase();
  const sameManager = (item) => item.deployment?.managerAddress?.toLowerCase() === manager;
  const recent = (value) => now >= Date.parse(value) && now - Date.parse(value) <= 45_000;
  if (api.status !== "ready" || !sameManager(api) || String(api.services?.chainId) !== String(deployment.chainId) ||
      api.services?.database !== "connected" || api.services?.blockchainRpc !== "connected" || !recent(api.timestamp)) return false;
  const workers = [oracle1, oracle2];
  return workers.every((worker, index) => {
    const expected = deployment.oracleWallets[index]?.toLowerCase();
    return worker.status === "ready" && worker.workerEnabled === true && sameManager(worker) &&
      String(worker.deployment?.chainId) === String(deployment.chainId) && worker.deployment?.coordinatorAddress?.toLowerCase() === coordinator &&
      worker.registrySnapshot === (index ? "oracle2" : "primary") && worker.protocolModel?.identity === deployment.modelIdentityHash &&
      worker.oracleWallet?.toLowerCase() === expected && Number.isSafeInteger(worker.scanLagBlocks) &&
      worker.scanLagBlocks >= 0 && worker.scanLagBlocks <= 150 && recent(worker.lastSuccessfulPollAt) && recent(worker.headObservedAt);
  }) && oracle1.oracleWallet.toLowerCase() !== oracle2.oracleWallet.toLowerCase() &&
    Boolean(oracle1.operationalRelease?.runtimeIdentityHash) &&
    oracle1.operationalRelease.runtimeIdentityHash === oracle2.operationalRelease?.runtimeIdentityHash &&
    (!deployment.oracleRuntimeIdentity || oracle1.operationalRelease.runtimeIdentityHash === deployment.oracleRuntimeIdentity);
}

async function waitForReadiness({ urls, deployment, local, timeoutMs = 20 * 60_000, pollMs = 5000 }) {
  const origins = serviceOrigins(urls, local);
  const expected = { ...deployment, oracleRuntimeIdentity: deployment.oracleRuntimeIdentity ??
    require("../../oracle/runtimeProtocol").loadOperationalRelease().runtimeIdentityHash };
  const read = async (origin) => {
    const response = await fetch(origin + "/health/ready", { signal: AbortSignal.timeout(15_000), redirect: "error" });
    return response.ok ? await response.json() : {};
  };
  const expires = Date.now() + timeoutMs;
  do {
    const checks = await Promise.all(origins.map((origin) => read(origin).catch(() => ({}))));
    if (validateReadiness(checks, expected)) return { ready: true, sampledAt: new Date().toISOString() };
    if (Date.now() < expires) await delay(pollMs);
  } while (Date.now() < expires);
  throw new Error("The selected API and both workers did not become ready together");
}

async function main() {
  const fs = require("node:fs");
  const { parseOperatorArguments } = require("../operatorArguments");
  const args = parseOperatorArguments(process.argv.slice(2), { values: ["--readback"], switches: ["--local"], required: ["--readback"] });
  const deployment = JSON.parse(fs.readFileSync(args["--readback"]));
  const urls = { api: process.env.HOSTED_BACKEND_URL, oracle1: process.env.HOSTED_ORACLE_ONE_URL, oracle2: process.env.HOSTED_ORACLE_TWO_URL };
  console.log(JSON.stringify(await waitForReadiness({ urls, deployment, local: args["--local"] })));
}
if (require.main === module) main().catch(() => { console.error("Readiness gate failed for the selected deployment"); process.exitCode = 1; });

module.exports = { serviceOrigins, validateReadiness, waitForReadiness };

