const fs = require("node:fs");
const path = require("node:path");
const net = require("node:net");
const { spawn, spawnSync, execFileSync } = require("node:child_process");
const { ethers } = require("../../backEnd/node_modules/ethers");
const { HARDHAT_NETWORK_MNEMONIC } = require("../../contracts/node_modules/hardhat/internal/core/config/default-config");
const { readManifest, digest, amount } = require("./manifest");
const { verifyPaired, assertParity } = require("./deployment");
const { providerFor, canonicalReceipt, waitFor, executeIntent, openJournal, materialize, rowFor } = require("./runner");
const { normalize } = require("./receipt");
const { compare, writeComparison } = require("./compare");
const { captureFork } = require("./fork");
const { bootstrapRole, generatedManifest } = require("./generatedInput");

const root = path.resolve(__dirname, "../..");
const launcher = path.join(root, "contracts/scripts/runHardhat.js");

async function localPort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return port;
}

function start(args, environment) {
  const child = spawn(process.execPath, [launcher, ...args], { cwd: root, env: { ...process.env, ...environment },
    windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  let safeDiagnostic = "";
  // Hardhat node prints dev keys in its startup banner, so the node stream is never retained.
  const capture = (data) => {
    if (args[0] === "node") return;
    safeDiagnostic = (safeDiagnostic + data.toString()).split(/\r?\n/).filter((line) =>
      !/private.?key|secret|mnemonic|0x[a-f\d]{64}/i.test(line)).join("\n").slice(-5000);
  };
  child.stdout.on("data", capture);
  child.stderr.on("data", capture);
  child.completed = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code) => code === 0 ? resolve() : reject(new Error(args[0] + " failed: " + safeDiagnostic)));
  });
  child.completed.catch(() => {});
  return child;
}

function stop(child) {
  if (!child.pid || child.exitCode !== null) return;
  if (process.platform === "win32") spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
  else child.kill("SIGTERM");
}

async function collectBootstrap({ manifest, manifestHash, chainId, deployment, provider }) {
  const operations = manifest.operations.filter((step) => step.category === "bootstrap");
  const receipts = [];
  const head = await provider.getBlockNumber();
  for (let number = deployment.deploymentBlock; number <= head; number += 1) {
    const block = await provider.send("eth_getBlockByNumber", [ethers.toQuantity(number), false]);
    for (const hash of block.transactions) receipts.push(await canonicalReceipt(provider, hash));
  }
  if (receipts.length !== operations.length) throw new Error("Actual bootstrap length differs from the manifest");
  return operations.map((step, index) => {
    const reading = receipts[index];
    const expectedTarget = deployment.components[step.target];
    const { tx, receipt } = reading;
    if (BigInt(receipt.status) !== 1n || BigInt(tx.value) !== amount(step.valueEth, step.id) ||
        tx.from.toLowerCase() !== deployment.deployer.toLowerCase() ||
        (step.method === "constructor" ? receipt.contractAddress : tx.to)?.toLowerCase() !== expectedTarget?.toLowerCase()) {
      throw new Error("Bootstrap receipt does not match " + step.id);
    }
    const implementation = step.target === "InsuranceManager" ? "AcceleratedInsuranceManager" :
      step.target === "ClaimAdjudicator" ? "ClaimAdjudicatorV6" : step.target;
    const artifact = require("../../contracts/artifacts/contracts/" + implementation + ".sol/" + implementation + ".json");
    const iface = new ethers.Interface(artifact.abi);
    if (step.method === "constructor" ? !tx.input.startsWith(artifact.bytecode) :
        step.method === "receive" ? tx.input !== "0x" : iface.parseTransaction({ data: tx.input })?.name !== step.method) {
      throw new Error("Bootstrap calldata does not match " + step.id);
    }
    return normalize({ step, manifestHash, chainId, ...reading, contracts: deployment.components,
      ledger: { operationFingerprint: digest(tx.input) }, captureLocalEncoding: true });
  });
}

