const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), os = require("node:os");
const load = require("./helpers/loadIsolatedModule");
test("explicit isolated manifest cannot silently fall back to saved deployment", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "block-insure-daily-manifest-"));
  const filename = path.join(temp, "prepared.json");
  const reader = load("../scripts/localDeploymentConfig.js", {}, { LOCAL_DEPLOYMENT_MANIFEST: filename });
  try {
    assert.throws(() => reader.readLocalDeployment(temp), /Explicit local deployment manifest/);
    const components = Object.fromEntries(["InsuranceManager", "OracleCoordinator", "ClaimAdjudicator", "PolicyEconomics", "PolicyBenefitsManager", "EvidenceRegistry", "HospitalVerificationRegistry", "BankIdentityRegistry", "ProtocolDeploymentRegistry"].map((key) => [key, `0x${"1".repeat(40)}`]));
    fs.writeFileSync(filename, JSON.stringify({ chainId: 31337, deploymentBlock: 1, benefitsDeploymentBlock: 2, components }));
    assert.equal(reader.readLocalDeployment(temp).CONTRACT_DEPLOYMENT_BLOCK, "1");
    assert.equal(reader.readLocalDeployment(temp).CONTRACT_ADDRESS, components.InsuranceManager);
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
});
