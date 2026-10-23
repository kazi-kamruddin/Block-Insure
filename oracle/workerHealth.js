const isWorkerReady = ({ enabled, state, pollIntervalMs, now = Date.now() }) => {
  if (!enabled || !state.initialized || state.lastError) return false;
  const lastSuccess = Date.parse(state.lastSuccessfulPollAt);
  const maxAgeMs = Math.max(30_000, pollIntervalMs * 3);
  return Number.isFinite(lastSuccess) && now >= lastSuccess && now - lastSuccess <= maxAgeMs;
};

module.exports = { isWorkerReady };
