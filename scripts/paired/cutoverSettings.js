const fs = require("node:fs");
const path = require("node:path");

function settingsFor({ campaign, deployment, hostedOracleWallets }) {
  if (campaign.local || campaign.chainId !== 84532 || !campaign.complete || String(deployment.chainId) !== "84532" ||
      campaign.componentAddresses.InsuranceManager !== deployment.components.InsuranceManager) {
    throw new Error("Cutover settings require the finished fresh Base campaign");
  }
  const names = {
    InsuranceManager: "CONTRACT_ADDRESS", OracleCoordinator: "ORACLE_COORDINATOR_ADDRESS",
    ClaimAdjudicator: "CLAIM_ADJUDICATOR_ADDRESS", PolicyEconomics: "POLICY_ECONOMICS_ADDRESS",
    EvidenceRegistry: "EVIDENCE_REGISTRY_ADDRESS", PolicyBenefitsManager: "POLICY_BENEFITS_ADDRESS",
    HospitalVerificationRegistry: "HOSPITAL_VERIFICATION_REGISTRY_ADDRESS", BankIdentityRegistry: "BANK_IDENTITY_REGISTRY_ADDRESS",
    ProtocolDeploymentRegistry: "PROTOCOL_DEPLOYMENT_REGISTRY_ADDRESS",
  };
  const scope = Object.fromEntries(Object.entries(names).map(([name, variable]) => [variable, deployment.components[name]]));
  const apiUrl = "https://block-insure-api.onrender.com";
  const frontend = "https://block-insure.vercel.app";
  const oracleOrigins = ["https://block-insure-oracle-one.onrender.com", "https://block-insure-oracle-two.onrender.com"];
  const shared = { CHAIN_ID: "84532", ...scope, CONTRACT_DEPLOYMENT_BLOCK: String(deployment.deploymentBlock),
    POLICY_BENEFITS_DEPLOYMENT_BLOCK: String(deployment.benefitsDeploymentBlock) };
  const api = { ...shared, VITE_CHAIN_ID: "84532", VITE_CONTRACT_ADDRESS: scope.CONTRACT_ADDRESS,
    VITE_DEPLOYMENT_BLOCK: shared.CONTRACT_DEPLOYMENT_BLOCK, VITE_POLICY_BENEFITS_DEPLOYMENT_BLOCK: shared.POLICY_BENEFITS_DEPLOYMENT_BLOCK,
    CLAIM_WORKFLOW_PROFILE: "V6", SIWE_URI: frontend, SIWE_DOMAIN: new URL(frontend).hostname,
    ALLOWED_ORIGINS: frontend, ORACLE_READY_URLS: oracleOrigins.join(","), BLOCKCHAIN_RUNTIME_ENABLED: "true", INDEXER_ENABLED: "true" };
  const workers = ["primary", "oracle2"].map((snapshot, index) => ({ origin: oracleOrigins[index], wallet: hostedOracleWallets[index], env: {
    CONTRACT_ADDRESS: scope.CONTRACT_ADDRESS, ORACLE_COORDINATOR_ADDRESS: scope.ORACLE_COORDINATOR_ADDRESS,
    ORACLE_START_BLOCK: shared.CONTRACT_DEPLOYMENT_BLOCK, BACKEND_API_URL: apiUrl,
    MOCK_HOSPITAL_API_URL: apiUrl + "/mock/hospital/verify", ORACLE_REGISTRY_SNAPSHOT: snapshot,
    ORACLE_WORKER_ENABLED: "true", ORACLE_CURSOR_MODE: "backend", ORACLE_READY_MAX_LAG_BLOCKS: "150",
  } }));
  const vercel = { ...Object.fromEntries(Object.entries(scope).map(([key, value]) => ["VITE_" + key, value])),
    VITE_CHAIN_ID: "84532", VITE_NETWORK_NAME: "Base Sepolia", VITE_API_BASE_URL: apiUrl,
    VITE_DEPLOYMENT_BLOCK: shared.CONTRACT_DEPLOYMENT_BLOCK, VITE_CONTRACT_DEPLOYMENT_BLOCK: shared.CONTRACT_DEPLOYMENT_BLOCK,
    VITE_POLICY_BENEFITS_DEPLOYMENT_BLOCK: shared.POLICY_BENEFITS_DEPLOYMENT_BLOCK };
  return { sourceCommit: campaign.sourceCommit, newAtlasDatabase: "block_insure_v6_" + deployment.deploymentBlock,
    atlasInstruction: "Change only the database name in the existing MongoDB connection configuration. Preserve its credentials and legacy database.",
    secretInstruction: "Retain all existing wallet keys, RPC credentials, API keys, signing secrets and mailbox configuration.",
    renderApi: { origin: apiUrl, env: api }, renderWorkers: workers,
    vercel: { origin: frontend, env: vercel },
    readinessCommand: "node scripts/paired/readiness.js --readback HOSTED_BASE_READBACK_JSON",
    readinessEnvironment: { HOSTED_BACKEND_URL: apiUrl, HOSTED_ORACLE_ONE_URL: oracleOrigins[0], HOSTED_ORACLE_TWO_URL: oracleOrigins[1] },
    releaseConfigUrl: frontend + "/release-config.json",
    acceptance: ["Verify every role signs in", "Purchase a policy and pay one premium", "Verify one automatic claim through both workers and withdraw",
      "Exercise a clarification or reasoned vote", "Verify the cancellation refund is visible"],
  };
}

if (require.main === module) (() => {
  const options = require("../operatorArguments").parseOperatorArguments(process.argv.slice(2), {
    values: ["--directory", "--output"], required: ["--directory", "--output"],
  });
  const read = (name) => JSON.parse(fs.readFileSync(path.join(options["--directory"], name)));
  const plan = read("run-plan.json");
  const result = settingsFor({ campaign: read("campaign.json"), deployment: read("baseSepolia-84532.json"), hostedOracleWallets: plan.hostedOracleWallets });
  fs.writeFileSync(options["--output"], JSON.stringify(result, null, 2) + "\n", { flag: "wx" });
})();

module.exports = { settingsFor };
