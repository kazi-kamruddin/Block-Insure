const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { calculateReproducibilityHash } = require("../backEnd/services/researchArtifactService");
const { verifyModelArtifact } = require("../backEnd/services/modelArtifactService");
const { verifyTriagePolicy } = require("../backEnd/services/triagePolicyService");
const { reproducibilityBasis } = require("../backEnd/scripts/evaluateEvidenceLifecycle");
const {
  researchManifestReproducibilityBasis,
  run: buildResearchManifest,
} = require("../backEnd/scripts/generateResearchManifest");
const { parseEnv, verifyTemplate } = require("./releaseCheck");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const readJson = (relativePath) =>
  JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, relativePath), "utf8"));
const sha256File = (relativePath) =>
  crypto.createHash("sha256").update(fs.readFileSync(path.join(PROJECT_ROOT, relativePath))).digest("hex");
const assert = (condition, message, failures) => {
  if (!condition) failures.push(message);
};

const validateNodeVersion = (version = process.versions.node) => {
  const [major, minor] = String(version).replace(/^v/, "").split(".").map(Number);
  return (
    (major === 20 && minor >= 19) ||
    (major === 22 && minor >= 12) ||
    major === 24
  );
};

const verifyPackageMetadata = (failures) => {
  const directories = [".", "backEnd", "contracts", "frontEnd", "oracle"];
  for (const directory of directories) {
    const packagePath = path.join(directory, "package.json");
    const lockPath = path.join(directory, "package-lock.json");
    const packageJson = readJson(packagePath);
    const lockJson = readJson(lockPath);
    assert(Boolean(packageJson.name), `${packagePath} has no package name`, failures);
    assert(lockJson.lockfileVersion >= 3, `${lockPath} must use lockfileVersion 3 or newer`, failures);
    for (const dependencyKind of ["dependencies", "devDependencies"]) {
      const declaredDependencies = Object.keys(
        packageJson[dependencyKind] || {}
      ).sort();
      const lockedDependencies = Object.keys(
        lockJson.packages?.[""]?.[dependencyKind] || {}
      ).sort();
      assert(
        JSON.stringify(declaredDependencies) === JSON.stringify(lockedDependencies),
        `${dependencyKind} in ${lockPath} does not match ${packagePath}`,
        failures
      );
    }
    assert(
      fs.existsSync(path.join(PROJECT_ROOT, directory, "node_modules")),
      `${directory}/node_modules is missing; run npm run install:all`,
      failures
    );
  }
  const rootScripts = readJson("package.json").scripts || {};
  for (const script of [
    "dev:all",
    "setup:local",
    "research:all",
    "verify:all",
    "verify:full",
    "doctor",
    "deploy:sepolia",
    "release:check",
  ]) {
    assert(Boolean(rootScripts[script]), `Root package script ${script} is missing`, failures);
  }
};

const parseExampleKeys = (relativePath) => new Set(
  fs.readFileSync(path.join(PROJECT_ROOT, relativePath), "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#") && line.includes("="))
    .map((line) => line.slice(0, line.indexOf("=")).trim())
);

const verifyEnvironmentTemplates = (failures) => {
  const requirements = {
    "backEnd/.env.example": ["MONGODB_URI", "JWT_SECRET", "RPC_URL", "CHAIN_ID", "TRUST_PROXY", "VITE_CONTRACT_ADDRESS", "ADMIN_PRIVATE_KEY", "ORACLE_PRIVATE_KEY", "ORACLE_PRIVATE_KEY_2", "ORACLE_API_KEY", "ENABLE_SIMULATED_HOSPITAL_API"],
    "frontEnd/.env.example": ["VITE_API_BASE_URL", "VITE_CONTRACT_ADDRESS", "VITE_NETWORK_NAME", "VITE_BLOCK_EXPLORER_URL"],
    "contracts/.env.example": ["ADMIN_PRIVATE_KEY"],
    "oracle/.env.example": ["RPC_URL", "CONTRACT_ADDRESS", "ORACLE_PRIVATE_KEY", "ORACLE_API_KEY"],
    "oracle/.env.oracle2.example": ["RPC_URL", "CONTRACT_ADDRESS", "ORACLE_PRIVATE_KEY_2", "ORACLE_API_KEY"],
    "e2e/.env.example": ["E2E_APP_URL", "E2E_API_URL", "E2E_RPC_URL", "E2E_CHAIN_ID"],
  };
  for (const [filePath, keys] of Object.entries(requirements)) {
    const present = parseExampleKeys(filePath);
    for (const key of keys) assert(present.has(key), `${key} is missing in ${filePath}`, failures);
  }
};

