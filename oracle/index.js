const instanceFromEnvironment = process.env.ORACLE_INSTANCE_ID || "1";
const envFile =
  process.env.ORACLE_ENV_FILE ||
  (instanceFromEnvironment === "2" ? ".env.oracle2" : ".env");

require("dotenv").config({ path: envFile });

const axios = require("axios");
const crypto = require("node:crypto");
const nodeHttp = require("node:http");
const path = require("node:path");
const { ethers } = require("ethers");
const InsuranceManagerArtifact = require("./abi/InsuranceManager.json");
const OracleCoordinatorArtifact = require("./abi/OracleCoordinator.json");
const { verifyRegistryProof } = require("./merkleProof");
const { independentlyAssessRecord } = require("./independentAssessment");
const triagePolicy = require("../backEnd/triage-policy.json");
const {
  buildCommitment,
  buildResultHash,
  buildSalt,
} = require("./protocol");
const { loadCursorState, persistCursorState } = require("./cursorState");
const { isWorkerReady } = require("./workerHealth");
const {
  assertRequestModelIdentity,
  loadAndVerifyModelArtifact,
} = require("./modelArtifact");
const { writeEvent } = require("../scripts/observability");

const originalConsole = {
  log: console.log.bind(console),
  warn: console.warn.bind(console),
  error: console.error.bind(console),
};
for (const [method, level] of [["log", "info"], ["warn", "warn"], ["error", "error"]]) {
  console[method] = (...parts) => {
    writeEvent(`Oracle ${instanceFromEnvironment}`, level, ...parts);
    originalConsole[method](...parts);
  };
}

const getRequiredEnv = (key) => {
  const value = process.env[key];
  if (!value) throw new Error(`${key} is missing in ${envFile}`);
  return value;
};

const ORACLE_WORKER_ENABLED = process.env.ORACLE_WORKER_ENABLED !== "false";
const RPC_URL = ORACLE_WORKER_ENABLED
  ? getRequiredEnv("RPC_URL")
  : "http://127.0.0.1:8545";
const CONTRACT_ADDRESS = ORACLE_WORKER_ENABLED
  ? getRequiredEnv("CONTRACT_ADDRESS")
  : ethers.ZeroAddress;
const ORACLE_INSTANCE_ID = process.env.ORACLE_INSTANCE_ID || instanceFromEnvironment;
const ORACLE_PRIVATE_KEY =
  !ORACLE_WORKER_ENABLED
    ? ""
    : ORACLE_INSTANCE_ID === "2" && process.env.ORACLE_PRIVATE_KEY_2
      ? process.env.ORACLE_PRIVATE_KEY_2
      : getRequiredEnv("ORACLE_PRIVATE_KEY");
const BACKEND_API_URL = process.env.BACKEND_API_URL || "http://localhost:5000";
const MOCK_HOSPITAL_API_URL =
  process.env.MOCK_HOSPITAL_API_URL ||
  "http://localhost:5000/mock/hospital/verify";
const ORACLE_START_BLOCK = Number(process.env.ORACLE_START_BLOCK || 0);
const ORACLE_POLL_INTERVAL_MS = Number(process.env.ORACLE_POLL_INTERVAL_MS || 5000);
const ORACLE_HEARTBEAT_INTERVAL_MS = Number(
  process.env.ORACLE_HEARTBEAT_INTERVAL_MS || 30000
);
const ORACLE_HTTP_TIMEOUT_MS = Math.max(
  1_000,
  Number(process.env.ORACLE_HTTP_TIMEOUT_MS || 30_000)
);
const backendHttp = axios.create({ timeout: ORACLE_HTTP_TIMEOUT_MS });
const ORACLE_EVENT_QUERY_CHUNK_SIZE = Math.max(
  1,
  Number(process.env.ORACLE_EVENT_QUERY_CHUNK_SIZE || 2000)
);
const ORACLE_SUBMIT_MAX_ATTEMPTS = Math.max(
  1,
  Number(process.env.ORACLE_SUBMIT_MAX_ATTEMPTS || 3)
);
const ORACLE_SUBMIT_RETRY_DELAY_MS = Math.max(
  0,
  Number(process.env.ORACLE_SUBMIT_RETRY_DELAY_MS || 5000)
);
const ORACLE_API_KEY = process.env.ORACLE_API_KEY || "";
const ORACLE_REGISTRY_SNAPSHOT =
  process.env.ORACLE_REGISTRY_SNAPSHOT ||
  (ORACLE_INSTANCE_ID === "2" ? "oracle2" : "primary");
