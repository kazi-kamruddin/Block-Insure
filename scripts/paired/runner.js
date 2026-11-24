const fs = require("node:fs");
const path = require("node:path");
const { performance } = require("node:perf_hooks");
const { setTimeout: delay } = require("node:timers/promises");
const { ethers } = require("../../backEnd/node_modules/ethers");
const { digest, amount } = require("./manifest");
const { normalize } = require("./receipt");

const configuredRoles = ["admin", "holder", "bank", "oracle1", "oracle2", "auditor1", "auditor2", "auditor3", "auditor4"];
const json = (value) => JSON.stringify(value, (_, field) => typeof field === "bigint" ? field.toString() : field);
const equal = (a, b) => a?.toLowerCase() === b?.toLowerCase();

function providerFor(url, chainId, local) {
  const rpc = new URL(url);
  const allowed = local ? [31337, 11155111] : [11155111, 84532];
  if (!allowed.includes(chainId) || (local
    ? rpc.protocol !== "http:" || !["localhost", "127.0.0.1", "[::1]"].includes(rpc.hostname)
    : rpc.protocol !== "https:")) throw new Error("Unsupported RPC mode or chain");
  const request = new ethers.FetchRequest(rpc.href);
  request.timeout = 10000;
  return new ethers.JsonRpcProvider(request, undefined, { batchMaxCount: 1, cacheTimeout: -1 });
}

function openJournal(directory, identity) {
  fs.mkdirSync(directory, { recursive: true });
  const lock = path.join(directory, "operator.lock");
  try {
    fs.writeFileSync(lock, String(process.pid), { flag: "wx" });
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    throw new Error("The run already has an operator lock. Verify the previous process has stopped before recovering the lock.");
  }
  const release = () => fs.unlinkSync(lock);
  try {
    const file = path.join(directory, "operations.jsonl");
    const entries = fs.existsSync(file) ? fs.readFileSync(file, "utf8").trimEnd().split("\n").map((line) => JSON.parse(line)) : [];
    if (entries.length && json(entries[0]) !== json(identity)) throw new Error("Journal identity differs from the reviewed run");
    const fd = fs.openSync(file, "a", 0o600);
    function append(entry) {
      fs.writeSync(fd, json(entry) + "\n");
      fs.fsyncSync(fd);
      entries.push(entry);
    }
    if (!entries.length) append(identity);
    return { entries, append, close: () => { fs.closeSync(fd); release(); } };
  } catch (error) { release(); throw error; }
}

function logicalValue(value, substitutions) {
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map((item) => logicalValue(item, substitutions));
  if (typeof value === "string" && /^0x[a-f\d]+$/i.test(value)) return substitutions.get(value.toLowerCase()) ?? value.toLowerCase();
  return value;
}

function operationFingerprint({ step, args, before, after, previousOperation, substitutions }) {
  const assertion = (value) => value ? { component: value.component, kind: value.kind ?? "call", signature: value.signature,
    args: logicalValue(value.args, substitutions), resultIndex: value.resultIndex ?? 0, fields: value.fields,
    equals: logicalValue(value.equals, substitutions) } : null;
  return digest(json({ operationId: step.id, previousOperation, role: step.role, target: step.target,
    method: step.method, valueEth: step.valueEth, arguments: logicalValue(args, substitutions),
    before: assertion(before), after: assertion(after) }));
}

