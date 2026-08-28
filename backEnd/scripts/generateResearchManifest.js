const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { atomicWriteFileSync, calculateReproducibilityHash } = require("../services/researchArtifactService");
const { verifyModelArtifact } = require("../services/modelArtifactService");
const { verifyTriagePolicy } = require("../services/triagePolicyService");

const BACKEND_ROOT = path.resolve(__dirname, "..");
const PROJECT_ROOT = path.resolve(BACKEND_ROOT, "..");
const CONTRACTS_ROOT = path.join(PROJECT_ROOT, "contracts");
const OUTPUT_PATH = path.join(BACKEND_ROOT, "evaluation-results", "research-manifest-v4.json");

const sha256File = (filePath) =>
  crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");

const readJson = (filePath) => JSON.parse(fs.readFileSync(filePath, "utf8"));
const readJsonIfExists = (filePath) =>
  fs.existsSync(filePath) ? readJson(filePath) : null;

const git = (...args) => execFileSync(
  "git",
  ["-c", `safe.directory=${PROJECT_ROOT.replace(/\\/g, "/")}`, ...args],
  { cwd: PROJECT_ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] }
).trim();

const contractArtifactDetails = (contractName) => {
  const filePath = path.join(
    CONTRACTS_ROOT,
    "artifacts",
    "contracts",
    `${contractName}.sol`,
    `${contractName}.json`
  );
  if (!fs.existsSync(filePath)) return { compiled: false };
  const artifact = readJson(filePath);
  return {
    compiled: true,
    deployedBytecodeBytes: Math.max(0, (artifact.deployedBytecode.length - 2) / 2),
    artifactSha256: sha256File(filePath),
  };
};

const verifyDatasets = (datasetDirectory, manifest) => {
  const entries = Object.fromEntries(Object.entries(manifest.datasets).map(([profile, dataset]) => {
    const filePath = path.join(datasetDirectory, dataset.file);
    const actualSha256 = sha256File(filePath);
    return [profile, {
      file: dataset.file,
      records: dataset.records,
      expectedSha256: dataset.sha256,
      actualSha256,
      valid: dataset.sha256 === actualSha256,
    }];
  }));
  return {
    valid: Object.values(entries).every((entry) => entry.valid),
    entries,
  };
};