const ORACLE_CURSOR_FILE =
  process.env.ORACLE_CURSOR_FILE ||
  path.join(__dirname, ".oracle-state", `cursor-${ORACLE_INSTANCE_ID}.json`);
const ORACLE_CURSOR_MODE = String(process.env.ORACLE_CURSOR_MODE || "file")
  .trim()
  .toLowerCase();
if (!["file", "backend"].includes(ORACLE_CURSOR_MODE)) {
  throw new Error("ORACLE_CURSOR_MODE must be file or backend");
}
const ORACLE_HEALTH_PORT = Number(
  process.env.PORT || process.env.ORACLE_HEALTH_PORT || 0
);
const ORACLE_START_RETRY_MS = Math.max(
  5_000,
  Number(process.env.ORACLE_START_RETRY_MS || 30_000)
);
const simulatedNetworkDelayMs =
  ORACLE_INSTANCE_ID === "2"
    ? Number(process.env.ORACLE2_SIMULATED_NETWORK_DELAY_MS || 3000)
    : 0;
const runtimeModelArtifact = loadAndVerifyModelArtifact(
  process.env.MODEL_ARTIFACT_PATH || undefined
);

const provider = new ethers.JsonRpcProvider(RPC_URL);
const oracleWallet = ORACLE_WORKER_ENABLED
  ? new ethers.Wallet(ORACLE_PRIVATE_KEY, provider)
  : null;
const manager = new ethers.Contract(
  CONTRACT_ADDRESS,
  InsuranceManagerArtifact.abi,
  oracleWallet || null
);
let coordinator;
let coordinatorAddress;
let nextOracleScanBlock = ORACLE_START_BLOCK;
let isPolling = false;
let cachedRegistryRoot = ethers.ZeroHash;
let lastHeartbeatSentAt = 0;
const processingRequests = new Set();
let pollTimer = null;
let startRetryTimer = null;
let healthServer = null;
const serviceState = {
  initialized: false,
  startedAt: new Date().toISOString(),
  lastPollAt: null,
  lastSuccessfulPollAt: null,
  lastError: "Waiting for blockchain initialization",
};

const normalizeHash = (value) => String(value || "").trim().toLowerCase();
const sleep = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));
const retryTransaction = async (label, operation) => {
  let lastError;
  for (let attempt = 1; attempt <= ORACLE_SUBMIT_MAX_ATTEMPTS; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt === ORACLE_SUBMIT_MAX_ATTEMPTS) break;
      const delay = ORACLE_SUBMIT_RETRY_DELAY_MS * attempt;
      console.warn(
        `[Oracle ${ORACLE_INSTANCE_ID}] ${label} attempt ${attempt} failed; retrying in ${delay}ms`
      );
      await sleep(delay);
    }
  }
  throw lastError;
};

const loadPersistedCursor = async () => {
  const network = await provider.getNetwork();
  if (ORACLE_CURSOR_MODE === "backend") {
    const response = await backendHttp.get(`${BACKEND_API_URL}/api/oracle/cursor`, {
      params: {
        oracleWallet: oracleWallet.address,
        oracleInstanceId: ORACLE_INSTANCE_ID,
        chainId: network.chainId.toString(),
        contractAddress: coordinatorAddress,
      },
      headers: ORACLE_API_KEY ? { "x-oracle-api-key": ORACLE_API_KEY } : {},
    });
    const remoteCursor = response.data?.cursor;
    nextOracleScanBlock = remoteCursor
      ? Math.max(ORACLE_START_BLOCK, Number(remoteCursor.nextBlock))
      : ORACLE_START_BLOCK;
    return;
  }
  const cursor = loadCursorState({
    filePath: ORACLE_CURSOR_FILE,
    chainId: network.chainId.toString(),
    contractAddress: coordinatorAddress,
    oracleInstanceId: ORACLE_INSTANCE_ID,
    startBlock: ORACLE_START_BLOCK,
  });
  nextOracleScanBlock = cursor.nextBlock;
  if (cursor.found && !cursor.matched) {
    console.warn(`[Oracle ${ORACLE_INSTANCE_ID}] Ignoring cursor from another deployment`);
  }
};

