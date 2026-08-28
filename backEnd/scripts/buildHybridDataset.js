const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const readline = require("node:readline");
const { once } = require("node:events");
const {
  AMOUNT_NORMALIZATION_DIVISOR,
  AMOUNT_NORMALIZATION_VERSION,
  CLAIM_SCENARIOS,
  DEFAULT_SEED,
  HYBRID_DATASET_VERSION,
  SCENARIO_VERSION,
  buildBaseHybridRecord,
  clean,
  getProviderSplit,
  getSourceClaimAmount,
  injectScenario,
  parseCsvLine,
  toRow,
} = require("../services/hybridDatasetAdapterService");

const DATASET_DIR = path.join(__dirname, "..", "datasets", "hybrid-v1");
const RAW_DIR = path.join(DATASET_DIR, "raw");
const PROCESSED_DIR = path.join(DATASET_DIR, "processed");
const RUNTIME_DIR = path.join(DATASET_DIR, "runtime");
const LABEL_FILE = "Train-1542865627584.csv";
const BENEFICIARY_FILE = "Train_Beneficiarydata-1542865627584.csv";
const CLAIM_FILES = [
  { file: "Train_Inpatientdata-1542865627584.csv", setting: "INPATIENT" },
  { file: "Train_Outpatientdata-1542865627584.csv", setting: "OUTPATIENT" },
];
const RUNTIME_HYBRID_RECORDS = 595;

const sha256File = (filePath) => {
  const hash = crypto.createHash("sha256");
  const data = fs.readFileSync(filePath);
  hash.update(data);
  return hash.digest("hex");
};

const readCsv = async (filePath, onRow) => {
  const input = fs.createReadStream(filePath, { encoding: "utf8" });
  const reader = readline.createInterface({ input, crlfDelay: Infinity });
  let headers = null;
  let count = 0;
  for await (const line of reader) {
    if (!headers) {
      headers = parseCsvLine(line).map((header) => clean(header));
      continue;
    }
    if (!line.trim()) continue;
    count += 1;
    await onRow(toRow(headers, parseCsvLine(line)), count);
  }
  return count;
};

const percentile = (values, probability) => {
  if (!values.length) return 0;
  const sorted = values.slice().sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.floor(probability * (sorted.length - 1)));
  return sorted[index];
};

const increment = (map, key) => map.set(key, (map.get(key) || 0) + 1);

const writeLine = async (stream, value) => {
  if (!stream.write(`${JSON.stringify(value)}\n`)) await once(stream, "drain");
};

const closeStream = async (stream) => {
  stream.end();
  await once(stream, "finish");
};

const createOutput = (fileName) => {
  const filePath = path.join(PROCESSED_DIR, fileName);
  return { filePath, stream: fs.createWriteStream(filePath, { encoding: "utf8" }) };
};

