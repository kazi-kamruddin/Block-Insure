// Explicit isolated-chain test; excluded from the ordinary *.test.js unit run.
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const { spawn, spawnSync } = require("node:child_process");
const { HDNodeWallet } = require("ethers");
const { HARDHAT_NETWORK_MNEMONIC } = require("../../contracts/node_modules/hardhat/internal/core/config/default-config");
const root = path.resolve(__dirname, "../..");
test("isolated CLI migration enforces expected identity and signer authority across promotion and rollback", {
  skip: process.env.RUN_ISOLATED_CHAIN_TESTS !== "true", timeout: 90000,
}, async () => {
  const rpcUrl = "http://127.0.0.1:8545";
  try { await fetch(rpcUrl, { signal: AbortSignal.timeout(500) }); throw new Error("RPC port occupied; refusing to attach"); }
  catch (error) { if (error.message.includes("occupied")) throw error; }
  const directory = fs.mkdtempSync(path.join(root, "tmp", "protocol-cli-"));
  const wallet = (index) => HDNodeWallet.fromPhrase(HARDHAT_NETWORK_MNEMONIC, undefined, `m/44'/60'/0'/0/${index}`);
  const environment = { ...process.env, ADMIN_PRIVATE_KEY: wallet(0).privateKey, RPC_URL: rpcUrl, DEPLOY_WRITE_ENV: "false",
    DEPLOYMENT_OUTPUT_DIR: directory, RAYON_NUM_THREADS: "2", UV_THREADPOOL_SIZE: "2",
    APPDATA: path.join(root, ".hardhat-appdata"), LOCALAPPDATA: path.join(root, ".hardhat-localappdata") };
  const names = ["backEnd/.env", "frontEnd/.env", "contracts/.env", "oracle/.env", "oracle/.env.oracle2", "contracts/deployments/localhost-31337.json"];
  const hashes = () => Object.fromEntries(names.filter((name) => fs.existsSync(path.join(root, name)))
    .map((name) => [name, crypto.createHash("sha256").update(fs.readFileSync(path.join(root, name))).digest("hex")]));
  const before = hashes();
  const cli = path.join(root, "contracts/node_modules/hardhat/internal/cli/cli.js");
  const child = spawn(process.execPath, [cli, "node", "--hostname", "127.0.0.1"], {
    cwd: path.join(root, "contracts"), env: environment, windowsHide: true, stdio: "ignore",
  });
  const rpc = async (method, params = []) => {
    const response = await fetch(rpcUrl, { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }), signal: AbortSignal.timeout(2000) });
    const body = await response.json(); if (body.error) throw new Error("Local RPC request failed"); return body.result;
  };
  const run = (args, cwd = root, extra = {}) => spawnSync(process.execPath, args, {
    cwd, env: { ...environment, ...extra }, windowsHide: true, encoding: "utf8", timeout: 40000, maxBuffer: 2 * 1024 * 1024,
  });
  try {
    const deadline = Date.now() + 15000;
    for (;;) {
      try { if (await rpc("eth_chainId") === "0x7a69") break; } catch { /* bounded startup */ }
      if (child.exitCode !== null || Date.now() > deadline) throw new Error("Isolated Hardhat did not start");
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    const deployed = run([cli, "run", "scripts/deploy.js", "--network", "localhost"], path.join(root, "contracts"));
    assert.equal(deployed.status, 0, "Isolated deployment failed; no saved deployment was used");
    const manifest = path.join(directory, "localhost-31337.json"), script = path.join(root, "scripts/migrateProtocolModel.js");
    const deployment = JSON.parse(fs.readFileSync(manifest));
    const block = await rpc("eth_getBlockByNumber", [`0x${Number(deployment.deploymentBlock).toString(16)}`, false]);
    const input = path.join(directory, "transactions.json"), output = path.join(directory, "measurement.json");
    fs.writeFileSync(input, JSON.stringify([{ operation: "InsuranceManager local deployment", transactionHash: block.transactions[0] }]));
    const beforeMeasurement = await rpc("eth_getTransactionCount", [wallet(0).address, "latest"]);
    const measured = run([path.join(root, "scripts/networkMeasurement.js"), "--manifest", manifest, "--transactions", input, "--output", output]);
    assert.equal(measured.status, 0); assert.equal(await rpc("eth_getTransactionCount", [wallet(0).address, "latest"]), beforeMeasurement);
    const measurement = JSON.parse(fs.readFileSync(output));
    assert.equal(measurement.rows.length, 1); assert.ok(BigInt(measurement.rows[0].gasUsed) > 0n);
    assert.equal(measurement.rows[0].successful, true); assert.ok(fs.existsSync(output.replace(/\.json$/, ".csv")));
    const originalMeasurement = fs.readFileSync(output, "utf8");
    const repeatedMeasurement = run([path.join(root, "scripts/networkMeasurement.js"), "--manifest", manifest, "--transactions", input, "--output", output]);
    assert.notEqual(repeatedMeasurement.status, 0); assert.equal(fs.readFileSync(output, "utf8"), originalMeasurement);
    const migrate = (args = [], extra = {}) => run([script, "--manifest", manifest, ...args], root, extra);
    const active = require("../../oracle/runtimeProtocol").loadProtocolArtifact();
    const dry = migrate(); assert.equal(dry.status, 0); assert.equal(JSON.parse(dry.stdout).transactionSent, false);
    const rollback = migrate(["--rollback", "--apply", "--expect", active.modelIdentityHash]);
    assert.equal(rollback.status, 0); assert.equal(JSON.parse(rollback.stdout).to, active.legacyModelIdentityHash);
    assert.equal(JSON.parse(rollback.stdout).transactionSent, true);
    const promote = migrate(["--apply", "--expect", active.legacyModelIdentityHash]);
    assert.equal(promote.status, 0); assert.equal(JSON.parse(promote.stdout).to, active.modelIdentityHash);
    assert.equal(JSON.parse(promote.stdout).transactionSent, true);
    const historical = require("../../oracle/runtimeProtocol").loadHistoricalProtocolArtifact();
    const managerInterface = new (require("ethers").Interface)(require("../abi/InsuranceManager.json").abi);
    await rpc("eth_sendTransaction", [{ from: wallet(0).address, to: deployment.components.InsuranceManager,
      data: managerInterface.encodeFunctionData("updateOracleModelVersion", [historical.modelIdentityHash]) }]);
    const fromV4 = migrate(); assert.equal(fromV4.status, 0);
    assert.equal(JSON.parse(fromV4.stdout).from, historical.modelIdentityHash);
    assert.equal(JSON.parse(fromV4.stdout).transactionSent, false);
    const promotedV4 = migrate(["--apply", "--expect", historical.modelIdentityHash]);
    assert.equal(promotedV4.status, 0); assert.equal(JSON.parse(promotedV4.stdout).to, active.modelIdentityHash);
    assert.equal(JSON.parse(promotedV4.stdout).transactionSent, true);
    const nonce = await rpc("eth_getTransactionCount", [wallet(0).address, "latest"]);
    assert.notEqual(migrate(["--rollback", "--apply", "--expect", active.legacyModelIdentityHash]).status, 0);
    assert.notEqual(migrate(["--rollbak", "--apply", "--expect", active.modelIdentityHash]).status, 0);
    assert.notEqual(migrate(["--rollback", "--apply", "--expect"]).status, 0);
    assert.notEqual(migrate(["--rollback", "--apply", "--expect", active.modelIdentityHash], { ADMIN_PRIVATE_KEY: wallet(1).privateKey }).status, 0);
    assert.equal(await rpc("eth_getTransactionCount", [wallet(0).address, "latest"]), nonce);
    assert.equal(await rpc("eth_getTransactionCount", [wallet(1).address, "latest"]), "0x0");
    const after = migrate(); assert.equal(after.status, 0); assert.equal(JSON.parse(after.stdout).from, active.modelIdentityHash);
    assert.deepEqual(hashes(), before);
    const evidenceDirectory = path.resolve(process.env.PROTOCOL_CLI_EVIDENCE_DIR || path.join(root, "tmp"));
    assert.ok(evidenceDirectory.startsWith(root + path.sep));
    fs.mkdirSync(evidenceDirectory, { recursive: true });
    fs.writeFileSync(path.join(evidenceDirectory, "protocol-cli-final.json"), JSON.stringify({ passed: true,
      modelIdentity: active.modelIdentityHash, dryRunSentNothing: true, authorizedRollback: true, authorizedPromotion: true,
      staleExpectationRejected: true, unauthorizedSignerRejected: true, rejectedCallsSentNothing: true,
      defaultUnchangedAfterRejectedCalls: true, savedEnvironmentsAndManifestUnchanged: true,
      misspelledRollbackRejected: true, missingExpectedValueRejected: true, existingMeasurementsPreserved: true,
      historicalV4DryRunSentNothing: true, historicalV4PromotedWithExpectedIdentity: true,
      readOnlyReceiptMeasurement: measurement,
      scope: "Explicit isolated chain 31337; no MongoDB, public deployment, hosted activation or Git writes" }, null, 2));
  } finally {
    if (child.exitCode === null) {
      if (process.platform === "win32") spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
      else child.kill("SIGTERM");
    }
    assert.ok(path.resolve(directory).startsWith(path.join(root, "tmp") + path.sep));
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
