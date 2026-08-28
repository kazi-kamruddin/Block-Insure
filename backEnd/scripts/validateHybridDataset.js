const fs = require("node:fs");
const crypto = require("node:crypto");
const path = require("node:path");
const MockHospitalRecord = require("../models/MockHospitalRecord");
const { extractRecordFeatures, FEATURE_NAMES } = require("../services/featureEngineeringService");
const { buildMerkleTree } = require("../services/merkleRegistryService");
const { hashInvoiceNumber } = require("../services/hybridDatasetAdapterService");
const { buildHybridRuntimeRecords, loadHybridManifest } = require("./seedHybridData");

const MANIFEST_PATH = path.join(__dirname, "..", "datasets", "hybrid-v1", "manifest.json");
const RUNTIME_PATH = path.join(
  __dirname,
  "..",
  "datasets",
  "hybrid-v1",
  "runtime",
  "hybrid-primary.jsonl"
);

const sha256File = async (filePath) => {
  const hash = crypto.createHash("sha256");
  for await (const chunk of fs.createReadStream(filePath)) hash.update(chunk);
  return hash.digest("hex");
};

const validateHybridDataset = async () => {
  if (!fs.existsSync(MANIFEST_PATH)) {
    throw new Error("Hybrid manifest is missing. Run npm run build:hybrid first.");
  }
  const manifest = loadHybridManifest();
  const runtimeHash = await sha256File(RUNTIME_PATH);
  if (runtimeHash !== manifest.outputSha256.runtimeHybrid) {
    throw new Error("Hybrid runtime file hash does not match the manifest");
  }
  const records = await buildHybridRuntimeRecords();
  const invoiceNumbers = new Set();
  const invoiceHashes = new Set();
  let hybridRecords = 0;
  let publicPotentialFraudClaims = 0;
  let injectedClaims = 0;
  const claimSettingCounts = { INPATIENT: 0, OUTPATIENT: 0 };
  const normalizedRecords = [];

  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    const document = new MockHospitalRecord(record);
    try {
      await document.validate();
    } catch (error) {
      throw new Error(`Runtime record ${index + 1} failed schema validation: ${error.message}`);
    }
    normalizedRecords.push(document.toObject({ versionKey: false }));
    if (invoiceNumbers.has(record.invoiceNumber)) {
      throw new Error(`Duplicate runtime invoice number: ${record.invoiceNumber}`);
    }
    if (invoiceHashes.has(record.invoiceHash)) {
      throw new Error(`Duplicate runtime invoice hash: ${record.invoiceHash}`);
    }
    invoiceNumbers.add(record.invoiceNumber);
    invoiceHashes.add(record.invoiceHash);
    if (record.invoiceHash !== hashInvoiceNumber(record.invoiceNumber)) {
      throw new Error(`Invoice hash convention mismatch: ${record.invoiceNumber}`);
    }
    const features = extractRecordFeatures(record);
    if (Object.keys(features).length !== FEATURE_NAMES.length) {
      throw new Error(`Feature extraction mismatch: ${record.recordId}`);
    }
    if (record.datasetProfile === manifest.datasetVersion) {
      hybridRecords += 1;
      if (record.providerPotentialFraud) publicPotentialFraudClaims += 1;
      if (record.scenarioInjected) injectedClaims += 1;
      claimSettingCounts[record.claimSetting] += 1;
      if (record.baseDataOrigin !== "PUBLIC_SECONDARY") {
        throw new Error(`Unexpected hybrid base-data origin: ${record.recordId}`);
      }
      if (Boolean(record.actualFraud) !== Boolean(record.scenarioInjected)) {
        throw new Error(`Claim/scenario truth separation failed: ${record.recordId}`);
      }
    }
  }

  if (hybridRecords !== manifest.counts.runtimeHybrid) {
    throw new Error(
      `Runtime hybrid count mismatch: expected ${manifest.counts.runtimeHybrid}, found ${hybridRecords}`
    );
  }
  if (!claimSettingCounts.INPATIENT || !claimSettingCounts.OUTPATIENT) {
    throw new Error("Hybrid runtime sample must contain inpatient and outpatient claims");
  }
  const tree = buildMerkleTree(normalizedRecords);
  if (!tree.rootHash || tree.leafCount !== normalizedRecords.length) {
    throw new Error("Hybrid runtime Merkle tree validation failed");
  }

  return {
    datasetVersion: manifest.datasetVersion,
    runtimeRecords: records.length,
    preservedDemoPresets: records.length - hybridRecords,
    hybridRecords,
    claimSettingCounts,
    publicPotentialFraudClaims,
    injectedClaims,
    uniqueInvoiceNumbers: invoiceNumbers.size,
    featureCount: FEATURE_NAMES.length,
    merkleRoot: tree.rootHash,
    merkleLeaves: tree.leafCount,
    status: "VALID",
  };
};

if (require.main === module) {
  validateHybridDataset()
    .then((result) => console.log(JSON.stringify(result, null, 2)))
    .catch((error) => {
      console.error("Hybrid dataset validation failed:", error.message);
      process.exit(1);
    });
}

module.exports = { validateHybridDataset };