const localRoleIndex = { admin: 0, holder: 1, oracle1: 4, oracle2: 5, auditor1: 6, auditor2: 7,
  auditor3: 8, auditor4: 9, bank: 15 };
const localWallet = (index) => ethers.HDNodeWallet.fromPhrase(HARDHAT_NETWORK_MNEMONIC, undefined, "m/44'/60'/0'/0/" + index);

async function bindRoles({ provider, chainId, directory, deployment, manifest, manifestHash, admin, publicOptions, startTime }) {
  const actors = publicOptions?.actors ?? Object.fromEntries(Object.entries(localRoleIndex).map(([name, i]) => [name, localWallet(i).address]));
  const operations = manifest.operations.filter((step) => bootstrapRole.test(step.id));
  const transactions = Object.fromEntries(operations.map((step) => {
    const name = step.id.slice("setup.".length);
    if (name === "registry-baseline") {
      const record = require("./localFixtures").buildEpisode({ name: "registry-baseline", profile: manifest.cases.routine,
        expected: manifest.cases.routine.expectedBillEth, holder: actors.holder, incident: startTime });
      const root = require("../../oracle/shadowAssessment").registryRoot([record]);
      const reading = { component: "OracleCoordinator", signature: "currentRegistryVersion() view returns(uint64)", args: [] };
      return [step.id, { args: [root, 1, ethers.id("canonical-registry-schema-v1")], gasLimit: "300000",
        precondition: { ...reading, equals: 0 }, assertion: { ...reading, equals: 1 } }];
    }
    if (name === "medical-reserve") {
      const balance = { component: "InsuranceManager", kind: "balance" };
      return [step.id, { args: [], gasLimit: "300000", precondition: { ...balance, equals: "0" },
        assertion: { ...balance, equals: amount(manifest.deployment.medicalReserveEth, name).toString() } }];
    }
    const bank = name === "bank";
    const args = bank ? ["BANK-001", actors.bank] :
      [ethers.id(name.startsWith("oracle") ? "ORACLE_ROLE" : "AUDITOR_ROLE"), actors[name]];
    const read = bank ? { component: "BankIdentityRegistry", signature: "bankWalletByIdHash(bytes32) view returns(address)",
      args: [ethers.id("BANK-001")] } : { component: "InsuranceManager", signature: "hasRole(bytes32,address) view returns(bool)", args };
    return [step.id, { args, gasLimit: "300000", precondition: { ...read, equals: bank ? ethers.ZeroAddress : false },
      assertion: { ...read, equals: bank ? actors.bank : true } }];
  }));
  if (publicOptions) for (const [id, detail] of Object.entries(transactions)) detail.gasLimit = publicOptions.gasLimits[id];
  const settings = { chainId, deployment, manifestHash, pollMs: publicOptions ? 5000 : 100, receiptTimeoutMs: publicOptions ? 300000 : 15000,
    captureLocalEncoding: !publicOptions, checkBudget: publicOptions?.checkBudget };
  const walletData = { type: publicOptions ? "public-role-bootstrap" : "local-role-bootstrap", chainId, manifestHash,
    ...(publicOptions && { planHash: publicOptions.planHash, manager: deployment.components.InsuranceManager }) };
  const journal = openJournal(path.join(directory, "role-bootstrap"), walletData);
  const rows = [];
  try {
    for (const item of materialize({ ...manifest, operations }, deployment, { actors, transactions }).values()) {
      const { canonical, observation } = await executeIntent({ provider, item, journal, settings, signer: admin,
        reviewedFees: publicOptions?.fees ?? { maxFeePerGasWei: "5000000000", priorityWei: "1000000000" } });
      const row = rowFor({ item, canonical, observation, settings });
      if (row.status !== "confirmed") throw new Error("Local role assignment reverted for " + item.step.id);
      rows.push(row);
    }
  } finally { journal.close(); }
  if (transactions["setup.registry-baseline"]) {
    const coordinator = new ethers.Contract(deployment.components.OracleCoordinator, require("../../oracle/abi/OracleCoordinator.json").abi, provider);
    if ((await coordinator.getRegistrySnapshot(1)).root !== transactions["setup.registry-baseline"].args[0]) {
      throw new Error("Initial registry root did not match the reviewed baseline");
    }
  }
  return { actors, rows };
}

