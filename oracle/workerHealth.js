const isWorkerReady = ({ enabled, state, pollIntervalMs, maxLagBlocks = 150, now = Date.now() }) => {
  if (!enabled || !state.initialized || state.lastError) return false;
  if (!Number.isSafeInteger(state.scanHead) || !Number.isSafeInteger(state.nextScanBlock)) return false;
  const headAt = Date.parse(state.headObservedAt);
  if (!Number.isFinite(headAt) || now < headAt || now - headAt > Math.max(30_000, pollIntervalMs * 3)) return false;
  if (Math.max(0, state.scanHead - state.nextScanBlock + 1) > maxLagBlocks) return false;
  const lastSuccess = Date.parse(state.lastSuccessfulPollAt);
  const maxAgeMs = Math.max(30_000, pollIntervalMs * 3);
  return Number.isFinite(lastSuccess) && now >= lastSuccess && now - lastSuccess <= maxAgeMs;
};

module.exports = { isWorkerReady };
