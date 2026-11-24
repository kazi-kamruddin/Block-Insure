const fs = require("node:fs");
const path = require("node:path");
const { ethers } = require("../../backEnd/node_modules/ethers");
const { amount, digest } = require("./manifest");
const { canonicalReceipt, openJournal, waitFor } = require("./runner");
const { normalize } = require("./receipt");

const { bootstrapRole } = require("./generatedInput");
const noRecipient = (address) => address == null ? null : ethers.getAddress(address);

function guardedDeployer({ wallet, provider, output, manifest, plan, planHash, chainId, extraFee, fundingSteps, local = false, target = "deploy-journal" }) {
  const steps = fundingSteps ?? manifest.operations.filter((step) => step.category === "bootstrap");
  const journal = openJournal(path.join(output, target), { type: target, chainId: Number(chainId), planHash });
  let index = 0;
  const startNonce = Number(plan.startingAdminNonce);
  if (!Number.isSafeInteger(startNonce) || startNonce < 0) {
    journal.close();
    throw new Error("Missing reviewed initial admin nonce");
  }
  const fee = BigInt(plan.fees.maxFeePerGasWei), tip = BigInt(plan.fees.priorityWei);
  const starting = BigInt(plan.startingAdminWei), floor = BigInt(plan.retainedAdminWei), max = BigInt(plan.maxAdminOutflowWei);
  wallet.sendTransaction = async (request) => {
    const step = steps[index];
    if (!step) throw new Error("Deployment has an unreviewed operation");
    const data = request.data ?? "0x";
    const value = BigInt(request.value ?? 0);
    const to = noRecipient(await request.to);
    const nonce = startNonce + index;
    const gasLimit = BigInt(plan.gasLimits[step.id]);
    if (value !== amount(step.valueEth, step.id) || (step.method === "constructor") !== (to === null) ||
        (step.recipient && noRecipient(step.recipient) !== to)) throw new Error("Transaction differs from manifest");
    const intentHash = digest(JSON.stringify({ to, data, value: String(value), nonce, gasLimit: String(gasLimit) }));
    const previous = journal.entries.find((entry) => entry.type === "signed" && entry.operationId === step.id);
    if (previous && previous.intentHash !== intentHash) throw new Error("Bootstrap recovery calldata or nonce differs");
    let canonical = previous && await canonicalReceipt(provider, previous.hash);
    if (!canonical) {
      const minNonce = await provider.getTransactionCount(wallet.address, "latest");
      const maxNonce = await provider.getTransactionCount(wallet.address, "pending");
      const pending = previous && await provider.send("eth_getTransactionByHash", [previous.hash]);
      if (minNonce !== nonce || maxNonce !== nonce + Number(Boolean(pending))) throw new Error("An unknown transaction occupies the bootstrap nonce");
      const extra = await extraFee(data, gasLimit);
      const expense = value + fee * gasLimit + BigInt(plan.extraFeeLimits[step.id]);
      const balance = await provider.getBalance(wallet.address, "pending");
      if (extra > BigInt(plan.extraFeeLimits[step.id]) || balance < floor + expense || starting - balance + expense > max) {
        throw new Error("Bootstrap send exceeds the budget or fees");
      }
      if (!pending) {
        if (!previous) {
          const transaction = { from: wallet.address, to, data, value, maxFeePerGas: fee, maxPriorityFeePerGas: tip };
          const estimate = to == null && !local ? (await require("../deploymentGas").estimateDeploymentGas({ provider, chainId, transaction, from: wallet.address })).estimatedGas
            : await provider.estimateGas(transaction);
          if (estimate > gasLimit) throw new Error("Bootstrap estimate exceeds reviewed cap");
        }
        const signed = await wallet.signTransaction({ type: 2, chainId, nonce, to, data, value, gasLimit, maxFeePerGas: fee, maxPriorityFeePerGas: tip });
        const hash = ethers.keccak256(signed);
        if (previous && previous.hash !== hash) throw new Error("Bootstrap signed intent is different after recovery");
        if (!previous) journal.append({ type: "signed", operationId: step.id, intentHash, hash, nonce, submittedAt: new Date().toISOString() });
        await provider.send("eth_sendRawTransaction", [signed]);
      }
      const knownHash = journal.entries.find((entry) => entry.type === "signed" && entry.operationId === step.id).hash;
      canonical = await waitFor(() => canonicalReceipt(provider, knownHash), Date.now() + 300000, 5000);
    }
    const { tx, receipt, block } = canonical;
    if (BigInt(receipt.status) !== 1n || tx.blockHash !== block?.hash || receipt.blockHash !== block.hash ||
        noRecipient(tx.to) !== to || noRecipient(tx.from) !== wallet.address || tx.input !== data || BigInt(tx.value) !== value ||
        Number(tx.nonce) !== nonce) throw new Error("Bootstrap receipt differs from the reviewed operation or reverted");
    if (!journal.entries.some((entry) => entry.type === "receipt" && entry.operationId === step.id)) {
      journal.append({ type: "receipt", operationId: step.id, hash: tx.hash });
    }
    index += 1;
    return provider.getTransaction(tx.hash);
  };
  return { entries: journal.entries, close() { journal.close(); }, assertComplete() {
    if (index !== steps.length) throw new Error("Bootstrap operation count differs from manifest");
  } };
}