const persistCursor = async () => {
  const network = await provider.getNetwork();
  if (ORACLE_CURSOR_MODE === "backend") {
    const timestamp = new Date().toISOString();
    const message = [
      "Block-Insure oracle cursor",
      ORACLE_INSTANCE_ID,
      oracleWallet.address.toLowerCase(),
      network.chainId.toString(),
      coordinatorAddress.toLowerCase(),
      String(nextOracleScanBlock),
      timestamp,
    ].join(":");
    const signature = await oracleWallet.signMessage(message);
    await backendHttp.put(
      `${BACKEND_API_URL}/api/oracle/cursor`,
      {
        oracleWallet: oracleWallet.address,
        oracleInstanceId: ORACLE_INSTANCE_ID,
        chainId: network.chainId.toString(),
        contractAddress: coordinatorAddress,
        nextBlock: nextOracleScanBlock,
        timestamp,
        signature,
      },
      { headers: ORACLE_API_KEY ? { "x-oracle-api-key": ORACLE_API_KEY } : {} }
    );
    return;
  }
  persistCursorState({
    filePath: ORACLE_CURSOR_FILE,
    chainId: network.chainId.toString(),
    contractAddress: coordinatorAddress,
    oracleInstanceId: ORACLE_INSTANCE_ID,
    nextBlock: nextOracleScanBlock,
  });
};

const heartbeatMessage = ({ timestamp, requestId, claimId, txHash }) =>
  [
    "Block-Insure oracle heartbeat",
    ORACLE_INSTANCE_ID,
    oracleWallet.address.toLowerCase(),
    timestamp,
    requestId || "",
    claimId || "",
    String(txHash || "").toLowerCase(),
  ].join(":");

const sendHeartbeat = async ({ requestId = "", claimId = "", txHash = "", force = false } = {}) => {
  if (!force && Date.now() - lastHeartbeatSentAt < ORACLE_HEARTBEAT_INTERVAL_MS) return;
  try {
    const timestamp = new Date().toISOString();
    const heartbeatSignature = await oracleWallet.signMessage(
      heartbeatMessage({ timestamp, requestId, claimId, txHash })
    );
    await backendHttp.post(
      `${BACKEND_API_URL}/api/oracle/heartbeat`,
      {
        oracleWallet: oracleWallet.address,
        oracleInstanceId: ORACLE_INSTANCE_ID,
        label: `Oracle ${ORACLE_INSTANCE_ID}`,
        registrySnapshot: ORACLE_REGISTRY_SNAPSHOT,
        registryRoot: cachedRegistryRoot,
        lastProcessedRequestId: requestId,
        lastProcessedClaimId: claimId,
        lastTxHash: txHash,
        configIdentity: `snapshot:${ORACLE_REGISTRY_SNAPSHOT}`,
        heartbeatTimestamp: timestamp,
        heartbeatSignature,
      },
      { headers: ORACLE_API_KEY ? { "x-oracle-api-key": ORACLE_API_KEY } : {} }
    );
    lastHeartbeatSentAt = Date.now();
  } catch (error) {
    console.warn(`[Oracle ${ORACLE_INSTANCE_ID}] Heartbeat failed:`, error.message);
  }
};

const saveOracleLog = async (payload) => {
  try {
    await backendHttp.post(`${BACKEND_API_URL}/api/oracle/logs`, payload, {
      headers: ORACLE_API_KEY ? { "x-oracle-api-key": ORACLE_API_KEY } : {},
    });
  } catch (error) {
    console.warn(`[Oracle ${ORACLE_INSTANCE_ID}] Oracle log save failed:`, error.message);
  }
};

