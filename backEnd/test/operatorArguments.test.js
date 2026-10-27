const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), { spawnSync } = require("node:child_process");
const { parseOperatorArguments } = require("../../scripts/operatorArguments");
const root = path.resolve(__dirname, "../..");
test("operator flags reject typo, duplicate, missing and positional arguments before selecting an operation", () => {
  const schema = { values: ["--manifest", "--expect"], switches: ["--apply", "--rollback"], required: ["--manifest"] };
  assert.deepEqual(parseOperatorArguments(["--manifest", "local.json", "--rollback", "--apply", "--expect", "identity"], schema),
    { "--manifest": "local.json", "--rollback": true, "--apply": true, "--expect": "identity" });
  for (const args of [["--manifest", "local.json", "--rollbak", "--apply"], ["--manifest", "local.json", "--apply", "--apply"],
    ["--manifest", "--apply"], ["--manifest"], ["--manifest", "local.json", "extra"], [], ["--manifest", "local.json", "--expect"]]) {
    assert.throws(() => parseOperatorArguments(args, schema));
  }
});
test("measurement refuses existing JSON/CSV or ambiguous output extensions without contacting RPC or altering files", () => {
  const directory = fs.mkdtempSync(path.join(root, "tmp", "measurement-guard-"));
  try {
    const output = path.join(directory, "receipt.json"), csv = path.join(directory, "receipt.csv");
    const run = (target) => spawnSync(process.execPath, [path.join(root, "scripts/networkMeasurement.js"),
      "--manifest", path.join(directory, "missing-manifest.json"), "--transactions", path.join(directory, "missing-input.json"), "--output", target],
    { cwd: root, env: { ...process.env, RPC_URL: "http://127.0.0.1:1" }, encoding: "utf8", timeout: 5000, windowsHide: true });
    fs.writeFileSync(output, "original-json"); assert.equal(run(output).status, 1); assert.equal(fs.readFileSync(output, "utf8"), "original-json");
    fs.unlinkSync(output); fs.writeFileSync(csv, "original-csv");
    assert.equal(run(output).status, 1); assert.equal(fs.existsSync(output), false); assert.equal(fs.readFileSync(csv, "utf8"), "original-csv");
    assert.equal(run(path.join(directory, "receipt.csv")).status, 1);
    assert.deepEqual(fs.readdirSync(directory), ["receipt.csv"]);
  } finally {
    assert.ok(path.resolve(directory).startsWith(path.join(root, "tmp") + path.sep));
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