async function verifyLiveResume({ provider, deployment, chainId, directory, admin, manifestHash }) {
  const coordinator = new ethers.Contract(deployment.components.OracleCoordinator,
    require("../../oracle/abi/OracleCoordinator.json").abi, provider);
  const manager = new ethers.Contract(deployment.components.InsuranceManager,
    require("../../backEnd/abi/InsuranceManager.json").abi, provider);
  const model = await manager.oracleModelVersion();
  const item = {
    step: { id: "local.resume", category: "local-recovery", method: "updateOracleModelVersion" },
    from: admin.address, target: manager.target,
    tx: { to: manager.target, data: manager.interface.encodeFunctionData("updateOracleModelVersion", [model]), value: 0n },
    detail: { gasLimit: "200000",
      precondition: { component: "InsuranceManager", signature: "oracleModelVersion() view returns(bytes32)", args: [], equals: model },
      assertion: { component: "InsuranceManager", signature: "oracleModelVersion() view returns(bytes32)", args: [], equals: model } },
  };
  const identity = { type: "local-recovery", chainId, manifestHash, manager: manager.target };
  const journalPath = path.join(directory, "interrupted-local");
  const startingNonce = await provider.getTransactionCount(admin.address);
  const settings = { chainId, deployment, pollMs: 100, receiptTimeoutMs: 15000 };
  const reviewedFees = { maxFeePerGasWei: "5000000000", priorityWei: "1000000000" };
  let journal = openJournal(journalPath, identity);
  try {
    await require("node:assert/strict").rejects(executeIntent({ provider, item, journal, settings, signer: admin,
      reviewedFees, interrupt: item.step.id }), /Rehearsal interrupted after broadcast/);
  } finally { journal.close(); }
  journal = openJournal(journalPath, identity);
  try {
    const resumed = await executeIntent({ provider, item, journal, settings, signer: admin, reviewedFees });
    const endingNonce = await provider.getTransactionCount(admin.address);
    if (endingNonce !== startingNonce + 1 || journal.entries.filter((entry) => entry.type === "signed").length !== 1 ||
        journal.entries.filter((entry) => entry.type === "receipt").length !== 1 || await coordinator.requestCounter() > 1n) {
      throw new Error("Local recovery sent a duplicate transaction or changed workflow state");
    }
    fs.writeFileSync(path.join(journalPath, "result.json"), JSON.stringify({
      chainId, manifestHash, startingNonce, endingNonce, hash: resumed.canonical.tx.hash,
      duplicateSends: false, scope: "isolated runner transaction outside bootstrap results",
    }, null, 2) + "\n", { flag: "wx" });
  } finally { journal.close(); }
}

