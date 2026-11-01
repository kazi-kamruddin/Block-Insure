const { getReadOnlyContract, getOracleCoordinator } = require("../services/contractService");
const { summarize } = require("../services/protocolMonitoringService");
async function getProtocolMonitoring(req, res, next) {
  let provider;
  try {
    const manager = getReadOnlyContract(); provider = manager.runner.provider;
    const [coordinator, network] = await Promise.all([getOracleCoordinator(manager), provider.getNetwork()]);
    const coordinatorAddress = (await coordinator.getAddress()).toLowerCase();
    const rows = await require("../models/OracleLog").find({ "responseData.deployment.coordinatorAddress": coordinatorAddress,
      "responseData.deployment.chainId": String(network.chainId) }).sort({ createdAt: -1 }).limit(1001).select("requestId queryData.claimVersion responseData.assessment responseData.modelIdentity").lean();
    res.set("Cache-Control", "no-store");
    res.json({ success: true, monitoring: { ...summarize(rows.slice(0, 1000)), limit: 1000, truncated: rows.length > 1000,
      modelIdentities: [...new Set(rows.map((row) => row.responseData?.modelIdentity?.modelIdentityHash).filter(Boolean))],
      activeModelIdentity: await manager.oracleModelVersion(), updatedAt: new Date().toISOString() } });
  } catch { next(Object.assign(new Error("Protocol monitoring unavailable"), { statusCode: 503 })); }
  finally { provider?.destroy?.(); }
}
module.exports = { getProtocolMonitoring };
