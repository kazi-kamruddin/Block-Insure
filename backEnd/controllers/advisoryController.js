const { getReadOnlyContract, getOracleCoordinator } = require("../services/contractService");
const { createAdvisoryService } = require("../services/xgboostAdvisoryService");
const assess = createAdvisoryService();
const ZERO = `0x${"0".repeat(64)}`;

const getClaimAdvisory = async (req, res, next) => {
  if (req.user?.role !== "ADMIN") return res.status(403).json({ success: false, message: "Admin role required" });
  if (!/^[1-9]\d{0,17}$/.test(req.params.claimId)) return res.status(400).json({ success: false, message: "Invalid claim ID" });
  res.set("Cache-Control", "no-store");
  let provider;
  try {
    const contract = getReadOnlyContract();
    provider = contract.runner.provider;
    const block = await provider.getBlock("latest");
    const tag = { blockTag: block.number };
    if (BigInt(req.params.claimId) >= await contract.claimCounter(tag)) return res.status(404).json({ success: false, message: "Claim not found" });
    const [claim, version, chain] = await Promise.all([
      contract.getClaim(req.params.claimId, tag), contract.claimVersion(req.params.claimId, tag),
      provider.getNetwork(),
    ]);
    if (String(claim.claimId) !== req.params.claimId) return res.status(404).json({ success: false, message: "Claim not found" });
    const coordinator = await getOracleCoordinator(contract);
    const requestId = await coordinator.requestByClaimId(req.params.claimId, tag);
    let registryVersion = await coordinator.currentRegistryVersion(tag), pinnedRequestId = "0", requestBlockHash, requestModelIdentity;
    if (requestId > 0n) {
      const request = await coordinator.getRequest(requestId, tag);
      if (String(request.claimVersion) === String(version)) {
        registryVersion = request.registryVersion; pinnedRequestId = String(requestId);
        requestBlockHash = (await provider.getBlock(Number(request.requestBlock))).hash;
        requestModelIdentity = request.modelVersion;
      }
    }
    if (registryVersion === 0n) return res.json({ success: true, advisory: { status: "UNAVAILABLE", primaryModel: "XGBoost", reason: "REGISTRY_NOT_PUBLISHED", protocolEffect: "NONE" } });
    const snapshot = await coordinator.getRegistrySnapshot(registryVersion, tag);
    const registryRoot = snapshot.root;
    if (!registryRoot || registryRoot === ZERO) throw new Error("Invalid registry snapshot");
    const deploymentBlock = Number(process.env.CONTRACT_DEPLOYMENT_BLOCK || 0);
    if (!Number.isSafeInteger(deploymentBlock) || deploymentBlock < 0 || deploymentBlock > block.number) throw new Error("Invalid deployment block");
    const deployment = await provider.getBlock(deploymentBlock);
    const deploymentId = `${chain.chainId}:${(await contract.getAddress()).toLowerCase()}:${deploymentBlock}:${deployment.hash}`;
    const advisory = await assess({ claim, claimVersion: version, deploymentId, registryRoot, registryVersion,
      snapshotTimestamp: snapshot.publishedAt, requestId: pinnedRequestId, blockHash: block.hash });
    let workerShadow = { status: "UNAVAILABLE", reports: 0 };
    try {
      workerShadow = await require("../services/oracleShadowService").getAgreement({ requestId: pinnedRequestId, claimVersion: version,
        registryRoot, bundleHash: advisory.binding.bundleHash, manifestHash: advisory.binding.manifestHash,
        coordinatorAddress: await coordinator.getAddress(), chainId: chain.chainId, requestBlockHash });
    } catch { /* Optional shadow reporting must never hide a valid Admin assessment. */ }
    // A version change/reorg during assessment must not display stale facts.
    const [currentVersion, canonical] = await Promise.all([contract.claimVersion(req.params.claimId), provider.getBlock(block.number)]);
    if (String(currentVersion) !== String(version) || canonical?.hash !== block.hash) return res.status(409).json({ success: false, message: "Claim or chain changed; refresh the advisory assessment" });
    return res.json({ success: true, advisory: { ...advisory, workerShadow,
      protocolModel: requestModelIdentity ? { identity: String(requestModelIdentity),
        kind: require("../../oracle/runtimeProtocol").resolveRequestModel(requestModelIdentity).kind } : { kind: "NO_REQUEST" } } });
  } catch (error) {
    const known = new Set(["INVALID_CONTEXT_RECORD", "INVALID_CONTEXT_CUTOFF", "CONTEXT_LIMIT_EXCEEDED", "DUPLICATE_CONTEXT_IDENTITY",
      "INVOICE_NOT_IN_COMMITTED_SNAPSHOT", "SNAPSHOT_UNAVAILABLE", "CONTEXT_LIMIT_OR_GAP", "SNAPSHOT_INTEGRITY_FAILURE", "ADVISORY_BUSY"]);
    // Advisory outages never become a zero risk score or an NB substitute.
    // No internal errors, source records or patient identifiers are serialized.
    if (known.has(error.code)) return res.json({ success: true, advisory: { status: "UNAVAILABLE", primaryModel: "XGBoost", reason: error.code, protocolEffect: "NONE" } });
    next(Object.assign(new Error("Advisory assessment unavailable; existing claim workflow remains available"), { statusCode: 503 }));
  } finally {
    provider?.destroy?.();
  }
};
module.exports = { getClaimAdvisory };