async function one({ chainId, directory, scenarioPath, manifest, manifestHash, sourceCommit, sourceDeltaSha256, fixture, startTime, routing }) {
  const port = await localPort();
  const url = "http://127.0.0.1:" + port;
  const node = start(["node", "--hostname", "127.0.0.1", "--port", String(port), "--network", "hardhat"], { PAIRED_LOCAL_CHAIN_ID: String(chainId) });
  let provider;
  try {
    // Check the listener before constructing any deployment signer.
    await Promise.race([node.completed, waitFor(async () => {
      try {
        const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json" },
          body: '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}', signal: AbortSignal.timeout(750) });
        return Number((await response.json()).result) === chainId;
      } catch { return false; }
    }, Date.now() + 30_000, 250)]);
    provider = providerFor(url, chainId, true);
    const forkStart = await captureFork(provider, chainId, { local: true });
    const admin = localWallet(0);
    const guarded = {};
    if (routing) {
      fs.mkdirSync(directory);
      const entries = manifest.operations.filter((step) => step.category === "bootstrap");
      const plan = { chainId, manifestHash, actors: { admin: admin.address }, startingAdminNonce: 0,
        fees: { maxFeePerGasWei: "5000000000", priorityWei: "1000000000" },
        startingAdminWei: String(await provider.getBalance(admin.address)), retainedAdminWei: "1000000000000000000",
        maxAdminOutflowWei: "10000000000000000000", gasLimits: Object.fromEntries(entries.map((step) => [step.id, "25000000"])),
        extraFeeLimits: Object.fromEntries(entries.map((step) => [step.id, "0"])) };
      const planPath = path.join(directory, "rehearsal-bootstrap-plan.json");
      const text = JSON.stringify(plan) + "\n";
      fs.writeFileSync(planPath, text, { flag: "wx" });
      Object.assign(guarded, { PAIRED_GUARD_REHEARSAL: "true", PAIRED_BOOTSTRAP_PLAN_FILE: planPath, PAIRED_REVIEWED_BOOTSTRAP_PLAN: digest(text) });
    }
    await start(["run", "--no-compile", "scripts/deploy.js", "--network", "localhost"], {
      PAIRED_LOCAL_CHAIN_ID: String(chainId), PAIRED_LOCAL_RPC_URL: url, ADMIN_PRIVATE_KEY: admin.privateKey,
      PAIRED_SCENARIO_FILE: scenarioPath, DEPLOY_WRITE_ENV: "false", DEPLOYMENT_OUTPUT_DIR: directory, ...guarded,
    }).completed;
    const deploymentFile = path.join(directory, "localhost-" + chainId + ".json");
    const bytes = fs.readFileSync(deploymentFile);
    const deployment = JSON.parse(bytes);
    const rows = await collectBootstrap({ manifest, manifestHash, chainId, deployment, provider });
    const bound = await bindRoles({ provider, chainId, directory, deployment, manifest, manifestHash, admin, startTime });
    rows.push(...bound.rows);
    const readback = await verifyPaired({ manifest, manifestHash, deployment, provider, local: true, actors: bound.actors });
    const deploymentManifestHash = digest(bytes);
    const full = fixture && await require("./localAdapter").localAdapter({ provider, manifest, deployment, manifestHash, chainId,
      directory, deploymentManifestHash, evidence: fixture, startTime, routing, readback, mongoUri: process.env.PAIRED_CAMPAIGN_MONGO_URL,
      checkpoint: routing ? require("./privateCheckpoint").privateCheckpoint(path.join(directory, "workflow/private"), admin.privateKey, deploymentManifestHash) : undefined,
      signers: Object.fromEntries(Object.entries(localRoleIndex).map(([role, index]) => [role, localWallet(index)])),
    });
    if (routing) for (const row of rows) Object.assign(row, { repetition: null, offchainInputSource: manifest.offchainInputSource });
    if (full) rows.push(...full.rows);
    if (full && rows.length !== manifest.expectedTransactionsPerChain) throw new Error("Full local receipt count differs from manifest");
    const forkEnd = await captureFork(provider, chainId, { local: true });
    const campaign = { schema: "block-insure-paired-campaign/v1", chainId, sourceCommit, sourceDeltaSha256, local: true,
      scope: full ? "complete isolated fixture transaction rehearsal" : "contract and role bootstrap with medical reserve",
      ...(routing && { offchainInputSource: manifest.offchainInputSource, repetitions: manifest.repetitions, oracleHandoff: full.oracleHandoff }),
      manifestHash, deploymentManifestHash, configurationHash: readback.configurationHash,
      complete: Boolean(full), observations: full?.observations ?? [], interruptedWorkflow: full?.interrupt ?? null,
      localClockAdvances: full?.clockAdvances ?? [],
      fork: { start: forkStart, end: forkEnd },
      componentAddresses: readback.components, runtimeCodeHashes: readback.codeHashes,
      normalizedRuntimeCodeHashes: readback.normalizedCodeHashes, rows };
    fs.writeFileSync(path.join(directory, "campaign.json"), JSON.stringify(campaign, null, 2) + "\n", { flag: "wx" });
    if (!full) await verifyLiveResume({ provider, deployment, chainId, directory, admin, manifestHash });
    return { campaign, readback };
  } finally {
    provider?.destroy();
    stop(node);
  }
}