function materialize(manifest, deployment, plan) {
  const scope = deployment.components;
  if (!plan.actors || new Set(configuredRoles.map((role) => plan.actors[role]?.toLowerCase())).size !== configuredRoles.length ||
      configuredRoles.some((role) => !ethers.isAddress(plan.actors[role]))) throw new Error("Missing or overlapping operator wallets");
  const substitutions = new Map([
    ...Object.entries(scope).map(([name, address]) => [address.toLowerCase(), "$component." + name]),
    ...Object.entries(plan.actors).map(([role, address]) => [address.toLowerCase(), "$role." + role]),
  ]);
  const result = new Map();
  const planned = manifest.operations.filter((step) => step.kind === "transaction");
  if (!plan.transactions || Object.keys(plan.transactions).length !== planned.length) throw new Error("Plan must bind every reviewed transaction");
  for (const [index, step] of planned.entries()) {
    const row = plan.transactions[step.id];
    if (!row || !Array.isArray(row.args) || !row.assertion || !/^[1-9]\d*$/.test(row.gasLimit) ||
        (step.category !== "bootstrap" && !row.precondition)) throw new Error("Plan is missing a transaction or state assertion for " + step.id);
    const target = scope[step.target];
    if (!ethers.isAddress(target)) throw new Error("Unrecognized component for " + step.id);
    const name = step.target === "ClaimAdjudicator" ? "ClaimAdjudicatorV6" : step.target;
    const impl = step.target === "InsuranceManager" ? "AcceleratedInsuranceManager" : name;
    const artifact = require("../../contracts/artifacts/contracts/" + impl + ".sol/" + impl + ".json");
    const abi = new ethers.Interface(artifact.abi);
    if (step.method !== "constructor" && step.method !== "receive") {
      // Literal arguments and argument count are enforced by the reviewed ABI.
      const fragment = abi.getFunction(step.method);
      const hasBoundTuple = step.arguments.length === 1 && typeof step.arguments[0] === "string" && step.arguments[0].startsWith("$");
      const hasBoundTail = step.arguments.length && typeof step.arguments.at(-1) === "string" && step.arguments.at(-1).includes(".reveal");
      if (!hasBoundTuple && !hasBoundTail && row.args.length !== step.arguments.length) throw new Error("Different argument count for " + step.id);
      step.arguments.forEach((value, index) => {
        let expected = value;
        if (typeof value === "string" && value.startsWith("$")) {
          if (value.startsWith("$role.")) expected = plan.actors[value.slice(6)];
          else if (value.startsWith("$component.")) expected = scope[value.slice(11)];
          else if (value.startsWith("$hash.")) expected = ethers.id(value.slice(6));
          else return;
        }
        const supplied = row.args[index];
        const same = /^0x[a-f\d]+$/i.test(String(expected)) ? equal(String(expected), String(supplied)) : String(expected) === String(supplied);
        if (expected == null || !same) {
          throw new Error("Changed fixed argument for " + step.id);
        }
      });
      if (!fragment) throw new Error("Function absent from approved ABI for " + step.id);
    }
    const data = step.method === "receive" ? "0x" : step.method === "constructor"
      ? artifact.bytecode + abi.encodeDeploy(row.args).slice(2)
      : abi.encodeFunctionData(step.method, row.args);
    const tx = { to: step.method === "constructor" ? null : target, data, value: amount(step.valueEth, step.id) };
    const args = step.method === "constructor" ? ethers.AbiCoder.defaultAbiCoder().decode(abi.deploy.inputs, abi.encodeDeploy(row.args)) :
      step.method === "receive" ? [] : abi.decodeFunctionData(step.method, data);
    const fingerprint = operationFingerprint({ step, args, before: row.precondition, after: row.assertion,
      previousOperation: planned[index - 1]?.id ?? null, substitutions });
    result.set(step.id, { step, target, tx, detail: row, fingerprint, from: ethers.getAddress(plan.actors[step.role]) });
  }
  return result;
}

function inspectReceipt(item, receipt, tx, block) {
  if (!block || !equal(receipt.blockHash, block.hash) || !equal(receipt.blockHash, tx.blockHash) ||
      !equal(receipt.transactionHash, tx.hash) || !equal(item.from, tx.from) ||
      (item.tx.to === null ? tx.to != null || !equal(item.target, receipt.contractAddress) : !equal(item.tx.to, tx.to)) ||
      !equal(item.tx.data, tx.input) || BigInt(tx.value) !== item.tx.value) {
    throw new Error("Receipt does not prove the reviewed operation " + item.step.id);
  }
}

async function prove({ assertion, atBlock, provider, item, deployment }) {
  const target = deployment.components[assertion.component];
  if (!ethers.isAddress(target) || !Object.hasOwn(assertion, "equals")) throw new Error("Missing reviewed state assertion for " + item.step.id);
  let observed;
  if (assertion.kind === "balance") {
    observed = BigInt(await provider.send("eth_getBalance", [target, ethers.toQuantity(atBlock)]));
  } else {
    if (typeof assertion.signature !== "string" || !Array.isArray(assertion.args)) throw new Error("Missing reviewed call for " + item.step.id);
    const fragment = new ethers.Interface(["function " + assertion.signature]);
    const fn = fragment.fragments[0];
    if (fn.stateMutability !== "view" && fn.stateMutability !== "pure") throw new Error("Receipt assertion must be read-only");
    const data = fragment.encodeFunctionData(fn, assertion.args);
    const decoded = fragment.decodeFunctionResult(fn, await provider.send("eth_call",
      [{ to: target, data }, ethers.toQuantity(atBlock)]));
    observed = decoded[assertion.resultIndex ?? 0];
    if (assertion.fields) observed = assertion.fields.map((field) => observed.getValue(field));
  }
  const normalizeValue = (value) => Array.isArray(value) ? value.map(normalizeValue) : String(value).toLowerCase();
  if (json(normalizeValue(observed)) !== json(normalizeValue(assertion.equals))) throw new Error("On-chain state assertion failed for " + item.step.id);
}

async function canonicalReceipt(provider, hash) {
  const receipt = await provider.send("eth_getTransactionReceipt", [hash]);
  if (!receipt) return null;
  const [tx, block] = await Promise.all([
    provider.send("eth_getTransactionByHash", [hash]),
    provider.send("eth_getBlockByNumber", [receipt.blockNumber, false]),
  ]);
  if (!tx) throw new Error("Inconsistent transaction read");
  return { receipt, tx, block };
}