const verifyDeploymentAssets = (failures) => {
  const templatePath = path.join(PROJECT_ROOT, "deploy", "production.env.example");
  assert(fs.existsSync(templatePath), "Deployment environment template is missing", failures);
  if (!fs.existsSync(templatePath)) return;
  const environment = parseEnv(fs.readFileSync(templatePath, "utf8"));
  for (const failure of verifyTemplate(environment)) failures.push(failure);
};

const verifyResearchArtifacts = (failures) => {
  const model = readJson("backEnd/model-params.json");
  const triage = readJson("backEnd/triage-policy.json");
  const phase5 = readJson("backEnd/evaluation-results/phase5-evaluation.json");
  const reserve = readJson("backEnd/evaluation-results/phase3-reserve-evaluation.json");
  const evidence = readJson("backEnd/evaluation-results/phase4-evidence-evaluation.json");
  const hybrid = readJson("backEnd/evaluation-results/hybrid-v1-evaluation.json");
  const providerRiskModel = readJson("backEnd/evaluation-results/provider-risk-real-v1.0.0.json");
  const hybridBenchmark = readJson("backEnd/evaluation-results/hybrid-runtime-benchmark.json");
  const researchManifest = readJson("backEnd/evaluation-results/research-manifest-v4.json");
  const datasetManifest = readJson("backEnd/datasets/phase5/manifest.json");
  const hybridDatasetManifest = readJson("backEnd/datasets/hybrid-v1/manifest.json");
  const mutation = readJson("contracts/mutation-results.json");
  assert(verifyModelArtifact(model).valid, "Frozen fraud model integrity failed", failures);
  assert(verifyTriagePolicy(triage).valid, "Frozen triage-policy integrity failed", failures);
  assert(verifyModelArtifact(providerRiskModel).valid, "Frozen provider-risk model integrity failed", failures);
  assert(triage.modelIdentityHash === model.modelIdentityHash, "Triage policy is not bound to the frozen model", failures);
  assert(phase5.schemaVersion === 4, "Fraud evaluation schemaVersion must be 4", failures);
  assert(phase5.reproducibilityHash === calculateReproducibilityHash(phase5), "Fraud evaluation reproducibility hash is stale", failures);
  assert(reserve.reproducibilityHash === calculateReproducibilityHash(reserve), "Reserve evaluation reproducibility hash is stale", failures);
  assert(evidence.reproducibilityHash === calculateReproducibilityHash(reproducibilityBasis(evidence)), "Evidence evaluation reproducibility hash is stale", failures);
  assert(hybrid.reproducibilityHash === calculateReproducibilityHash(hybrid), "Hybrid evaluation reproducibility hash is stale", failures);
  assert(hybridBenchmark.reproducibilityHash === calculateReproducibilityHash(hybridBenchmark), "Hybrid runtime benchmark reproducibility hash is stale", failures);
  assert(hybrid.sourceClaims === hybridDatasetManifest.totalUniqueClaims, "Hybrid evaluation does not cover every unique public-source claim", failures);
  assert(hybridDatasetManifest.counts.runtimeHybrid === 4995, "Hybrid runtime sample must contain 4,995 hybrid records", failures);
  assert(hybridBenchmark.runtimeRecords === 5000, "Hybrid runtime benchmark must cover 5,000 records", failures);
  assert(hybridBenchmark.proofSample?.allValid === true, "Hybrid runtime benchmark contains a failed Merkle proof", failures);
  for (const dataset of Object.values(datasetManifest.datasets || {})) {
    assert(sha256File(path.join("backEnd/datasets/phase5", dataset.file)) === dataset.sha256, `Dataset hash mismatch: ${dataset.file}`, failures);
  }
  assert(mutation.summary?.valid === mutation.summary?.killed, "Mutation campaign contains a surviving valid mutant", failures);
  assert((mutation.summary?.invalid || 0) + (mutation.summary?.timedOut || 0) + (mutation.summary?.infrastructureErrors || 0) === 0, "Mutation campaign contains invalid, timeout, or infrastructure results", failures);
  assert(
    researchManifest.reproducibilityHash === calculateReproducibilityHash(
      researchManifestReproducibilityBasis(researchManifest)
    ),
    "Research manifest reproducibility hash is invalid",
    failures
  );
  const expectedManifest = buildResearchManifest({ writeOutput: false });
  assert(researchManifest.reproducibilityHash === expectedManifest.reproducibilityHash, "Research manifest is stale; regenerate research artifacts", failures);
};