const validateAppealCommitment = async (request, claim, response) => {
  if (Number(request.claimVersion) <= 1) return true;
  const commitment = response.appealCommitment;
  const payload = commitment?.payload;
  if (!payload || payload.schema !== "BLOCK_INSURE_APPEAL_V1") return false;

  const computedHash = `0x${crypto
    .createHash("sha256")
    .update(JSON.stringify(payload), "utf8")
    .digest("hex")}`;
  if (normalizeHash(computedHash) !== normalizeHash(commitment.appealReasonHash)) {
    return false;
  }

  const query = response.query || {};
  const expectedInvoiceHash = payload.proposedInvoiceNumber
    ? ethers.keccak256(ethers.toUtf8Bytes(payload.proposedInvoiceNumber))
    : claim.invoiceHash;
  const expectedAmount = payload.proposedClaimAmountEth || ethers.formatEther(claim.claimAmount);
  if (
    String(payload.claimId) !== claim.claimId.toString() ||
    String(query.claimId) !== claim.claimId.toString() ||
    normalizeHash(query.invoiceHash) !== normalizeHash(expectedInvoiceHash) ||
    String(query.hospitalId) !== String(payload.proposedHospitalId || claim.hospitalId) ||
    String(query.claimType) !== String(payload.proposedClaimType || claim.claimType) ||
    String(query.claimAmountEth) !== String(expectedAmount)
  ) {
    return false;
  }

  const [receipt, transaction] = await Promise.all([
    provider.getTransactionReceipt(commitment.transactionHash),
    provider.getTransaction(commitment.transactionHash),
  ]);
  if (
    !receipt ||
    !transaction ||
    Number(receipt.status) !== 1 ||
    normalizeHash(transaction.to) !== normalizeHash(CONTRACT_ADDRESS) ||
    normalizeHash(transaction.from) !== normalizeHash(claim.claimantWallet)
  ) {
    return false;
  }
  return receipt.logs.some((log) => {
    try {
      const event = manager.interface.parseLog(log);
      return (
        event?.name === "ClaimAppealed" &&
        event.args.claimId.toString() === claim.claimId.toString() &&
        normalizeHash(event.args.appealReasonHash) === normalizeHash(computedHash)
      );
    } catch {
      return false;
    }
  });
};

const classifyResponse = (request, claim, response, appealCommitmentValid) => {
  const usesAppealCorrection =
    Number(request.claimVersion) > 1 &&
    response.query?.source === "PENDING_APPEAL_CORRECTION";
  const evaluationClaim = usesAppealCorrection && appealCommitmentValid
    ? {
        hospitalId: response.query.hospitalId,
        invoiceHash: response.query.invoiceHash,
        claimAmount: ethers.parseEther(String(response.query.claimAmountEth)),
        claimType: response.query.claimType,
        incidentDate: claim.incidentDate,
      }
    : claim;
  const proof = response.merkleProof;
  const localRoot = proof?.rootHash || "";
  const proofValid = verifyRegistryProof(proof);
  const rootMatches =
    normalizeHash(localRoot) !== "" &&
    normalizeHash(localRoot) === normalizeHash(request.registryRoot);
  const snapshotMatches = response.registrySnapshot === ORACLE_REGISTRY_SNAPSHOT;
  const recordMatchesClaim =
    proofValid &&
    normalizeHash(proof.canonicalRecord?.invoiceHash) === normalizeHash(evaluationClaim.invoiceHash) &&
    String(proof.canonicalRecord?.hospitalId || "") === String(evaluationClaim.hospitalId);
  const independent = recordMatchesClaim
    ? independentlyAssessRecord({
        record: proof.canonicalRecord,
        claim: {
          hospitalId: evaluationClaim.hospitalId,
          invoiceHash: evaluationClaim.invoiceHash,
          claimAmountEth: ethers.formatEther(evaluationClaim.claimAmount),
          claimType: evaluationClaim.claimType,
          incidentDate: evaluationClaim.incidentDate.toString(),
        },
        modelArtifact: runtimeModelArtifact,
        triagePolicy,
      })
    : null;

  let verificationCode = "VERIFIED";
  if (Number(request.claimVersion) > 1 && !appealCommitmentValid) {
    verificationCode = "APPEAL_COMMITMENT_MISMATCH";
  } else if (!snapshotMatches) verificationCode = "SNAPSHOT_ID_MISMATCH";
  else if (!proofValid) verificationCode = "INVALID_MERKLE_PROOF";
  else if (!rootMatches) verificationCode = "REGISTRY_ROOT_MISMATCH";
  else if (!recordMatchesClaim) verificationCode = "CLAIM_RECORD_MISMATCH";
  else if (!independent?.verified) verificationCode = independent?.verificationCode || "INDEPENDENT_ASSESSMENT_FAILED";

  const verified = verificationCode === "VERIFIED";
  return {
    verified,
    verificationCode,
    backendAdvisoryVerified: response.verified === true,
    independentAssessment: independent,
    snapshotMatches,
    proofValid,
    rootMatches,
    recordMatchesClaim,
    localRoot,
    leafHash: proofValid ? proof.leafHash : ethers.ZeroHash,
    riskLevel: independent?.riskLevel || "HIGH",
    remarks: verified
      ? "Oracle independently verified the committed registry record"
      : verificationCode,
  };
};