const buildHybridDataset = async ({ seed = DEFAULT_SEED } = {}) => {
  fs.mkdirSync(PROCESSED_DIR, { recursive: true });
  fs.mkdirSync(RUNTIME_DIR, { recursive: true });

  const requiredFiles = [LABEL_FILE, BENEFICIARY_FILE, ...CLAIM_FILES.map(({ file }) => file)];
  requiredFiles.forEach((file) => {
    const filePath = path.join(RAW_DIR, file);
    if (!fs.existsSync(filePath)) throw new Error(`Missing hybrid source file: ${filePath}`);
  });

  const providerLabels = new Map();
  await readCsv(path.join(RAW_DIR, LABEL_FILE), async (row) => {
    providerLabels.set(clean(row.Provider), clean(row.PotentialFraud).toLowerCase() === "yes");
  });

  const beneficiaries = new Map();
  await readCsv(path.join(RAW_DIR, BENEFICIARY_FILE), async (row) => {
    beneficiaries.set(clean(row.BeneID), row);
  });

  const amountsBySetting = { INPATIENT: [], OUTPATIENT: [] };
  const providerCounts = new Map();
  const beneficiaryCounts = new Map();
  const sourceCounts = {};
  const uniqueClaimIds = new Set();

  for (const source of CLAIM_FILES) {
    sourceCounts[source.setting] = await readCsv(path.join(RAW_DIR, source.file), async (claim) => {
      const claimId = clean(claim.ClaimID);
      if (!claimId || uniqueClaimIds.has(claimId)) {
        throw new Error(`Missing or duplicate ClaimID detected: ${claimId || "<empty>"}`);
      }
      uniqueClaimIds.add(claimId);
      const providerId = clean(claim.Provider);
      const beneId = clean(claim.BeneID);
      if (!providerLabels.has(providerId)) throw new Error(`Provider label missing: ${providerId}`);
      if (!beneficiaries.has(beneId)) throw new Error(`Beneficiary missing: ${beneId}`);
      amountsBySetting[source.setting].push(getSourceClaimAmount(claim));
      increment(providerCounts, providerId);
      increment(beneficiaryCounts, beneId);
    });
  }

  const amountRanges = Object.fromEntries(
    Object.entries(amountsBySetting).map(([setting, values]) => [
      setting,
      {
        minimum: percentile(values, 0.05),
        median: percentile(values, 0.5),
        maximum: percentile(values, 0.95),
      },
    ])
  );
  const providerVelocityThreshold = percentile([...providerCounts.values()], 0.95);
  const claimantVelocityThreshold = percentile([...beneficiaryCounts.values()], 0.95);

  const outputs = {
    train: createOutput("train.jsonl"),
    calibration: createOutput("calibration.jsonl"),
    testUntouched: createOutput("test-untouched.jsonl"),
    testAttacks: createOutput("test-attacks.jsonl"),
  };
  const runtimePath = path.join(RUNTIME_DIR, "hybrid-primary.jsonl");
  const runtimeStream = fs.createWriteStream(runtimePath, { encoding: "utf8" });
  const manifestCounts = {
    train: 0,
    calibration: 0,
    testUntouched: 0,
    testAttacks: 0,
    runtimeHybrid: 0,
    providerPotentialFraudClaims: 0,
    injectedByPartition: { train: 0, calibration: 0, testAttacks: 0 },
    scenarios: Object.fromEntries(CLAIM_SCENARIOS.map((scenario) => [scenario, 0])),
  };
  const seenProvider = new Map();
  const seenBeneficiary = new Map();

  for (const source of CLAIM_FILES) {
    await readCsv(path.join(RAW_DIR, source.file), async (claim) => {
      const sourceProviderId = clean(claim.Provider);
      const sourceBeneId = clean(claim.BeneID);
      const providerPotentialFraud = providerLabels.get(sourceProviderId);
      const baseRecord = buildBaseHybridRecord({
        claim,
        beneficiary: beneficiaries.get(sourceBeneId),
        potentialFraud: providerPotentialFraud,
        claimSetting: source.setting,
        amountRange: amountRanges[source.setting],
        previousClaimCount: seenBeneficiary.get(sourceBeneId) || 0,
        providerVelocityAnomaly: providerCounts.get(sourceProviderId) >= providerVelocityThreshold,
        claimantVelocityAnomaly: beneficiaryCounts.get(sourceBeneId) >= claimantVelocityThreshold,
      });
      increment(seenProvider, sourceProviderId);
      increment(seenBeneficiary, sourceBeneId);
      if (providerPotentialFraud) manifestCounts.providerPotentialFraudClaims += 1;

      const split = getProviderSplit(sourceProviderId, seed);
      if (split === "test") {
        await writeLine(outputs.testUntouched.stream, baseRecord);
        manifestCounts.testUntouched += 1;
        const attacked = injectScenario(baseRecord, { seed: seed + 2, rate: 0.5 });
        await writeLine(outputs.testAttacks.stream, attacked);
        manifestCounts.testAttacks += 1;
        if (attacked.scenarioInjected) {
          manifestCounts.injectedByPartition.testAttacks += 1;
          manifestCounts.scenarios[attacked.scenarioType] += 1;
        }
        return;
      }

      const adapted = injectScenario(baseRecord, {
        seed: split === "train" ? seed : seed + 1,
        rate: 0.12,
      });
      await writeLine(outputs[split].stream, adapted);
      manifestCounts[split] += 1;
      if (adapted.scenarioInjected) {
        manifestCounts.injectedByPartition[split] += 1;
        manifestCounts.scenarios[adapted.scenarioType] += 1;
      }
      if (split === "train" && manifestCounts.runtimeHybrid < RUNTIME_HYBRID_RECORDS) {
        await writeLine(runtimeStream, adapted);
        manifestCounts.runtimeHybrid += 1;
      }
    });
  }

  await Promise.all([
    ...Object.values(outputs).map(({ stream }) => closeStream(stream)),
    closeStream(runtimeStream),
  ]);

  const outputFiles = {
    train: path.relative(DATASET_DIR, outputs.train.filePath).replaceAll("\\", "/"),
    calibration: path.relative(DATASET_DIR, outputs.calibration.filePath).replaceAll("\\", "/"),
    testUntouched: path.relative(DATASET_DIR, outputs.testUntouched.filePath).replaceAll("\\", "/"),
    testAttacks: path.relative(DATASET_DIR, outputs.testAttacks.filePath).replaceAll("\\", "/"),
    runtimeHybrid: path.relative(DATASET_DIR, runtimePath).replaceAll("\\", "/"),
  };
  const hashes = Object.fromEntries(
    Object.entries(outputFiles).map(([name, relativePath]) => [
      name,
      sha256File(path.join(DATASET_DIR, relativePath)),
    ])
  );
  const sourceFiles = Object.fromEntries(
    requiredFiles.map((file) => [
      file,
      { bytes: fs.statSync(path.join(RAW_DIR, file)).size, sha256: sha256File(path.join(RAW_DIR, file)) },
    ])
  );
  const manifest = {
    manifestSchemaVersion: 1,
    datasetVersion: HYBRID_DATASET_VERSION,
    generatedAt: new Date().toISOString(),
    seed,
    sourceDescription: "Public secondary healthcare-claims benchmark with weak provider-level PotentialFraud labels",
    labelWarning: "PotentialFraud is provider-level weak risk evidence and is never copied into claim-level actualFraud.",
    amountNormalization: {
      version: AMOUNT_NORMALIZATION_VERSION,
      divisorUsdPerDemoUnit: AMOUNT_NORMALIZATION_DIVISOR,
      note: "Research normalization, not a currency exchange rate.",
    },
    splitPolicy: "Provider-disjoint stable hash split: 64% train, 16% calibration, 20% test",
    injectionPolicy: {
      version: SCENARIO_VERSION,
      trainRate: 0.12,
      calibrationRate: 0.12,
      testUntouchedRate: 0,
      testAttacksRate: 0.5,
      scenarios: CLAIM_SCENARIOS,
    },
    sourceCounts,
    totalUniqueClaims: uniqueClaimIds.size,
    providers: providerLabels.size,
    beneficiaries: beneficiaries.size,
    amountRangesUsd: amountRanges,
    velocityThresholds: {
      providerClaimCountP95: providerVelocityThreshold,
      beneficiaryClaimCountP95: claimantVelocityThreshold,
    },
    counts: manifestCounts,
    sourceFiles,
    outputFiles,
    outputSha256: hashes,
  };
  fs.writeFileSync(path.join(DATASET_DIR, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
};

if (require.main === module) {
  buildHybridDataset()
    .then((manifest) => console.log(JSON.stringify(manifest, null, 2)))
    .catch((error) => {
      console.error("Hybrid dataset build failed:", error.message);
      process.exit(1);
    });
}

module.exports = { buildHybridDataset, readCsv };