async function capturedBootstrap({ provider, manifest, manifestHash, chainId, deployment, plan, output, budget }) {
  const steps = manifest.operations.filter((step) => step.category === "bootstrap" || bootstrapRole.test(step.id));
  const paths = ["deploy-journal", "role-bootstrap"].map((name) => path.join(output, name, "operations.jsonl"));
  const entries = paths.flatMap((file) => fs.readFileSync(file, "utf8").trimEnd().split("\n").map((line) => JSON.parse(line)));
  const receipts = new Map(entries.filter((entry) => entry.type === "receipt").map((entry) => [entry.operationId, entry.hash]));
  if (receipts.size !== steps.length || new Set(receipts.values()).size !== steps.length) throw new Error("Public bootstrap journal is incomplete");
  return Promise.all(steps.map(async (step) => {
    const record = await canonicalReceipt(provider, receipts.get(step.id));
    const { tx, receipt, block } = record ?? {};
    const target = deployment.components[step.target];
    const role = noRecipient(plan.actors[step.role]);
    if (!record || BigInt(receipt.status) !== 1n || tx.blockHash !== block?.hash || receipt.blockHash !== block.hash ||
      noRecipient(tx.from) !== role || noRecipient(step.method === "constructor" ? receipt.contractAddress : tx.to) !== noRecipient(target) ||
      BigInt(tx.value) !== amount(step.valueEth, step.id)) throw new Error("Public bootstrap receipt scope mismatch for " + step.id);
    const implementation = step.target === "InsuranceManager" ? "AcceleratedInsuranceManager" :
      step.target === "ClaimAdjudicator" ? "ClaimAdjudicatorV6" : step.target;
    const artifact = require("../../contracts/artifacts/contracts/" + implementation + ".sol/" + implementation + ".json");
    const abi = new ethers.Interface(artifact.abi);
    if (step.method === "constructor" ? !tx.input.startsWith(artifact.bytecode) : step.method === "receive" ? tx.input !== "0x" :
      abi.parseTransaction({ data: tx.input })?.name !== step.method) throw new Error("Public bootstrap calldata mismatch for " + step.id);
    return { ...normalize({ step, manifestHash, chainId, ...record, contracts: deployment.components,
      ledger: { operationFingerprint: digest(JSON.stringify({ step, manifestHash })) }, operatorFeeWei: await budget.operatorFee(record) }),
      repetition: null, offchainInputSource: manifest.offchainInputSource };
  }));
}

module.exports = { capturedBootstrap, guardedDeployer };
