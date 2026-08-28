const fs = require("node:fs");
const path = require("node:path");
const MockHospitalRecord = require("../models/MockHospitalRecord");
const { extractRecordFeatures, FEATURE_NAMES } = require("../services/featureEngineeringService");
const { buildMerkleTree } = require("../services/merkleRegistryService");
const { hashInvoiceNumber } = require("../services/hybridDatasetAdapterService");
const { buildHybridRuntimeRecords } = require("./seedHybridData");

const MANIFEST_PATH = path.join(__dirname, "..", "datasets", "hybrid-v1", "manifest.json");

const validateHybridDataset = async () => {
  if (!fs.existsSync(MANIFEST_PATH)) {
    throw new Error("Hybrid manifest is missing. Run npm run build:hybrid first.");
  }
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
  const records = await buildHybridRuntimeRecords();
  const invoiceNumbers = new Set();
  const invoiceHashes = new Set();
  let hybridRecords = 0;
  let publicPotentialFraudClaims = 0;
  let injectedClaims = 0;

  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    try {
      await MockHospitalRecord.validate(record);
    } catch (error) {
      throw new Error(`Runtime record ${index + 1} failed schema validation: ${error.message}`);
    }
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
    if (record.datasetProfile === "blockinsure-hybrid-v1") {
      hybridRecords += 1;
      if (record.providerPotentialFraud) publicPotentialFraudClaims += 1;
      if (record.scenarioInjected) injectedClaims += 1;
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
  const tree = buildMerkleTree(records);
  if (!tree.rootHash || tree.leafCount !== records.length) {
    throw new Error("Hybrid runtime Merkle tree validation failed");
  }

  return {
    datasetVersion: manifest.datasetVersion,
    runtimeRecords: records.length,
    preservedDemoPresets: records.length - hybridRecords,
    hybridRecords,
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