const waitForRevealPhase = async (requestId) => {
  for (;;) {
    const request = await coordinator.getRequest(requestId);
    if (request.isFulfilled || (await coordinator.hasRevealed(requestId, oracleWallet.address))) {
      return request;
    }
    const blockNumber = await provider.getBlockNumber();
    const allCommitted =
      Number(await coordinator.commitmentCount(requestId)) ===
      Number(request.expectedResponses);
    if (allCommitted || blockNumber > Number(request.commitDeadlineBlock)) return request;
    if (blockNumber > Number(request.revealDeadlineBlock)) {
      throw new Error(`Request ${requestId} reveal window expired`);
    }
    await sleep(Math.min(ORACLE_POLL_INTERVAL_MS, 2000));
  }
};

const handleOracleRequested = async (requestId, claimId) => {
  const requestKey = requestId.toString();
  if (processingRequests.has(requestKey)) return false;
  processingRequests.add(requestKey);
  const startedAt = Date.now();

  try {
    let request = await coordinator.getRequest(requestId);
    assertRequestModelIdentity(request.modelVersion, runtimeModelArtifact);
    if (request.isFulfilled || (await coordinator.hasRevealed(requestId, oracleWallet.address))) {
      return true;
    }
    if (!(await coordinator.eligibleForRequest(requestId, oracleWallet.address))) {
      console.warn(`[Oracle ${ORACLE_INSTANCE_ID}] Not eligible for request ${requestKey}`);
      return true;
    }
    if (simulatedNetworkDelayMs > 0) await sleep(simulatedNetworkDelayMs);

    const claim = await manager.getClaim(claimId);
    const queryData = {
      claimId: claim.claimId.toString(),
      hospitalId: claim.hospitalId,
      invoiceHash: claim.invoiceHash,
      claimAmountWei: claim.claimAmount.toString(),
      claimAmountEth: ethers.formatEther(claim.claimAmount),
      claimType: claim.claimType,
      incidentDate: claim.incidentDate.toString(),
      claimVersion: request.claimVersion.toString(),
      registryVersion: request.registryVersion.toString(),
      registryRoot: request.registryRoot,
      modelVersion: request.modelVersion,
      modelArtifactHash: runtimeModelArtifact.artifactHash,
    };
    const hospitalResponse = await backendHttp.get(MOCK_HOSPITAL_API_URL, {
      params: { ...queryData, registrySnapshot: ORACLE_REGISTRY_SNAPSHOT },
      headers: ORACLE_API_KEY ? { "x-oracle-api-key": ORACLE_API_KEY } : {},
    });
    const appealCommitmentValid = await validateAppealCommitment(
      request,
      claim,
      hospitalResponse.data
    );
    const assessment = classifyResponse(
      request,
      claim,
      hospitalResponse.data,
      appealCommitmentValid
    );
    const resultHash = buildResultHash({
      request,
      verified: assessment.verified,
      verificationCode: assessment.verificationCode,
      leafHash: assessment.leafHash,
    });
    const salt = buildSalt({
      privateKey: ORACLE_PRIVATE_KEY,
      requestId,
      oracleAddress: oracleWallet.address,
    });
    const commitment = buildCommitment(request, assessment.verified, resultHash, salt);
    const existingCommitment = await coordinator.commitments(requestId, oracleWallet.address);

    if (existingCommitment === ethers.ZeroHash) {
      const commitTx = await retryTransaction("Commit", () =>
        coordinator.commitOracleResult(requestId, commitment)
      );
      await commitTx.wait();
      console.log(`[Oracle ${ORACLE_INSTANCE_ID}] Commitment sent: ${commitTx.hash}`);
    } else if (normalizeHash(existingCommitment) !== normalizeHash(commitment)) {
      throw new Error(`Stored commitment for request ${requestKey} differs from recomputed result`);
    }

    request = await waitForRevealPhase(requestId);
    if (request.isFulfilled) return true;

    const revealTx = await retryTransaction("Reveal", () =>
      coordinator.revealOracleResult(
        requestId,
        assessment.verified,
        resultHash,
        request.claimVersion,
        request.registryVersion,
        request.modelVersion,
        salt
      )
    );
    await revealTx.wait();

    const oracleResponse = {
      protocol: "exact-result-commit-reveal-v1",
      modelIdentity: {
        modelVersion: runtimeModelArtifact.modelVersion,
        modelIdentityHash: runtimeModelArtifact.modelIdentityHash,
        artifactHash: runtimeModelArtifact.artifactHash,
        trainingDataHash: runtimeModelArtifact.trainingDataHash,
        featureSchemaVersion: runtimeModelArtifact.featureSchemaVersion,
        calibrationVersion: runtimeModelArtifact.calibration.version,
      },
      requestId: requestKey,
      claimId: claimId.toString(),
      queryData,
      hospitalVerification: hospitalResponse.data,
      assessment,
      resultHash,
      commitment,
      registrySnapshot: ORACLE_REGISTRY_SNAPSHOT,
    };
    await saveOracleLog({
      requestId: requestKey,
      claimId: claimId.toString(),
      oracleType: "HOSPITAL",
      queryData,
      responseData: oracleResponse,
      resultHash,
      verified: assessment.verified,
      riskLevel: assessment.riskLevel,
      remarks: assessment.remarks,
      submittedTxHash: revealTx.hash,
      responseTimeMs: Date.now() - startedAt,
      oracleWallet: oracleWallet.address,
      oracleInstanceId: ORACLE_INSTANCE_ID,
    });
    await sendHeartbeat({
      requestId: requestKey,
      claimId: claimId.toString(),
      txHash: revealTx.hash,
      force: true,
    });
    console.log(
      `[Oracle ${ORACLE_INSTANCE_ID}] Revealed ${assessment.verificationCode}: ${revealTx.hash}`
    );
    return true;
  } finally {
    processingRequests.delete(requestKey);
  }
};

