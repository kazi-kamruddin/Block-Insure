// Read-only verification of a compatible deployment. Never signs or publishes.
const fs = require("node:fs");
const path = require("node:path");
const { ethers } = require("../backEnd/node_modules/ethers");
const root = path.resolve(__dirname, "..");
const COMPONENTS = {
  InsuranceManager: "IInsuranceManager/3", OracleCoordinator: "IOracleCoordinator/2",
  ClaimAdjudicator: "IClaimAdjudicator/2", PolicyEconomics: "IPolicyEconomics/3",
  EvidenceRegistry: "IEvidenceRegistry/1", PolicyBenefitsManager: "IPolicyBenefitsManager/2",
  HospitalVerificationRegistry: "IHospitalVerificationRegistry/1", BankIdentityRegistry: "IBankIdentityRegistry/2",
};
const artifactFor = (name) => JSON.parse(fs.readFileSync(path.join(root, `contracts/artifacts/contracts/${name}.sol/${name}.json`)));
function comparableCode(code, references = {}) {
  const bytes = Buffer.from(code.replace(/^0x/, ""), "hex");
  for (const entries of Object.values(references)) for (const { start, length } of entries) {
    if (start < 0 || length < 1 || start + length > bytes.length) throw new Error("Invalid immutable reference");
    bytes.fill(0, start, start + length);
  }
  return ethers.keccak256(bytes);
}
// Hardhat artifacts omit immutableReferences; read them from their build-info.
function immutableReferences(name) {
  const debugPath = path.join(root, `contracts/artifacts/contracts/${name}.sol/${name}.dbg.json`);
  const debug = JSON.parse(fs.readFileSync(debugPath));
  const build = JSON.parse(fs.readFileSync(path.resolve(path.dirname(debugPath), debug.buildInfo)));
  return build.output.contracts[`contracts/${name}.sol`][name].evm.deployedBytecode.immutableReferences || {};
}
async function verifyDeployment({ manifest, provider, local = false }) {
  const chainId = (await provider.getNetwork()).chainId;
  if (chainId !== BigInt(manifest.chainId) || !(local ? [31337n] : [11155111n, 84532n]).includes(chainId)) throw new Error("Deployment network mismatch");
  const components = manifest.components || {};
  const names = [...Object.keys(COMPONENTS), "ProtocolDeploymentRegistry"];
  if (names.some((name) => !ethers.isAddress(components[name])) || new Set(names.map((name) => components[name].toLowerCase())).size !== names.length) throw new Error("Missing or repeated component address");
  const contracts = Object.fromEntries(names.map((name) => [name, new ethers.Contract(components[name], artifactFor(name).abi, provider)]));
  const calendarProfile = manifest.calendarProfile || "QUARTERLY";
  if (!["QUARTERLY", "ACCELERATED_TESTNET"].includes(calendarProfile)) throw new Error("Unsupported calendar profile");
  const codeHashes = {};
  for (const name of names) {
    const implementation = name === "InsuranceManager" && calendarProfile === "ACCELERATED_TESTNET" ? "AcceleratedInsuranceManager" : name;
    const code = await provider.getCode(components[name]);
    if (code === "0x" || comparableCode(code, immutableReferences(implementation)) !== comparableCode(artifactFor(implementation).deployedBytecode, immutableReferences(implementation))) throw new Error(`Deployed code differs: ${name}`);
    codeHashes[name] = ethers.keccak256(code);
  }
  const directory = contracts.ProtocolDeploymentRegistry;
  if (await directory.protocolVersion() !== ethers.id("BLOCK_INSURE_COMPLETION_PHASE2_V3")) throw new Error("Incompatible release directory");
  for (const [name, version] of Object.entries(COMPONENTS)) {
    const row = await directory.getComponent(ethers.id(name));
    if (row.deployment.toLowerCase() !== components[name].toLowerCase() || row.interfaceVersion !== ethers.id(version) || row.active !== (name !== "HospitalVerificationRegistry")) throw new Error(`Directory mismatch: ${name}`);
  }
  const manager = contracts.InsuranceManager;
  for (const [getter, name] of [["oracleCoordinator", "OracleCoordinator"], ["claimAdjudicator", "ClaimAdjudicator"], ["policyEconomics", "PolicyEconomics"]]) {
    if ((await manager[getter]()).toLowerCase() !== components[name].toLowerCase()) throw new Error(`Manager wiring mismatch: ${name}`);
  }
  for (const name of ["OracleCoordinator", "ClaimAdjudicator", "PolicyEconomics", "EvidenceRegistry"]) if ((await contracts[name].manager()).toLowerCase() !== components.InsuranceManager.toLowerCase()) throw new Error(`Manager owner mismatch: ${name}`);
  if ((await contracts.PolicyBenefitsManager.insuranceManager()).toLowerCase() !== components.InsuranceManager.toLowerCase() ||
    (await contracts.PolicyEconomics.benefitsManager()).toLowerCase() !== components.PolicyBenefitsManager.toLowerCase()) throw new Error("Refund module wiring mismatch");
  // Historical manifests remain valid; unknown identities do not.
  const model = require("../oracle/runtimeProtocol").resolveRequestModel(manifest.modelIdentityHash).artifact.modelIdentityHash;
  if (await manager.oracleModelVersion() !== model || manifest.modelIdentityHash !== model) throw new Error("Model identity mismatch");
  const oracles = Array.from(await contracts.OracleCoordinator.getActiveOracles());
  const auditors = Array.from(await contracts.ClaimAdjudicator.getActiveAuditors());
  if (await contracts.OracleCoordinator.quorumThreshold() !== 2n) throw new Error("Oracle quorum must be two");
  const schedule = require("../backEnd/services/paymentScheduleService").formatPaymentSchedule(await contracts.PolicyEconomics.getPaymentSchedule());
  if (schedule.profile !== calendarProfile) throw new Error("Payment calendar differs from selected manifest");
  if (oracles.length < 2 || auditors.length < 4 || new Set([...oracles, ...auditors].map((v) => v.toLowerCase())).size !== oracles.length + auditors.length) throw new Error("Insufficient or overlapping adjudication roles");
  if (await contracts.OracleCoordinator.currentRegistryVersion() === 0n || await contracts.OracleCoordinator.currentRegistryRoot() === ethers.ZeroHash) throw new Error("Registry has not been published");
  const block = await provider.getBlock(Number(manifest.deploymentBlock));
  if (!block) throw new Error("Deployment block missing");
  return { schema: "block-insure-deployment-readback-v1", checkedAt: new Date().toISOString(), chainId: String(chainId),
    deploymentBlock: Number(manifest.deploymentBlock), deploymentBlockHash: block.hash, modelIdentityHash: model, codeHashes,
    manager: components.InsuranceManager, components, paymentSchedule: schedule, oracleWallets: oracles, auditorWallets: auditors, registryRoot: await contracts.OracleCoordinator.currentRegistryRoot(),
    limitation: "Read-only code, directory, wiring, model and role checks; not workflow, funding, external-service or economic-finality acceptance." };
}
async function main() {
  const args = require("./operatorArguments").parseOperatorArguments(process.argv.slice(2), { values: ["--manifest", "--output"], switches: ["--local"], required: ["--manifest"] });
  if (!process.env.RPC_URL) throw new Error("Explicit RPC required");
  if (!args["--local"] && new URL(process.env.RPC_URL).protocol !== "https:") throw new Error("HTTPS RPC required");
  const request = new ethers.FetchRequest(process.env.RPC_URL); request.timeout = 10000;
  const provider = new ethers.JsonRpcProvider(request);
  try {
    const result = await verifyDeployment({ manifest: JSON.parse(fs.readFileSync(args["--manifest"])), provider, local: Boolean(args["--local"]) });
    if (args["--output"]) fs.writeFileSync(args["--output"], JSON.stringify(result, null, 2) + "\n", { flag: "wx" });
    console.log(JSON.stringify(result));
  } finally { provider.destroy(); }
}
if (require.main === module) main().catch(() => { console.error("Deployment readback failed; inspect the selected manifest, compiled artifacts and matching RPC privately. No transaction was sent."); process.exitCode = 1; });
module.exports = { comparableCode, verifyDeployment };
