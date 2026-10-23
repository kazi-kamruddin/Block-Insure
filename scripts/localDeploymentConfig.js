const fs = require("node:fs");
const path = require("node:path");
const keys = {
  InsuranceManager: "CONTRACT_ADDRESS", OracleCoordinator: "ORACLE_COORDINATOR_ADDRESS",
  ClaimAdjudicator: "CLAIM_ADJUDICATOR_ADDRESS", PolicyEconomics: "POLICY_ECONOMICS_ADDRESS",
  PolicyBenefitsManager: "POLICY_BENEFITS_ADDRESS", EvidenceRegistry: "EVIDENCE_REGISTRY_ADDRESS",
  HospitalVerificationRegistry: "HOSPITAL_VERIFICATION_REGISTRY_ADDRESS", BankIdentityRegistry: "BANK_IDENTITY_REGISTRY_ADDRESS",
  ProtocolDeploymentRegistry: "PROTOCOL_DEPLOYMENT_REGISTRY_ADDRESS",
};
function readLocalDeployment(root) {
  const filename = path.join(root, "contracts/deployments/localhost-31337.json");
  if (!fs.existsSync(filename)) return {};
  const deployment = JSON.parse(fs.readFileSync(filename, "utf8"));
  if (String(deployment.chainId) !== "31337") throw new Error("Local deployment manifest has an unexpected chain ID");
  for (const key of ["deploymentBlock", "benefitsDeploymentBlock"]) {
    if (!Number.isSafeInteger(deployment[key]) || deployment[key] < 0) throw new Error(`Invalid ${key} in local deployment manifest`);
  }
  const values = {};
  for (const [component, key] of Object.entries(keys)) {
    const address = deployment.components?.[component];
    if (!/^0x[0-9a-fA-F]{40}$/.test(address || "") || /^0x0{40}$/.test(address)) throw new Error(`Invalid ${component} in local deployment manifest`);
    values[key] = address;
    values[`VITE_${key}`] = address;
  }
  values.CONTRACT_DEPLOYMENT_BLOCK = String(deployment.deploymentBlock);
  values.VITE_DEPLOYMENT_BLOCK = String(deployment.deploymentBlock);
  values.POLICY_BENEFITS_DEPLOYMENT_BLOCK = String(deployment.benefitsDeploymentBlock);
  values.VITE_POLICY_BENEFITS_DEPLOYMENT_BLOCK = String(deployment.benefitsDeploymentBlock);
  return values;
}
module.exports = { readLocalDeployment };