const pollOracleRequests = async () => {
  if (isPolling) return;
  isPolling = true;
  serviceState.lastPollAt = new Date().toISOString();
  try {
    const latestBlock = await provider.getBlockNumber();
    if (nextOracleScanBlock > latestBlock) {
      await sendHeartbeat();
      serviceState.lastSuccessfulPollAt = new Date().toISOString();
      serviceState.lastError = "";
      return;
    }
    const endBlock = Math.min(
      latestBlock,
      nextOracleScanBlock + ORACLE_EVENT_QUERY_CHUNK_SIZE - 1
    );
    const [requestEvents, registryEvents] = await Promise.all([
      coordinator.queryFilter(
        coordinator.filters.OracleRequested(),
        nextOracleScanBlock,
        endBlock
      ),
      coordinator.queryFilter(
        coordinator.filters.RegistrySnapshotPublished(),
        nextOracleScanBlock,
        endBlock
      ),
    ]);
    const latestRegistryEvent = registryEvents.at(-1);
    if (latestRegistryEvent) cachedRegistryRoot = latestRegistryEvent.args.root;

    for (const event of requestEvents) {
      await handleOracleRequested(event.args.requestId, event.args.claimId);
    }
    nextOracleScanBlock = endBlock + 1;
    await persistCursor();
    await sendHeartbeat();
    serviceState.lastSuccessfulPollAt = new Date().toISOString();
    serviceState.lastError = "";
  } catch (error) {
    serviceState.lastError = error.message;
    console.error(`[Oracle ${ORACLE_INSTANCE_ID}] Polling failed:`, error.message);
  } finally {
    isPolling = false;
  }
};