const verifyCharts = (failures) => {
  const chartManifest = readJson("backEnd/evaluation-results/evaluation-charts/chart-manifest.json");
  assert(chartManifest.schemaVersion === 1, "Chart manifest schemaVersion must be 1", failures);
  const expected = [
    "confusion_matrix.png",
    "triage_cost_capacity.png",
    "triage_recall_capacity.png",
    "reserve_shortfall_frontier.svg",
    "reserve_expected_shortfall.svg",
    "evidence_aes_latency.svg",
    "evidence_pre_latency.svg",
  ];
  const entries = new Map((chartManifest.charts || []).map((chart) => [chart.file, chart]));
  for (const fileName of expected) assert(entries.has(fileName), `Chart manifest is missing ${fileName}`, failures);
  for (const chart of chartManifest.charts || []) {
    const relativePath = path.join("backEnd/evaluation-results/evaluation-charts", chart.file);
    assert(fs.existsSync(path.join(PROJECT_ROOT, relativePath)), `Generated chart is missing: ${chart.file}`, failures);
    if (fs.existsSync(path.join(PROJECT_ROOT, relativePath))) {
      assert(sha256File(relativePath) === chart.sha256, `Generated chart hash mismatch: ${chart.file}`, failures);
      assert(fs.statSync(path.join(PROJECT_ROOT, relativePath)).size === chart.bytes, `Generated chart size mismatch: ${chart.file}`, failures);
    }
  }
};

const verifyCompiledContracts = (failures) => {
  const artifact = readJson("contracts/artifacts/contracts/InsuranceManager.sol/InsuranceManager.json");
  const deployedBytes = Math.max(0, (String(artifact.deployedBytecode || "0x").length - 2) / 2);
  assert(deployedBytes <= 24_448, `InsuranceManager exceeds the 24,448-byte maintenance budget (${deployedBytes})`, failures);
};

const verifyTemporaryState = (failures) => {
  assert(!fs.existsSync(path.join(PROJECT_ROOT, "contracts", ".mutation-workspace")), "Mutation workspace was not cleaned", failures);
  for (const directory of [
    "backEnd",
    "backEnd/evaluation-results",
    "backEnd/evaluation-results/evaluation-charts",
    "backEnd/datasets/phase5",
    "contracts",
  ]) {
    const leftovers = fs.readdirSync(path.join(PROJECT_ROOT, directory)).filter((name) => name.endsWith(".tmp"));
    assert(leftovers.length === 0, `Temporary files remain in ${directory}: ${leftovers.join(", ")}`, failures);
  }
};

const run = () => {
  const failures = [];
  assert(
    validateNodeVersion(),
    `Node ${process.versions.node} is unsupported; use Node 20.19+, 22.12+, or 24.x`,
    failures
  );
  verifyPackageMetadata(failures);
  verifyEnvironmentTemplates(failures);
  verifyDeploymentAssets(failures);
  verifyResearchArtifacts(failures);
  verifyCharts(failures);
  verifyCompiledContracts(failures);
  verifyTemporaryState(failures);
  if (failures.length) throw new Error(`Repository integrity verification failed:\n- ${failures.join("\n- ")}`);
  return { checks: 7, node: process.version };
};

if (require.main === module) {
  try {
    const result = run();
    console.log(`[Repository verification] ${result.checks} check groups passed on ${result.node}.`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = { run, validateNodeVersion };
