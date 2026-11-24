const { spawn } = require("node:child_process");
const { randomBytes, randomUUID } = require("node:crypto");
const { once } = require("node:events");
const net = require("node:net");
const path = require("node:path");
const { handoff } = require("./campaignHandoff");

const root = path.resolve(__dirname, "../..");

async function localPort() {
  const server = net.createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address();
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

async function verifyAndStopCampaignRuntime({ deployment, readback, provider, signers, journal, coordinator, mongoUri, directory }) {
  const mongo = new URL(mongoUri);
  if (mongo.protocol !== "mongodb:" || !["127.0.0.1", "localhost"].includes(mongo.hostname) || mongo.username || mongo.password) {
    throw new Error("The campaign readiness runtime requires a disposable loopback MongoDB endpoint");
  }
  mongo.pathname = "/block_insure_paired_" + randomUUID().replaceAll("-", "");
  const apiPort = await localPort();
  const oraclePorts = [await localPort(), await localPort()];
  if (new Set([apiPort, ...oraclePorts]).size !== 3) throw new Error("Campaign readiness ports overlap");
  const api = `http://127.0.0.1:${apiPort}`;
  const componentVariables = {
    InsuranceManager: "CONTRACT_ADDRESS", ClaimAdjudicator: "CLAIM_ADJUDICATOR_ADDRESS", PolicyEconomics: "POLICY_ECONOMICS_ADDRESS",
    PolicyBenefitsManager: "POLICY_BENEFITS_ADDRESS", EvidenceRegistry: "EVIDENCE_REGISTRY_ADDRESS",
    HospitalVerificationRegistry: "HOSPITAL_VERIFICATION_REGISTRY_ADDRESS", BankIdentityRegistry: "BANK_IDENTITY_REGISTRY_ADDRESS",
    ProtocolDeploymentRegistry: "PROTOCOL_DEPLOYMENT_REGISTRY_ADDRESS",
  };
  const components = Object.fromEntries(Object.entries(componentVariables).flatMap(([name, variable]) =>
    [[variable, deployment.components[name]], [`VITE_${variable}`, deployment.components[name]]]));
  const environment = { ...process.env, ...components, MONGODB_URI: mongo.href, NODE_ENV: "development",
    RPC_URL: provider._getConnection().url, CHAIN_ID: String(readback.chainId), VITE_CHAIN_ID: String(readback.chainId),
    VITE_DEPLOYMENT_BLOCK: String(deployment.deploymentBlock), CONTRACT_DEPLOYMENT_BLOCK: String(deployment.deploymentBlock),
    POLICY_BENEFITS_DEPLOYMENT_BLOCK: String(deployment.benefitsDeploymentBlock),
    VITE_POLICY_BENEFITS_DEPLOYMENT_BLOCK: String(deployment.benefitsDeploymentBlock),
    ADMIN_PRIVATE_KEY: signers.admin.privateKey, JWT_SECRET: randomBytes(32).toString("hex"),
    BANK_OTP_SECRET: randomBytes(32).toString("hex"), ORACLE_API_KEY: randomBytes(32).toString("hex"),
    BLOCKCHAIN_RUNTIME_ENABLED: "true", CLAIM_WORKFLOW_PROFILE: "V6", INDEXER_ENABLED: "true",
    INDEXER_CONFIRMATIONS: "0", REGISTRY_AUTO_PUBLISH: "false", EVIDENCE_AUTO_ANCHOR: "false",
    OTP_DELIVERY_MODE: "simulation", FORCE_PUBLIC_DNS: "false", EVIDENCE_KEY_DIRECTORY: path.join(directory, "readiness-keys"),
    ORACLE_WORKER_ENABLED: "true", ORACLE_SHADOW_ENABLED: "false", ORACLE_CURSOR_MODE: "backend",
    ORACLE_POLL_INTERVAL_MS: "1000", ORACLE_READY_MAX_LAG_BLOCKS: "150", ORACLE_START_BLOCK: String(deployment.deploymentBlock),
    ORACLE_PRIVATE_KEY_2: "", BACKEND_API_URL: api, MOCK_HOSPITAL_API_URL: api + "/mock/hospital/verify",
  };
  const children = [];
  function start(directoryName, script, vars) {
    const cwd = path.join(root, directoryName);
    const child = spawn(process.execPath, [path.join(cwd, script)], { cwd, env: { ...environment, ...vars }, windowsHide: true, stdio: "ignore" });
    child.on("error", () => {});
    children.push(child);
    return child;
  }
  const backend = start("backEnd", "server.js", { PORT: String(apiPort) });
  const workers = oraclePorts.map((port, index) => start("oracle", "index.js", {
    PORT: String(port), ORACLE_INSTANCE_ID: String(index + 1), ORACLE_REGISTRY_SNAPSHOT: index ? "oracle2" : "primary",
    ORACLE_PRIVATE_KEY: signers[`oracle${index + 1}`].privateKey,
  }));
  try {
    return await handoff({ urls: { api, oracle1: `http://127.0.0.1:${oraclePorts[0]}`, oracle2: `http://127.0.0.1:${oraclePorts[1]}` },
      workers, deployment: readback, provider, coordinator, journal });
  } finally {
    await Promise.allSettled([backend, ...workers].filter((child) => child.pid && child.exitCode == null && child.signalCode == null)
      .map(async (child) => {
        const ended = once(child, "exit", { signal: AbortSignal.timeout(10000) });
        child.kill("SIGTERM");
        await ended;
      }));
  }
}

module.exports = { verifyAndStopCampaignRuntime };