const startOracle = async () => {
  coordinatorAddress = await manager.oracleCoordinator();
  coordinator = new ethers.Contract(
    coordinatorAddress,
    OracleCoordinatorArtifact.abi,
    oracleWallet
  );
  cachedRegistryRoot = await coordinator.currentRegistryRoot();

  console.log(`[Oracle ${ORACLE_INSTANCE_ID}] Wallet: ${oracleWallet.address}`);
  console.log(`[Oracle ${ORACLE_INSTANCE_ID}] Manager: ${CONTRACT_ADDRESS}`);
  console.log(`[Oracle ${ORACLE_INSTANCE_ID}] Coordinator: ${coordinatorAddress}`);
  console.log(`[Oracle ${ORACLE_INSTANCE_ID}] Registry source: ${ORACLE_REGISTRY_SNAPSHOT}`);
  console.log(`[Oracle ${ORACLE_INSTANCE_ID}] Frozen model: ${runtimeModelArtifact.modelIdentityHash}`);

  const oracleRole = await manager.ORACLE_ROLE();
  if (!(await manager.hasRole(oracleRole, oracleWallet.address))) {
    throw new Error("Configured wallet does not have ORACLE_ROLE");
  }
  await loadPersistedCursor();
  await pollOracleRequests();
  serviceState.initialized = true;
  pollTimer = setInterval(pollOracleRequests, ORACLE_POLL_INTERVAL_MS);
};

const workerReady = () => isWorkerReady({
  enabled: ORACLE_WORKER_ENABLED,
  state: serviceState,
  pollIntervalMs: ORACLE_POLL_INTERVAL_MS,
});

const sanitizedHealth = () => ({
  success: workerReady(),
  status: workerReady() ? "ready" : serviceState.initialized ? "degraded" : "starting",
  oracleInstanceId: ORACLE_INSTANCE_ID,
  workerEnabled: ORACLE_WORKER_ENABLED,
  oracleWallet: oracleWallet?.address || "",
  registrySnapshot: ORACLE_REGISTRY_SNAPSHOT,
  cursorMode: ORACLE_CURSOR_MODE,
  nextScanBlock: nextOracleScanBlock,
  startedAt: serviceState.startedAt,
  lastPollAt: serviceState.lastPollAt,
  lastSuccessfulPollAt: serviceState.lastSuccessfulPollAt,
  healthDetail: !workerReady()
    ? ORACLE_WORKER_ENABLED
      ? "Oracle worker is not ready; inspect private service logs"
      : "Oracle worker is disabled until a shared blockchain is configured"
    : null,
  timestamp: new Date().toISOString(),
});

const startHealthServer = () => {
  if (!Number.isSafeInteger(ORACLE_HEALTH_PORT) || ORACLE_HEALTH_PORT <= 0) return;
  healthServer = nodeHttp.createServer((request, response) => {
    response.setHeader("Content-Type", "application/json; charset=utf-8");
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("Access-Control-Allow-Origin", "*");
    if (request.method !== "GET") {
      response.writeHead(405).end(JSON.stringify({ success: false, message: "Method not allowed" }));
      return;
    }
    if (request.url === "/" || request.url === "/health/live") {
      response.writeHead(200).end(JSON.stringify({
        ...sanitizedHealth(),
        success: true,
        status: workerReady() ? "ready" : "alive",
      }));
      return;
    }
    if (request.url === "/health/ready") {
      response.writeHead(workerReady() ? 200 : 503).end(
        JSON.stringify(sanitizedHealth())
      );
      return;
    }
    response.writeHead(404).end(JSON.stringify({ success: false, message: "Not found" }));
  });
  healthServer.listen(ORACLE_HEALTH_PORT, "0.0.0.0", () => {
    console.log(`[Oracle ${ORACLE_INSTANCE_ID}] Health server listening on port ${ORACLE_HEALTH_PORT}`);
  });
};

const startWithRetry = async () => {
  if (!ORACLE_WORKER_ENABLED) {
    serviceState.lastError = "Oracle worker is disabled until a shared blockchain deployment is configured";
    return;
  }
  try {
    await startOracle();
  } catch (error) {
    serviceState.initialized = false;
    serviceState.lastError = error.message;
    console.error(
      `[Oracle ${ORACLE_INSTANCE_ID}] Initialization failed; retrying in ${ORACLE_START_RETRY_MS}ms:`,
      error.message
    );
    startRetryTimer = setTimeout(startWithRetry, ORACLE_START_RETRY_MS);
  }
};

const shutdown = () => {
  if (pollTimer) clearInterval(pollTimer);
  if (startRetryTimer) clearTimeout(startRetryTimer);
  healthServer?.close(() => process.exit(0));
  if (!healthServer) process.exit(0);
  setTimeout(() => process.exit(0), 5_000).unref();
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

startHealthServer();
startWithRetry();
