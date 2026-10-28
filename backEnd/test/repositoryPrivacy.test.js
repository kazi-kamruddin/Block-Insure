const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { main: snapshot } = require("../../scripts/prepareReleaseCandidate");
const { compareResearchManifests } = require("../../scripts/verifyRepository");
const { sourceDifferences, verifySourceTransition } = require("../../scripts/researchSourceTransition");

function fixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "block-insure-public-snapshot-"));
  const files = [];
  const write = (name, contents) => {
    const target = path.join(directory, name);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, contents);
    if (!files.includes(name)) files.push(name);
  };
  write("README.md", "Public setup\n");
  write("docs/local-development.md", "Local setup\n");
  write("oracle/runtimeProtocol.js", "module.exports = {};\n");
  write("backEnd/artifacts/xgboost-advisory-manifest.json", JSON.stringify({ files: { "oracle/runtimeProtocol.js": "fixture" } }));
  const options = { projectRoot: directory, log() {}, runGit(_root, args) {
    if (args[0] === "ls-files") return files.join("\n");
    if (args[0] === "rev-parse") return "fixture-revision";
    if (args[0] === "status") return "";
    throw new Error("Unexpected Git operation");
  } };
  return { directory, write, options, cleanup() {
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(directory).startsWith("block-insure-public-snapshot-"));
    fs.rmSync(directory, { recursive: true, force: true });
  } };
}

test("source snapshots work without private documents or historical reports and detect source changes", () => {
  const f = fixture();
  try {
    const output = "verification-results/source-only.json";
    const record = snapshot(["--output", output], f.options);
    assert.deepEqual(record.evidence, {});
    assert.ok(record.files["README.md"]);
    assert.ok(record.files["docs/local-development.md"]);
    assert.equal(snapshot(["--check", output], f.options).sourceIdentity, record.sourceIdentity);
    f.write("oracle/runtimeProtocol.js", "module.exports = { changed: true };\n");
    assert.throws(() => snapshot(["--check", output], f.options), /Release snapshot changed/);
  } finally { f.cleanup(); }
});

test("source selection excludes private handoffs, reports and environment files even when listed by Git", () => {
  const f = fixture();
  try {
    for (const name of ["docs/manual-next-steps.md", "docs/shadow-release-assurance.md", "backEnd/.env", "verification-results/private-report.json"]) f.write(name, "private fixture");
    const record = snapshot(["--output", "verification-results/public-source.json"], f.options);
    assert.deepEqual(record.evidence, {});
    for (const name of Object.keys(record.files)) assert.doesNotMatch(name, /manual-next-steps|shadow-release|\.env$|verification-results/);
  } finally { f.cleanup(); }
});

test("explicit evidence stays hash-bound and existing snapshots cannot be overwritten", () => {
  const f = fixture();
  try {
    const output = "verification-results/with-evidence.json";
    const evidence = "verification-results/selected.json";
    f.write(evidence, '{"passed":true}\n');
    const record = snapshot(["--output", output, "--evidence", evidence], f.options);
    assert.deepEqual(Object.keys(record.evidence), [evidence]);
    const before = fs.readFileSync(path.join(f.directory, output), "utf8");
    assert.throws(() => snapshot(["--output", output], f.options), /EEXIST/);
    assert.equal(fs.readFileSync(path.join(f.directory, output), "utf8"), before);
    f.write(evidence, '{"passed":false}\n');
    assert.throws(() => snapshot(["--check", output], f.options), /Release evidence changed/);
    assert.throws(() => snapshot(["--evidence", "verification-results/missing.json"], f.options), /Selected verification evidence is missing/);
  } finally { f.cleanup(); }
});

test("snapshot argument errors are rejected before inspecting the repository", () => {
  const options = { runGit() { throw new Error("Git must not be called"); } };
  for (const args of [["--outpt", "value"], ["--output"], ["--output", "a", "--output", "b"], ["unexpected"],
    ["--check", "record.json", "--output", "verification-results/other.json"], ["--output", "../outside.json"]]) {
    assert.throws(() => snapshot(args, options), (error) => !error.message.includes("Git must not be called"));
  }
});

test("research checks distinguish bookkeeping changes while preserving runtime, study and artifact bindings", () => {
  const recorded = { implementation: { "scripts/prepareReleaseCandidate.js": "old-release", "scripts/verifyRepository.js": "old-checker",
    "backEnd/research/context.js": "context", "backEnd/services/riskScoringService.js": "runtime" }, artifacts: { model: "frozen" } };
  const current = structuredClone(recorded);
  current.implementation["scripts/prepareReleaseCandidate.js"] = "new-release";
  current.implementation["scripts/verifyRepository.js"] = "new-checker";
  const before = JSON.stringify(recorded);
  const result = compareResearchManifests(recorded, current);
  assert.equal(result.matches, true);
  assert.deepEqual(result.metadataToolingChanges, ["scripts/prepareReleaseCandidate.js", "scripts/verifyRepository.js"]);
  for (const name of ["backEnd/research/context.js", "backEnd/services/riskScoringService.js"]) {
    const changed = structuredClone(current); changed.implementation[name] = "changed";
    assert.equal(compareResearchManifests(recorded, changed).matches, false);
  }
  const changedArtifact = structuredClone(current); changedArtifact.artifacts.model = "changed";
  assert.equal(compareResearchManifests(recorded, changedArtifact).matches, false);
  assert.equal(JSON.stringify(recorded), before);
});

test("reviewed source transitions bind exact deltas and preserve historical evidence", () => {
  const recorded = { reproducibilityHash: "historical", implementation: { "runtime.js": "old" },
    artifacts: { model: "frozen", evaluation: "original" } };
  const current = structuredClone(recorded);
  current.implementation["runtime.js"] = "reviewed";
  const receipt = { schemaVersion: 1, historicalManifestSha256: "file-hash",
    historicalReproducibilityHash: "historical", evidenceStatus: "HISTORICAL_NOT_REVALIDATED",
    changes: sourceDifferences(recorded, current).map((change) => ({ ...change, reason: "Reviewed runtime migration" })) };
  const before = JSON.stringify(recorded);
  assert.equal(verifySourceTransition(recorded, current, receipt, "file-hash"), true);
  assert.equal(verifySourceTransition(recorded, current, receipt, "different-file"), false);
  for (const field of ["model", "evaluation"]) {
    const changed = structuredClone(current); changed.artifacts[field] = "unreviewed";
    assert.equal(verifySourceTransition(recorded, changed, receipt, "file-hash"), false);
  }
  const extra = structuredClone(current); extra.implementation["runtime.js"] = "unreviewed";
  assert.equal(verifySourceTransition(recorded, extra, receipt, "file-hash"), false);
  const rewritten = structuredClone(recorded); rewritten.reproducibilityHash = "rewritten";
  assert.equal(verifySourceTransition(rewritten, current, receipt, "file-hash"), false);
  assert.equal(verifySourceTransition(recorded, current, { ...receipt, changes: [] }, "file-hash"), false);
  assert.equal(JSON.stringify(recorded), before);
});
