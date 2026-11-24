const { setTimeout: sleep } = require("node:timers/promises");

function createFinalityTracker({ provider, journal, pollMs }) {
  const pending = new Map();
  let running, stopped = false, failure;
  const stored = new Map(journal.entries.filter(({ type }) => type === "finality").map((entry) => [entry.operationId, entry.upperMs]));
  async function poll() {
    if (!pending.size) return;
    const finalized = await provider.getBlock("finalized");
    if (!finalized) return;
    const checkedAt = Date.now();
    for (const [id, { row, submittedAt }] of pending) {
      if (finalized.number < row.blockNumber) continue;
      if ((await provider.getBlock(row.blockNumber))?.hash !== row.blockHash) throw new Error("A receipt moved before finality");
      row.observedFinalityUpperMs = checkedAt - Date.parse(submittedAt);
      journal.append({ type: "finality", operationId: id, upperMs: row.observedFinalityUpperMs });
      pending.delete(id);
    }
  }
  const timer = setInterval(() => {
    if (!running && !stopped && !failure) {
      running = poll().catch((error) => { failure = error; }).finally(() => { running = null; });
    }
  }, pollMs);
  timer.unref();
  return {
    observe(row) {
      if (failure) throw failure;
      if (stored.has(row.operationId)) {
        row.observedFinalityUpperMs = stored.get(row.operationId);
        return;
      }
      const submittedAt = journal.entries.find((entry) => entry.type === "signed" && entry.operationId === row.operationId)?.submittedAt;
      if (submittedAt) pending.set(row.operationId, { row, submittedAt });
    },
    async finish(timeoutMs) {
      const deadline = Date.now() + timeoutMs;
      while (pending.size && !failure && Date.now() < deadline) await sleep(Math.min(pollMs, Math.max(1, deadline - Date.now())));
      if (failure) throw failure;
    },
    async close() {
      stopped = true;
      clearInterval(timer);
      await running;
    },
  };
}

module.exports = { createFinalityTracker };
