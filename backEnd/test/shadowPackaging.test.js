const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), { spawnSync } = require("node:child_process");
const root = path.resolve(__dirname, "../..");
test("portable worker advisory loads with no backend node_modules or Python environment", () => {
  const target = fs.mkdtempSync(path.join(root, "tmp", "shadow-package-"));
  try {
    const manifestName = "backEnd/artifacts/xgboost-advisory-manifest.json";
    const manifest = require("../artifacts/xgboost-advisory-manifest.json");
    for (const file of [...Object.keys(manifest.files), manifestName]) {
      const destination = path.resolve(target, file);
      assert.ok(destination.startsWith(target + path.sep));
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.copyFileSync(path.join(root, file), destination);
    }
    const valid = spawnSync(process.execPath, ["-e", "require('./oracle/shadowAssessment'); require('./oracle/advisoryBundle').loadAdvisoryBundle();"], { cwd: target, encoding: "utf8", windowsHide: true });
    assert.equal(valid.status, 0, valid.stderr);
    fs.appendFileSync(path.join(target, "oracle/xgboostAssessment.js"), "\n// unexpected modification\n");
    const invalid = spawnSync(process.execPath, ["-e", "require('./oracle/advisoryBundle').loadAdvisoryBundle();"], { cwd: target, encoding: "utf8", windowsHide: true });
    assert.notEqual(invalid.status, 0); assert.match(invalid.stderr, /identity mismatch/);
  } finally {
    assert.ok(path.resolve(target).startsWith(path.join(root, "tmp") + path.sep));
    fs.rmSync(target, { recursive: true, force: true });
  }
});
test("both container recipes include every hashed shared inference source", () => {
  const manifest = require("../artifacts/xgboost-advisory-manifest.json");
  for (const dockerfile of ["deploy/backend.Dockerfile", "deploy/oracle.Dockerfile"]) {
    const copy = fs.readFileSync(path.join(root, dockerfile), "utf8").split(/\r?\n/).filter((line) => /^COPY /.test(line))
      .flatMap((line) => line.split(/\s+/).slice(1, -1).filter((part) => !part.startsWith("--")));
    for (const file of [...Object.keys(manifest.files), "backEnd/artifacts/xgboost-advisory-manifest.json"]) {
      assert.ok(copy.some((source) => file === source || fs.statSync(path.join(root, source)).isDirectory() && file.startsWith(source + "/")), `${dockerfile} missing ${file}`);
    }
  }
});
