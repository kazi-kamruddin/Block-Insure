const { once } = require("node:events");
const { waitForReadiness } = require("./readiness");
const { canonicalReceipt } = require("./runner");

const generatedInputLabel = "off-chain inputs runner-generated, not produced by the hosted application";
const roles = ["oracle1", "oracle2"];

async function stopWorker(worker) {
  if (worker.exitCode != null || worker.signalCode != null) throw new Error("Campaign worker exited before handoff");
  const exited = once(worker, "exit", { signal: AbortSignal.timeout(10000) });
  if (!worker.kill("SIGTERM")) throw new Error("Could not stop campaign worker");
  await exited;
}

async function nonceAtRest(provider, wallet) {
  const [mined, pending] = await Promise.all([
    provider.getTransactionCount(wallet, "latest"), provider.getTransactionCount(wallet, "pending"),
  ]);
  if (mined !== pending) throw new Error("Campaign Oracle signer has a pending transaction");
  return mined;
}

async function handoff({ urls, workers, deployment, provider, journal, coordinator }) {
  if (workers.length !== roles.length || new Set(workers.map((worker) => worker.pid)).size !== roles.length ||
      workers.some((worker) => !worker.pid)) throw new Error("Expected two distinct campaign-owned Oracle processes");
  if (journal.entries.some((entry) => entry.type === "oracle-handoff")) throw new Error("Oracle handoff is already recorded");
  if (await coordinator.requestCounter() !== 1n) throw new Error("Oracle handoff requires a fresh request queue");
  const before = await Promise.all(deployment.oracleWallets.map((wallet) => nonceAtRest(provider, wallet)));
  const readiness = await waitForReadiness({ urls, deployment, local: true });
  await Promise.all(workers.map(stopWorker));
  const after = await Promise.all(deployment.oracleWallets.map((wallet) => nonceAtRest(provider, wallet)));
  if (after.some((nonce, index) => nonce !== before[index]) || await coordinator.requestCounter() !== 1n) {
    throw new Error("A transaction appeared during Oracle handoff");
  }
  const entry = { type: "oracle-handoff", readiness, stoppedAt: new Date().toISOString(),
    workerPids: workers.map((worker) => worker.pid), signers: roles.map((role, index) => ({ role,
      wallet: deployment.oracleWallets[index], initialNonce: after[index] })) };
  journal.append(entry);
  return entry;
}

async function enforceSignerFence({ provider, journal, item }) {
  const handoff = journal.entries.find((entry) => entry.type === "oracle-handoff");
  if (!handoff) throw new Error("Campaign Oracle handoff has not been recorded");
  const signer = handoff.signers.find(({ wallet }) => wallet.toLowerCase() === item.from.toLowerCase());
  if (!signer) return;
  const signed = journal.entries.filter((entry) => entry.type === "signed" && entry.signerRole === signer.role);
  const earlier = signed.filter(({ operationId }) => operationId !== item.step.id);
  for (const [index, entry] of earlier.entries()) {
    if (entry.nonce !== signer.initialNonce + index || !await canonicalReceipt(provider, entry.hash)) {
      throw new Error("Campaign Oracle nonce sequence differs from its canonical ledger");
    }
  }
  const nonce = signer.initialNonce + earlier.length;
  const intent = signed.find(({ operationId }) => operationId === item.step.id);
  if (intent && await canonicalReceipt(provider, intent.hash)) return;
  const knownPending = intent && await provider.send("eth_getTransactionByHash", [intent.hash]);
  const [latest, pending] = await Promise.all([
    provider.getTransactionCount(item.from, "latest"), provider.getTransactionCount(item.from, "pending"),
  ]);
  if (latest !== nonce || pending !== nonce + Number(Boolean(knownPending)) || (intent && intent.nonce !== nonce)) {
    throw new Error("Campaign Oracle signer nonce is occupied outside the operation ledger");
  }
}

module.exports = { enforceSignerFence, generatedInputLabel, handoff };