async function waitFor(read, deadline, pollMs) {
  do {
    const result = await read();
    if (result) return result;
    await delay(Math.min(pollMs, Math.max(0, deadline - Date.now())));
  } while (Date.now() < deadline);
  throw new Error("Observation timed out. Reconcile the recorded transaction before retrying.");
}

async function executeIntent({ provider, item, journal, settings, signer, reviewedFees, interrupt }) {
  const id = item.step.id;
  const previous = journal.entries.find((entry) => entry.operationId === id && entry.type === "signed");
  const confirmed = journal.entries.find((entry) => entry.operationId === id && entry.type === "receipt");
  let intent = previous;
  const fingerprint = item.fingerprint ?? digest(json({ step: item.step, calldata: item.tx.data }));
  if ([previous, confirmed].some((entry) => entry && entry.operationFingerprint !== fingerprint)) {
    throw new Error("Journal operation fingerprint no longer matches " + id);
  }
  const existingHash = previous?.hash ?? confirmed?.hash;
  let canonical = existingHash ? await canonicalReceipt(provider, existingHash) : null;
  let started;
  if (confirmed && !canonical) throw new Error("Recorded receipt is missing from the canonical chain");
  if (!canonical) {
    if (item.step.category === "bootstrap" || item.detail.observedHash) {
      const known = item.detail.observedHash;
      if (!known) throw new Error("Bootstrap requires exact recorded deployment receipts");
      canonical = await canonicalReceipt(provider, known);
      if (!canonical) throw new Error("The observed transaction has no canonical receipt");
    } else {
      const nonce = previous ? previous.nonce : await provider.getTransactionCount(item.from, "pending");
      const latestNonce = await provider.getTransactionCount(item.from, "latest");
      const pendingNonce = await provider.getTransactionCount(item.from, "pending");
      const pending = previous && await provider.send("eth_getTransactionByHash", [previous.hash]);
      if (latestNonce > nonce || (!pending && pendingNonce !== nonce)) throw new Error("Nonce is occupied by an unknown transaction for " + id);
      if (!signer || !equal(signer.address, item.from)) throw new Error("Missing approved signer for " + id);
      const gasLimit = BigInt(item.detail.gasLimit);
      const fee = BigInt(reviewedFees.maxFeePerGasWei);
      const tip = BigInt(reviewedFees.priorityWei);
      if (!previous && (await provider.estimateGas({ ...item.tx, from: item.from })) > gasLimit) throw new Error("Live estimate exceeds the reviewed gas limit");
      if (!previous && settings.checkBudget) await settings.checkBudget(item);
      if (!previous && item.detail.precondition) await prove({ assertion: item.detail.precondition,
        atBlock: await provider.getBlockNumber(), provider, item, deployment: settings.deployment });
      const envelope = await signer.signTransaction({ ...item.tx, chainId: settings.chainId, nonce, gasLimit,
        type: 2, maxFeePerGas: fee, maxPriorityFeePerGas: tip });
      const hash = ethers.keccak256(envelope);
      if (previous && previous.hash !== hash) throw new Error("Exact signed intent cannot be reconstructed");
      if (!previous) {
        intent = { type: "signed", operationId: id, hash, nonce, submittedAt: new Date().toISOString(),
          operationFingerprint: fingerprint };
        journal.append(intent);
      }
      if (!pending) {
        if (previous && settings.checkBudget) await settings.checkBudget(item);
        if (!previous) started = performance.now();
        await provider.send("eth_sendRawTransaction", [envelope]);
        if (interrupt === id) throw new Error("Rehearsal interrupted after broadcast");
      }
      canonical = await waitFor(() => canonicalReceipt(provider, hash), Date.now() + settings.receiptTimeoutMs, settings.pollMs);
    }
  }
  inspectReceipt(item, canonical.receipt, canonical.tx, canonical.block);
  const observation = confirmed ?? {
    type: "receipt", operationId: id, hash: canonical.tx.hash,
    firstReceiptMs: started === undefined ? null : Math.round(performance.now() - started),
    operationFingerprint: intent?.operationFingerprint ?? fingerprint,
  };
  if (BigInt(canonical.receipt.status) === 1n && item.step.method !== "constructor") {
    const atBlock = BigInt(canonical.receipt.blockNumber);
    if (item.detail.precondition) await prove({ assertion: item.detail.precondition, atBlock: atBlock - 1n,
      provider, item, deployment: settings.deployment });
    await prove({ assertion: item.detail.assertion, atBlock, provider, item, deployment: settings.deployment });
  }
  if (!confirmed) journal.append(observation);
  return { canonical, observation, started };
}

function rowFor({ item, canonical, observation, settings, request, operatorFeeWei }) {
  return normalize({ step: item.step, manifestHash: settings.manifestHash, chainId: settings.chainId,
    ...canonical, contracts: settings.deployment.components, ledger: observation, request, operatorFeeWei,
    captureLocalEncoding: settings.captureLocalEncoding });
}

module.exports = { configuredRoles, operationFingerprint, providerFor, materialize, openJournal, canonicalReceipt, executeIntent, rowFor, waitFor };