async function main() {
  const scenarioPath = path.join(root, "deploy/paired-v6-scenario.json");
  const scenario = readManifest(scenarioPath);
  const { manifestHash } = scenario;
  const options = require("../operatorArguments").parseOperatorArguments(process.argv.slice(2), {
    values: ["--repetitions"], switches: ["--full-local", "--generated-offchain-inputs"],
  });
  const routing = options["--generated-offchain-inputs"] && require("../../deploy/paired-v6-live-routing.json");
  const manifest = routing ? generatedManifest({ ...scenario, routing, repetitions: Number(options["--repetitions"] ?? 1) }) : scenario.manifest;
  if (options["--repetitions"] && !routing) throw new Error("Repetitions require explicit generated off-chain inputs");
  const full = Boolean(options["--full-local"] || routing);
  const output = path.join(root, "verification-results", (full ? "paired-full-local-" : "paired-bootstrap-") + new Date().toISOString().replace(/[:.]/g, "-"));
  fs.mkdirSync(output);
  const git = (...args) => execFileSync("git", ["-c", "safe.directory=" + root.replace(/\\/g, "/"), "-C", root, ...args],
    { windowsHide: true, maxBuffer: 16 * 1024 * 1024 });
  const sourceCommit = git("rev-parse", "HEAD").toString().trim();
  const patch = git("diff", "--binary", "HEAD");
  const newPaths = git("ls-files", "--others", "--exclude-standard", "-z").toString().split("\0").filter(Boolean).sort();
  const sourceDeltaSha256 = patch.length || newPaths.length ? digest(JSON.stringify({ trackedPatch: digest(patch),
    addedFiles: newPaths.map((file) => [file, digest(fs.readFileSync(path.join(root, file)))]) })) : null;
  const startTime = Math.floor(Date.now() / 1000) + 1800;
  const fixture = full && require("./localFixtures").createEvidenceFixtures(["holder", "auditor1", "auditor2", "auditor3", "auditor4"]);
  const args = { scenarioPath, manifest, manifestHash, sourceCommit, sourceDeltaSha256, startTime, fixture, routing };
  const l1 = await one({ ...args, chainId: 31337, directory: path.join(output, "local-l1") });
  const l2 = await one({ ...args, chainId: 11155111, directory: path.join(output, "local-l2") });
  assertParity(l1.readback, l2.readback);
  const report = compare(manifest, manifestHash, l1.campaign, l2.campaign);
  writeComparison(report, path.join(output, "comparison"));
  fs.writeFileSync(path.join(output, "routing-fixtures.json"), JSON.stringify(routing ? {
    offchainInputSource: manifest.offchainInputSource, routing, originalCaseScores: require("./fixtures").verifyFixtures(scenario.manifest),
  } : require("./fixtures").verifyFixtures(manifest), null, 2), { flag: "wx" });
  console.log(JSON.stringify({ output, complete: report.complete, receiptPairs: report.paired.length,
    deploymentTotals: report.deploymentTotals, workflowTotals: report.workflowTotals, excluded: report.excluded.length }));
  if (full && !report.complete) throw new Error("A full local pair contains mismatches. Read the dated exclusions.");
}
if (require.main === module) main().catch((error) => { console.error(error.code ?? error.message); process.exitCode = 1; });
module.exports = { bindRoles, collectBootstrap };