const run = ({ writeOutput = true } = {}) => {
  const modelPath = path.join(BACKEND_ROOT, "model-params.json");
  const triagePath = path.join(BACKEND_ROOT, "triage-policy.json");
  const datasetDirectory = path.join(BACKEND_ROOT, "datasets", "phase5");
  const datasetManifestPath = path.join(datasetDirectory, "manifest.json");
  const evaluationPath = path.join(BACKEND_ROOT, "evaluation-results", "phase5-evaluation.json");
  const reserveEvaluationPath = path.join(BACKEND_ROOT, "evaluation-results", "phase3-reserve-evaluation.json");
  const evidenceEvaluationPath = path.join(BACKEND_ROOT, "evaluation-results", "phase4-evidence-evaluation.json");
  const chartManifestPath = path.join(BACKEND_ROOT, "evaluation-results", "evaluation-charts", "chart-manifest.json");
  const mutationManifestPath = path.join(CONTRACTS_ROOT, "mutations", "manifest.json");
  const mutationResultsPath = path.join(CONTRACTS_ROOT, "mutation-results.json");
  const invariantCataloguePath = path.join(CONTRACTS_ROOT, "test", "invariants", "protocol-invariants.json");
  const model = readJson(modelPath);
  const triagePolicy = readJson(triagePath);
  const datasetManifest = readJson(datasetManifestPath);
  const evaluation = readJson(evaluationPath);
  const reserveEvaluation = readJsonIfExists(reserveEvaluationPath);
  const evidenceEvaluation = readJsonIfExists(evidenceEvaluationPath);
  const chartManifest = readJsonIfExists(chartManifestPath);
  const modelIntegrity = verifyModelArtifact(model);
  const policyIntegrity = verifyTriagePolicy(triagePolicy);
  const datasetIntegrity = verifyDatasets(datasetDirectory, datasetManifest);
  if (!modelIntegrity.valid) throw new Error(modelIntegrity.errors.join("; "));
  if (!policyIntegrity.valid) throw new Error(policyIntegrity.errors.join("; "));
  if (!datasetIntegrity.valid) throw new Error("One or more Phase 5 dataset hashes do not match the manifest");
  if (evaluation.schemaVersion !== 4 || !evaluation.reproducibilityHash) {
    throw new Error("Run the schema-v4 Phase 5 evaluation before generating the research manifest");
  }
  if (reserveEvaluation && !reserveEvaluation.reproducibilityHash) {
    throw new Error("The Phase 3 reserve artifact is missing its reproducibility hash");
  }
  if (evidenceEvaluation && !evidenceEvaluation.reproducibilityHash) {
    throw new Error("The Phase 4 evidence artifact is missing its reproducibility hash");
  }

  const packageFiles = {
    root: PROJECT_ROOT,
    backend: BACKEND_ROOT,
    contracts: CONTRACTS_ROOT,
    frontend: path.join(PROJECT_ROOT, "frontEnd"),
    oracle: path.join(PROJECT_ROOT, "oracle"),
  };
  const implementationFiles = [
    "backEnd/services/phase5EvaluationService.js",
    "backEnd/services/triageEvaluationService.js",
    "backEnd/services/triagePolicyService.js",
    "backEnd/services/reserveSimulationService.js",
    "backEnd/services/evidenceBenchmarkService.js",
    "backEnd/services/researchArtifactService.js",
    "backEnd/scripts/evaluatePhase5.js",
    "backEnd/scripts/evaluateReserveAdequacy.js",
    "backEnd/scripts/evaluateEvidenceLifecycle.js",
    "backEnd/scripts/freezeModelArtifact.js",
    "backEnd/scripts/freezeTriagePolicy.js",
    "backEnd/scripts/generateSyntheticDatasets.js",
    "backEnd/scripts/generateEvaluationCharts.js",
    "backEnd/scripts/generatePhase34Charts.js",
    "backEnd/scripts/generateChartManifest.js",
    "backEnd/scripts/generateResearchManifest.js",
    "backEnd/test/phase6CapacityTriage.test.js",
    "backEnd/test/phase7ReserveEvidence.test.js",
    "backEnd/test/phase8OperationalHardening.test.js",
    "contracts/hardhat.config.js",
    "contracts/mutations/manifest.json",
    "contracts/scripts/runMutationCampaign.js",
    "contracts/test/invariants/protocol-invariants.json",
    "contracts/test/Phase6ProtocolStatefulInvariants.test.js",
    "scripts/devAll.js",
    "scripts/verifyRepository.js",
    "scripts/runVerification.js",
  ];
  const manifest = {
    schemaVersion: 4,
    generatedAt: new Date().toISOString(),
    source: {
      gitCommit: git("rev-parse", "HEAD"),
      dirty: Boolean(git("status", "--porcelain")),
      branch: git("rev-parse", "--abbrev-ref", "HEAD"),
    },
    environment: {
      node: process.version,
      platform: process.platform,
      architecture: process.arch,
      solidity: "0.8.26",
      evmVersion: "cancun",
      optimizerRuns: 1,
      viaIR: true,
    },
    packages: Object.fromEntries(Object.entries(packageFiles).map(([name, directory]) => {
      const packagePath = path.join(directory, "package.json");
      const lockPath = path.join(directory, "package-lock.json");
      const packageJson = readJson(packagePath);
      return [name, {
        name: packageJson.name,
        version: packageJson.version || null,
        packageJsonSha256: sha256File(packagePath),
        packageLockSha256: sha256File(lockPath),
      }];
    })),
    implementation: Object.fromEntries(implementationFiles.map((relativePath) => [
      relativePath,
      sha256File(path.join(PROJECT_ROOT, relativePath)),
    ])),
    contracts: Object.fromEntries([
      "InsuranceManager",
      "OracleCoordinator",
      "ClaimAdjudicator",
      "PolicyEconomics",
      "EvidenceRegistry",
      "PolicyBenefitsManager",
      "ProtocolDeploymentRegistry",
    ].map((contractName) => [contractName, contractArtifactDetails(contractName)])),
    artifacts: {
      fraudModel: {
        path: "backEnd/model-params.json",
        artifactHash: model.artifactHash,
        modelIdentityHash: model.modelIdentityHash,
        fileSha256: sha256File(modelPath),
      },
      triagePolicy: {
        path: "backEnd/triage-policy.json",
        artifactHash: triagePolicy.artifactHash,
        policyIdentityHash: triagePolicy.policyIdentityHash,
        fileSha256: sha256File(triagePath),
      },
      datasets: {
        path: "backEnd/datasets/phase5/manifest.json",
        manifestHash: datasetManifest.manifestHash,
        integrity: datasetIntegrity,
      },
      evaluation: {
        path: "backEnd/evaluation-results/phase5-evaluation.json",
        schemaVersion: evaluation.schemaVersion,
        reproducibilityHash: evaluation.reproducibilityHash,
      },
      reserveEvaluation: reserveEvaluation
        ? {
            path: "backEnd/evaluation-results/phase3-reserve-evaluation.json",
            schemaVersion: reserveEvaluation.schemaVersion,
            reproducibilityHash: reserveEvaluation.reproducibilityHash,
            executionFileSha256: sha256File(reserveEvaluationPath),
            advisoryOnly: reserveEvaluation.methodology.advisoryOnly,
          }
        : { path: "backEnd/evaluation-results/phase3-reserve-evaluation.json", available: false },
      evidenceEvaluation: evidenceEvaluation
        ? {
            path: "backEnd/evaluation-results/phase4-evidence-evaluation.json",
            schemaVersion: evidenceEvaluation.schemaVersion,
            reproducibilityHash: evidenceEvaluation.reproducibilityHash,
            executionFileSha256: sha256File(evidenceEvaluationPath),
            adversarialDetection: evidenceEvaluation.adversarialTests,
          }
        : { path: "backEnd/evaluation-results/phase4-evidence-evaluation.json", available: false },
      chartOutputs: chartManifest
        ? {
            path: "backEnd/evaluation-results/evaluation-charts/chart-manifest.json",
            chartCount: chartManifest.charts.length,
            executionFileSha256: sha256File(chartManifestPath),
          }
        : { path: "backEnd/evaluation-results/evaluation-charts/chart-manifest.json", available: false },
      protocolAssurance: {
        invariantCatalogue: {
          path: "contracts/test/invariants/protocol-invariants.json",
          fileSha256: sha256File(invariantCataloguePath),
        },
        mutationManifest: {
          path: "contracts/mutations/manifest.json",
          fileSha256: sha256File(mutationManifestPath),
        },
        mutationCampaign: fs.existsSync(mutationResultsPath)
          ? {
              path: "contracts/mutation-results.json",
              executionFileSha256: sha256File(mutationResultsPath),
              summary: readJson(mutationResultsPath).summary,
            }
          : { path: "contracts/mutation-results.json", available: false },
      },
    },
    experimentDefaults: {
      datasetSeed: datasetManifest.seed,
      groupedEvaluationSeeds: [11, 29, 47],
      bootstrapIterations: 250,
      triageCapacityRates: [0.05, 0.1, 0.2, 0.3, 0.5],
      primaryTriageScenario: "fraud_averse",
      primaryNominalReviewRate: 0.2,
      ...(reserveEvaluation ? {
        reserveSimulationPeriods: reserveEvaluation.methodology.periods,
        reserveTargetShortfallProbability: reserveEvaluation.methodology.targetShortfallProbability,
      } : {}),
      ...(evidenceEvaluation ? {
        evidenceBenchmarkRepetitions: evidenceEvaluation.methodology.repetitions,
      } : {}),
    },
    commands: {
      reproduceResearch: "npm --prefix backEnd run research:baseline",
      fullVerification: "npm run verify:all",
      contractStateful: "npm --prefix contracts run test:stateful",
      contractMutationCampaign: "npm --prefix contracts run test:mutations",
      reserveAdequacy: "npm --prefix backEnd run evaluate:reserve",
      evidenceLifecycle: "npm --prefix backEnd run evaluate:evidence",
      reproducePhasesThreeAndFour: "npm --prefix backEnd run research:phase34",
    },
  };
  manifest.reproducibilityHash = calculateReproducibilityHash(manifest);
  if (writeOutput) {
    atomicWriteFileSync(OUTPUT_PATH, `${JSON.stringify(manifest, null, 2)}\n`);
  }
  return manifest;
};

if (require.main === module) {
  const manifest = run();
  console.log(`Research manifest written to ${OUTPUT_PATH}`);
  console.log(`Reproducibility hash: ${manifest.reproducibilityHash}`);
}

module.exports = { readJsonIfExists, run };
