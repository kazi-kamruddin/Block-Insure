const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { HYBRID_DATASET_VERSION } = require("./hybridDatasetAdapterService");

const DATASET_DIR = path.join(__dirname, "..", "datasets", "hybrid-v1");
const MANIFEST_PATH = path.join(DATASET_DIR, "manifest.json");

const inspectFile = async (filePath, { countLines = false } = {}) => {
  if (!fs.existsSync(filePath)) throw new Error(`Required hybrid artifact is missing: ${filePath}`);
  const hash = crypto.createHash("sha256");
  let bytes = 0;
  let lines = 0;
  let lastByteWasNewline = true;
  for await (const chunk of fs.createReadStream(filePath)) {
    hash.update(chunk);
    bytes += chunk.length;
    if (countLines) {
      for (const byte of chunk) if (byte === 10) lines += 1;
      lastByteWasNewline = chunk.at(-1) === 10;
    }
  }
  if (countLines && bytes > 0 && !lastByteWasNewline) lines += 1;
  return { bytes, lines: countLines ? lines : undefined, sha256: hash.digest("hex") };
};

const loadHybridManifest = () => {
  if (!fs.existsSync(MANIFEST_PATH)) {
    throw new Error("Hybrid manifest is missing. Run npm run build:hybrid first.");
  }
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
  if (manifest.manifestSchemaVersion !== 3) {
    throw new Error(`Hybrid manifest schema ${manifest.manifestSchemaVersion} is stale; expected 3.`);
  }
  if (manifest.datasetVersion !== HYBRID_DATASET_VERSION) {
    throw new Error(
      `Hybrid manifest version ${manifest.datasetVersion} is stale; expected ${HYBRID_DATASET_VERSION}. Run npm run build:hybrid.`
    );
  }
  return manifest;
};

const verifyRuntimeArtifact = async (manifest = loadHybridManifest()) => {
  const relativePath = manifest.outputFiles.runtimeHybrid;
  const result = await inspectFile(path.join(DATASET_DIR, relativePath), { countLines: true });
  if (result.sha256 !== manifest.outputSha256.runtimeHybrid) {
    throw new Error("Hybrid runtime file hash does not match the manifest");
  }
  if (result.lines !== manifest.counts.runtimeHybrid) {
    throw new Error(`Hybrid runtime line count ${result.lines} does not match ${manifest.counts.runtimeHybrid}`);
  }
  return result;
};

const verifyHybridArtifacts = async () => {
  const manifest = loadHybridManifest();
  const sourceResults = {};
  for (const [fileName, expected] of Object.entries(manifest.sourceFiles || {})) {
    const result = await inspectFile(path.join(DATASET_DIR, "raw", fileName));
    if (result.bytes !== expected.bytes || result.sha256 !== expected.sha256) {
      throw new Error(`Raw hybrid source integrity failed: ${fileName}`);
    }
    sourceResults[fileName] = result;
  }

  const outputResults = {};
  for (const [key, relativePath] of Object.entries(manifest.outputFiles || {})) {
    const result = await inspectFile(path.join(DATASET_DIR, relativePath), { countLines: true });
    if (result.sha256 !== manifest.outputSha256[key]) {
      throw new Error(`Generated hybrid artifact hash mismatch: ${relativePath}`);
    }
    const expectedLines = manifest.counts[key];
    if (Number.isFinite(expectedLines) && result.lines !== expectedLines) {
      throw new Error(`Generated hybrid artifact row mismatch: ${relativePath}`);
    }
    outputResults[key] = result;
  }
  return { manifest, sourceResults, outputResults };
};

module.exports = {
  DATASET_DIR,
  MANIFEST_PATH,
  inspectFile,
  loadHybridManifest,
  verifyHybridArtifacts,
  verifyRuntimeArtifact,
};
