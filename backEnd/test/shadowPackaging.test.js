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
    for (const file of [...Object.keys(manifest.files), "backEnd/artifacts/xgboost-advisory-manifest.json",
      "backEnd/artifacts/xgboost-protocol-v1.json", ...require("../../oracle/runtimeProtocol").SOURCES]) {
      assert.ok(copy.some((source) => file === source || fs.statSync(path.join(root, source)).isDirectory() && file.startsWith(source + "/")), `${dockerfile} missing ${file}`);
    }
  }
});
test("shared result hashing resolves the API-only ethers installation without oracle node_modules", () => {
  const target = fs.mkdtempSync(path.join(root, "tmp", "protocol-package-"));
  try {
    fs.mkdirSync(path.join(target, "oracle"));
    fs.copyFileSync(path.join(root, "oracle/protocol.js"), path.join(target, "oracle/protocol.js"));
    const installed = path.join(target, "backEnd/node_modules/ethers");
    fs.mkdirSync(installed, { recursive: true });
    // An API-local package entry delegates to the installed real implementation;
    // no Oracle dependency tree or global module path is supplied to the child.
    fs.writeFileSync(path.join(installed, "index.js"), `module.exports = require(${JSON.stringify(require.resolve("ethers"))});`);
    const program = "const {buildResultHash}=require('./oracle/protocol'); const {ethers}=require('./backEnd/node_modules/ethers'); " +
      "console.log(buildResultHash({request:{requestId:1,claimId:1,queryHash:ethers.ZeroHash,claimVersion:1,registryVersion:1,registryRoot:ethers.ZeroHash,modelVersion:ethers.ZeroHash},verified:false,verificationCode:'TEST',leafHash:ethers.ZeroHash}));";
    const result = spawnSync(process.execPath, ["-e", program], { cwd: target, encoding: "utf8", windowsHide: true });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout.trim(), /^0x[a-f0-9]{64}$/);
    assert.equal(fs.existsSync(path.join(target, "oracle/node_modules")), false);
  } finally {
    assert.ok(path.resolve(target).startsWith(path.join(root, "tmp") + path.sep));
    fs.rmSync(target, { recursive: true, force: true });
  }
});
