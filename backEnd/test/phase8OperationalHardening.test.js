const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { atomicWriteFileSync } = require("../services/researchArtifactService");
const { run: buildChartManifest, sha256File } = require("../scripts/generateChartManifest");

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
  ]) assert.ok(scripts[command], `${command} is missing`);
  assert.match(scripts["research:all"], /research:artifacts/);
  assert.match(scripts["verify:all"], /runVerification\.js/);
});

test("managed launcher has bootstrap, readiness, and fail-fast child supervision", () => {
  const source = fs.readFileSync(path.join(projectRoot, "scripts", "devAll.js"), "utf8");
  assert.match(source, /--bootstrap/);
  assert.match(source, /waitForHttp/);
  assert.match(source, /stopped unexpectedly/);
  assert.match(source, /setup:local/);
  assert.match(source, /npm-cli\.js/);
  assert.doesNotMatch(source, /npm\.cmd/);
});
