const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  atomicWriteFileSync,
  calculateReproducibilityHash,
} = require("../services/researchArtifactService");
const { run: buildChartManifest, sha256File } = require("../scripts/generateChartManifest");
const {
  researchManifestReproducibilityBasis,
} = require("../scripts/generateResearchManifest");

const projectRoot = path.resolve(__dirname, "..", "..");

test("atomic research writes replace complete files without temporary leftovers", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "block-insure-atomic-"));
  try {
    const target = path.join(directory, "artifact.json");
    atomicWriteFileSync(target, '{"version":1}\n');
    atomicWriteFileSync(target, '{"version":2}\n');
    assert.deepEqual(JSON.parse(fs.readFileSync(target, "utf8")), { version: 2 });
    assert.deepEqual(fs.readdirSync(directory), ["artifact.json"]);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("chart manifest covers every generated PNG and SVG with exact hashes", () => {
  const manifest = buildChartManifest({ writeOutput: false });
  const chartDirectory = path.join(projectRoot, "backEnd", "evaluation-results", "evaluation-charts");
  const files = fs.readdirSync(chartDirectory).filter((file) => /\.(png|svg)$/i.test(file)).sort();
  assert.deepEqual(manifest.charts.map((chart) => chart.file), files);
  for (const chart of manifest.charts) {
    assert.equal(sha256File(path.join(chartDirectory, chart.file)), chart.sha256);
    assert.ok(chart.bytes > 0);
  }
});

test("research manifest identity ignores machine and Git checkout provenance", () => {
  const base = {
    schemaVersion: 4,
    generatedAt: "2026-01-01T00:00:00.000Z",
    source: { gitCommit: "a".repeat(40), branch: "main", dirty: false },
    environment: {
      node: "v20.19.0",
      platform: "linux",
      architecture: "x64",
      solidity: "0.8.26",
      optimizerRuns: 1,
    },
    artifacts: { fraudModel: { artifactHash: "model-v1" } },
  };
  const differentCheckout = {
    ...base,
    source: { gitCommit: "b".repeat(40), branch: "review", dirty: true },
    environment: {
      ...base.environment,
      node: "v22.12.0",
      platform: "win32",
      architecture: "arm64",
    },
  };

  const baseHash = calculateReproducibilityHash(
    researchManifestReproducibilityBasis(base)
  );
  assert.equal(
    baseHash,
    calculateReproducibilityHash(
      researchManifestReproducibilityBasis(differentCheckout)
    )
  );
  assert.notEqual(
    baseHash,
    calculateReproducibilityHash(
      researchManifestReproducibilityBasis({
        ...base,
        artifacts: { fraudModel: { artifactHash: "model-v2" } },
      })
    )
  );
});

test("root orchestration exposes clean install, bootstrap, research, and verification commands", () => {
  const scripts = JSON.parse(fs.readFileSync(path.join(projectRoot, "package.json"), "utf8")).scripts;
  for (const command of [
    "install:all",
    "dev:bootstrap",
    "research:all",
    "verify:repository",
    "verify:all",
    "verify:full",
    "doctor",
    "test:e2e:list:isolated",
  ]) assert.ok(scripts[command], `${command} is missing`);
  assert.match(scripts["research:all"], /research:artifacts/);
  assert.match(scripts["verify:all"], /runVerification\.js/);
  assert.match(scripts["test:e2e:list:isolated"], /runIsolatedE2E\.js test:e2e:list/);
  assert.match(scripts["test:e2e:unfinished:claims"], /--grep-invert/);
  assert.doesNotMatch(scripts["test:e2e:unfinished:claims"], /--grep /);
});

test("contract coverage restores non-instrumented build artifacts", () => {
  const contractsPackage = JSON.parse(
    fs.readFileSync(path.join(projectRoot, "contracts", "package.json"), "utf8")
  );
  const coverageRunner = fs.readFileSync(
    path.join(projectRoot, "contracts", "scripts", "runCoverage.js"),
    "utf8"
  );

  assert.equal(contractsPackage.scripts.coverage, "node scripts/runCoverage.js");
  assert.match(coverageRunner, /\["compile", "--force"\]/);
  assert.match(coverageRunner, /coverage\.status !== 0/);
  assert.match(coverageRunner, /restore\.status !== 0/);
});

test("managed launcher has bootstrap, readiness, and fail-fast child supervision", () => {
  const source = fs.readFileSync(path.join(projectRoot, "scripts", "devAll.js"), "utf8");
  assert.match(source, /--bootstrap/);
  assert.match(source, /waitForHttp/);
  assert.match(source, /stopped unexpectedly/);
  assert.match(source, /setup:local/);
  assert.match(source, /await runCommand\("\."/);
  assert.match(source, /E2E_BACKEND_RPC_URL/);
  assert.match(source, /dev:rpc-proxy/);
  assert.match(source, /npm-cli\.js/);
  assert.doesNotMatch(source, /npm\.cmd/);
});

test("isolated E2E launcher supports and enforces a loopback MongoDB override", () => {
  const source = fs.readFileSync(
    path.join(projectRoot, "scripts", "runIsolatedE2E.js"),
    "utf8"
  );
  assert.match(source, /E2E_MONGODB_URI/);
  assert.match(source, /E2E_REQUIRE_LOCAL_MONGO/);
  assert.match(source, /requires a loopback MongoDB host/);
  assert.match(source, /mongoUrl\.pathname = "\/block_insure_e2e"/);
  assert.match(source, /E2E_RPC_PROXY/);
  assert.match(source, /E2E_PINATA_API_URL/);
  assert.match(source, /PINATA_API_BASE_URL: e2ePinataBaseUrl/);
  assert.match(source, /VITE_IPFS_GATEWAY: `\$\{e2ePinataBaseUrl\}\/ipfs\/`/);
  assert.match(source, /PINATA_JWT: process\.env\.E2E_PINATA_JWT/);
});

test("isolated E2E launcher forwards narrow test arguments", () => {
  const launcher = fs.readFileSync(
    path.resolve(__dirname, "../../scripts/runIsolatedE2E.js"),
    "utf8"
  );
  assert.match(launcher, /const scriptArguments = process\.argv\.slice\(3\)/);
  assert.match(launcher, /\[npmCli, "run", scriptName, \.\.\.scriptArguments\]/);
});
