const instanceFromEnvironment = process.env.ORACLE_INSTANCE_ID || "1";
const envFile =
  process.env.ORACLE_ENV_FILE ||
  (instanceFromEnvironment === "2" ? ".env.oracle2" : ".env");

require("dotenv").config({ path: envFile });

const axios = require("axios");
const path = require("node:path");
const { ethers } = require("ethers");
const InsuranceManagerArtifact = require("./abi/InsuranceManager.json");
const { verifyRegistryProof } = require("./merkleProof");
const { loadCursorState, persistCursorState } = require("./cursorState");
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

/* ----------------------------- Config ---------------------------------- */

const getRequiredEnv = (key) => {
  const value = process.env[key];

  if (!value) {
    throw new Error(`${key} is missing in .env`);
  }

  return value;
};

const RPC_URL = getRequiredEnv("RPC_URL");
const CONTRACT_ADDRESS = getRequiredEnv("CONTRACT_ADDRESS");
const ORACLE_INSTANCE_ID = process.env.ORACLE_INSTANCE_ID || instanceFromEnvironment;
// Simulates network propagation variance between geographically distributed nodes.
const oracle2SimulatedNetworkDelayMs =
  ORACLE_INSTANCE_ID === "2"
    ? Number(process.env.ORACLE2_SIMULATED_NETWORK_DELAY_MS || 3000)
    : 0;
const ORACLE_PRIVATE_KEY =
  ORACLE_INSTANCE_ID === "2" && process.env.ORACLE_PRIVATE_KEY_2
    ? process.env.ORACLE_PRIVATE_KEY_2
    : getRequiredEnv("ORACLE_PRIVATE_KEY");

const BACKEND_API_URL = process.env.BACKEND_API_URL || "http://localhost:5000";
const MOCK_HOSPITAL_API_URL =
  process.env.MOCK_HOSPITAL_API_URL ||
  "http://localhost:5000/mock/hospital/verify";

const ORACLE_START_BLOCK = Number(process.env.ORACLE_START_BLOCK || 0);
const ORACLE_POLL_INTERVAL_MS = Number(
  process.env.ORACLE_POLL_INTERVAL_MS || 5000
);
const ORACLE_HEARTBEAT_INTERVAL_MS = Number(
  process.env.ORACLE_HEARTBEAT_INTERVAL_MS || 30000
);
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

/* ----------------------------- Setup ----------------------------------- */

const provider = new ethers.JsonRpcProvider(RPC_URL);
const oracleWallet = new ethers.Wallet(ORACLE_PRIVATE_KEY, provider);

const contract = new ethers.Contract(
  CONTRACT_ADDRESS,
  InsuranceManagerArtifact.abi,
  oracleWallet
);

const processingRequests = new Set();
let nextOracleScanBlock = ORACLE_START_BLOCK;
let isPolling = false;
let cachedRegistryRoot = ethers.ZeroHash;
let lastHeartbeatSentAt = 0;

/* ----------------------------- Helpers --------------------------------- */

const buildResultHash = (oracleResponse) => {
  return ethers.keccak256(ethers.toUtf8Bytes(JSON.stringify(oracleResponse)));
};

const normalizeHash = (value) => String(value || "").trim().toLowerCase();
const sleep = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

const buildHeartbeatMessage = ({
  timestamp,
  lastProcessedRequestId,
  lastProcessedClaimId,
  lastTxHash,
}) =>
  [
    "Block-Insure oracle heartbeat",
    ORACLE_INSTANCE_ID,
    oracleWallet.address.toLowerCase(),
    timestamp,
    lastProcessedRequestId,
    lastProcessedClaimId,
    String(lastTxHash || "").toLowerCase(),
  ].join(":");

const loadPersistedCursor = async () => {
  try {
    const network = await provider.getNetwork();
    const cursor = loadCursorState({
      filePath: ORACLE_CURSOR_FILE,
      chainId: network.chainId.toString(),
      contractAddress: CONTRACT_ADDRESS,
      oracleInstanceId: ORACLE_INSTANCE_ID,
      startBlock: ORACLE_START_BLOCK,
    });
    nextOracleScanBlock = cursor.nextBlock;

    if (cursor.found && !cursor.matched) {
      console.warn(
        `[Oracle ${ORACLE_INSTANCE_ID}] Ignoring cursor state from a different deployment`
      );
    }
  } catch (error) {
    console.warn(
      `[Oracle ${ORACLE_INSTANCE_ID}] Could not load cursor state:`,
      error.message
    );
  }
};

const persistCursor = async () => {
  const network = await provider.getNetwork();
  persistCursorState({
    filePath: ORACLE_CURSOR_FILE,
    chainId: network.chainId.toString(),
    contractAddress: CONTRACT_ADDRESS,
    oracleInstanceId: ORACLE_INSTANCE_ID,
    nextBlock: nextOracleScanBlock,
  });
};

const saveOracleLog = async ({
  requestId,
  claimId,
  oracleType,
  queryData,
  responseData,
  resultHash,
  verified,
  riskLevel,
  remarks,
  submittedTxHash,
  responseTimeMs,
}) => {
  try {
    await axios.post(
      `${BACKEND_API_URL}/api/oracle/logs`,
      {
        requestId,
        claimId,
        oracleType,
        queryData,
        responseData,
        resultHash,
        verified,
        riskLevel,
        remarks,
        submittedTxHash,
        responseTimeMs,
        oracleWallet: oracleWallet.address,
        oracleInstanceId: ORACLE_INSTANCE_ID,
      },
      {
        headers: ORACLE_API_KEY ? { "x-oracle-api-key": ORACLE_API_KEY } : {},
      }
    );

    console.log(`[Oracle ${ORACLE_INSTANCE_ID}] Oracle log saved to backend`);
  } catch (error) {
    console.warn(`[Oracle ${ORACLE_INSTANCE_ID}] Oracle log save failed:`, error.message);
  }
};

const sendHeartbeat = async ({
  lastProcessedRequestId = "",
  lastProcessedClaimId = "",
  lastTxHash = "",
  force = false,
} = {}) => {
  if (
    !force &&
    Date.now() - lastHeartbeatSentAt < ORACLE_HEARTBEAT_INTERVAL_MS
  ) {
    return;
  }

  try {
    const heartbeatTimestamp = new Date().toISOString();
    const heartbeatSignature = await oracleWallet.signMessage(
      buildHeartbeatMessage({
        timestamp: heartbeatTimestamp,
        lastProcessedRequestId,
        lastProcessedClaimId,
        lastTxHash,
      })
    );
    await axios.post(
      `${BACKEND_API_URL}/api/oracle/heartbeat`,
      {
        oracleWallet: oracleWallet.address,
        oracleInstanceId: ORACLE_INSTANCE_ID,
        label: `Oracle ${ORACLE_INSTANCE_ID}`,
        registrySnapshot: ORACLE_REGISTRY_SNAPSHOT,
        registryRoot: cachedRegistryRoot,
        lastProcessedRequestId,
        lastProcessedClaimId,
        lastTxHash,
        configIdentity: `snapshot:${ORACLE_REGISTRY_SNAPSHOT}`,
        heartbeatTimestamp,
        heartbeatSignature,
      },
      {
        headers: ORACLE_API_KEY ? { "x-oracle-api-key": ORACLE_API_KEY } : {},
      }
    );
    lastHeartbeatSentAt = Date.now();
  } catch (error) {
    console.warn(`[Oracle ${ORACLE_INSTANCE_ID}] Heartbeat failed:`, error.message);
  }
};

const submitWithRetry = async (
  requestId,
  verified,
  resultHash,
  riskLevel,
  remarks
) => {
  let lastError;

  for (let attempt = 1; attempt <= ORACLE_SUBMIT_MAX_ATTEMPTS; attempt += 1) {
    try {
      return await contract.submitOracleResult(
        requestId,
        verified,
        resultHash,
        riskLevel,
        remarks
      );
    } catch (error) {
      lastError = error;
      if (attempt === ORACLE_SUBMIT_MAX_ATTEMPTS) break;

      const delay = ORACLE_SUBMIT_RETRY_DELAY_MS * attempt;
      console.warn(
        `[Oracle ${ORACLE_INSTANCE_ID}] Submit attempt ${attempt} failed. Retrying in ${delay}ms...`
      );
      await sleep(delay);
    }
  }

  throw lastError;
};

/* ----------------------------- Handler --------------------------------- */

const handleOracleRequested = async (requestId, claimId, oracleType) => {
  const requestKey = requestId.toString();

  if (processingRequests.has(requestKey)) {
    return false;
  }

  processingRequests.add(requestKey);
  const startedAt = Date.now();

  try {
    const oracleRequest = await contract.getOracleRequest(requestId);

    if (oracleRequest.isFulfilled) {
      return true;
    }

    if (await contract.oracleHasConfirmed(requestId, oracleWallet.address)) {
      console.log(
        `[Oracle ${ORACLE_INSTANCE_ID}] Request ${requestKey} was already confirmed by this oracle`
      );
      return true;
    }

    console.log(`\n[Oracle ${ORACLE_INSTANCE_ID}] OracleRequested event received`);
    console.log(`[Oracle ${ORACLE_INSTANCE_ID}] Request ID:`, requestId.toString());
    console.log(`[Oracle ${ORACLE_INSTANCE_ID}] Claim ID:`, claimId.toString());
    console.log(`[Oracle ${ORACLE_INSTANCE_ID}] Oracle Type:`, oracleType);

    if (oracle2SimulatedNetworkDelayMs > 0) {
      console.log(
        `[Oracle ${ORACLE_INSTANCE_ID}] Simulating ${oracle2SimulatedNetworkDelayMs}ms of network propagation variance...`
      );
      await sleep(oracle2SimulatedNetworkDelayMs);

      const refreshedRequest = await contract.getOracleRequest(requestId);

      if (refreshedRequest.isFulfilled) {
        console.log(
          `[Oracle ${ORACLE_INSTANCE_ID}] Request already finalized while waiting`
        );
        return true;
      }

      if (await contract.oracleHasConfirmed(requestId, oracleWallet.address)) {
        console.log(
          `[Oracle ${ORACLE_INSTANCE_ID}] Request ${requestKey} was confirmed while waiting`
        );
        return true;
      }
    }

    const claim = await contract.getClaim(claimId);

    const queryData = {
      hospitalId: claim.hospitalId,
      invoiceHash: claim.invoiceHash,
      claimId: claim.claimId.toString(),
      claimAmountWei: claim.claimAmount.toString(),
      claimAmountEth: ethers.formatEther(claim.claimAmount),
      claimType: claim.claimType,
      incidentDate: claim.incidentDate.toString(),
    };

    console.log(`[Oracle ${ORACLE_INSTANCE_ID}] Checking mock hospital API...`);
    console.log(queryData);

    const hospitalResponse = await axios.get(MOCK_HOSPITAL_API_URL, {
      params: {
        hospitalId: claim.hospitalId,
        invoiceHash: claim.invoiceHash,
        claimAmountWei: claim.claimAmount.toString(),
        claimAmountEth: ethers.formatEther(claim.claimAmount),
        claimType: claim.claimType,
        incidentDate: claim.incidentDate.toString(),
        registrySnapshot: ORACLE_REGISTRY_SNAPSHOT,
      },
      headers: ORACLE_API_KEY
        ? { "x-oracle-api-key": ORACLE_API_KEY }
        : {},
    });

    const [registryRoot, registryTimestamp, registryBlock] = await Promise.all([
      contract.registryMerkleRoot(),
      contract.registrySnapshotTimestamp(),
      contract.registrySnapshotBlock(),
    ]);
    const onChainSnapshot = {
      root: registryRoot,
      timestamp: registryTimestamp,
      blockNumber: registryBlock,
    };
    const localMerkleRoot = hospitalResponse.data.merkleProof?.rootHash || "";
    const onChainMerkleRoot = onChainSnapshot.root || onChainSnapshot[0];
    const registrySnapshotTimestamp =
      onChainSnapshot.timestamp || onChainSnapshot[1];
    const registrySnapshotBlock =
      onChainSnapshot.blockNumber || onChainSnapshot[2];
    const merkleRootMatchesChain =
      normalizeHash(localMerkleRoot) !== "" &&
      normalizeHash(localMerkleRoot) === normalizeHash(onChainMerkleRoot);
    const registrySnapshotMatches =
      hospitalResponse.data.registrySnapshot === ORACLE_REGISTRY_SNAPSHOT;
    const merkleProofVerifiedLocally = verifyRegistryProof(
      hospitalResponse.data.merkleProof
    );
    const hospitalVerified = hospitalResponse.data.verified === true;
    const verified =
      hospitalVerified &&
      registrySnapshotMatches &&
      merkleProofVerifiedLocally &&
      merkleRootMatchesChain;
    const riskLevel =
      !registrySnapshotMatches ||
      !merkleProofVerifiedLocally ||
      !merkleRootMatchesChain
        ? "HIGH"
        : hospitalResponse.data.riskLevel || (verified ? "LOW" : "HIGH");

    const remarks =
      !registrySnapshotMatches
        ? "Hospital registry snapshot identity mismatch"
        : !merkleProofVerifiedLocally
          ? "Hospital registry Merkle proof failed local verification"
          : !merkleRootMatchesChain
        ? "Hospital registry Merkle root mismatch"
        : hospitalResponse.data.message ||
          (verified ? "Hospital record matched" : "Hospital record mismatch");

    const oracleResponse = {
      requestId: requestId.toString(),
      claimId: claimId.toString(),
      oracleType,
      queryData,
      hospitalVerification: hospitalResponse.data,
      hospitalVerified,
      registrySnapshotMatches,
      merkleProofVerifiedLocally,
      merkleRootMatchesChain,
      registryCommitment: {
        localRoot: localMerkleRoot,
        onChainRoot: onChainMerkleRoot,
        snapshotTimestamp: registrySnapshotTimestamp.toString(),
        snapshotBlock: registrySnapshotBlock.toString(),
      },
      verified,
      riskLevel,
      remarks,
      checkedAt: new Date().toISOString(),
      oracleInstanceId: ORACLE_INSTANCE_ID,
      oracleWallet: oracleWallet.address,
      registrySnapshot: ORACLE_REGISTRY_SNAPSHOT,
    };

    const resultHash = buildResultHash(oracleResponse);

    console.log(`[Oracle ${ORACLE_INSTANCE_ID}] Submitting oracle result...`);
    console.log(`[Oracle ${ORACLE_INSTANCE_ID}] Verified:`, verified);
    console.log(`[Oracle ${ORACLE_INSTANCE_ID}] Risk level:`, riskLevel);
    console.log(`[Oracle ${ORACLE_INSTANCE_ID}] Merkle root matches chain:`, merkleRootMatchesChain);
    console.log(
      `[Oracle ${ORACLE_INSTANCE_ID}] Merkle proof verified locally:`,
      merkleProofVerifiedLocally
    );
    console.log(`[Oracle ${ORACLE_INSTANCE_ID}] Result hash:`, resultHash);

    const tx = await submitWithRetry(
      requestId,
      verified,
      resultHash,
      riskLevel,
      remarks
    );

    console.log(`[Oracle ${ORACLE_INSTANCE_ID}] Oracle tx sent:`, tx.hash);

    await tx.wait();

    console.log(`[Oracle ${ORACLE_INSTANCE_ID}] Oracle confirmation recorded on-chain`);
    const responseTimeMs = Date.now() - startedAt;

    await saveOracleLog({
      requestId: requestId.toString(),
      claimId: claimId.toString(),
      oracleType,
      queryData,
      responseData: oracleResponse,
      resultHash,
      verified,
      riskLevel,
      remarks,
      submittedTxHash: tx.hash,
      responseTimeMs,
    });

    await sendHeartbeat({
      lastProcessedRequestId: requestId.toString(),
      lastProcessedClaimId: claimId.toString(),
      lastTxHash: tx.hash,
      force: true,
    });
    return true;
  } catch (error) {
    console.error(`[Oracle ${ORACLE_INSTANCE_ID}] Oracle handler failed:`, error.message);
    throw error;
  } finally {
    processingRequests.delete(requestKey);
  }
};

/* ----------------------------- Polling --------------------------------- */

const pollOracleRequests = async () => {
  if (isPolling) {
    return;
  }

  isPolling = true;

  try {
    const latestBlock = await provider.getBlockNumber();

    if (nextOracleScanBlock > latestBlock) {
      await sendHeartbeat();
      return;
    }

    const chunkEndBlock = Math.min(
      latestBlock,
      nextOracleScanBlock + ORACLE_EVENT_QUERY_CHUNK_SIZE - 1
    );
    const [events, registryEvents] = await Promise.all([
      contract.queryFilter(
        contract.filters.OracleRequested(),
        nextOracleScanBlock,
        chunkEndBlock
      ),
      contract.queryFilter(
        contract.filters.RegistryRootUpdated(),
        nextOracleScanBlock,
        chunkEndBlock
      ),
    ]);

    const latestRegistryEvent = registryEvents.at(-1);
    if (latestRegistryEvent) {
      cachedRegistryRoot = latestRegistryEvent.args.newRoot;
    }

    for (const event of events) {
      const { requestId, claimId, oracleType } = event.args;

      await handleOracleRequested(requestId, claimId, oracleType);
    }

    nextOracleScanBlock = chunkEndBlock + 1;
    await persistCursor();
    await sendHeartbeat();
  } catch (error) {
    console.error(`[Oracle ${ORACLE_INSTANCE_ID}] Oracle polling failed:`, error.message);
  } finally {
    isPolling = false;
  }
};

/* ----------------------------- Startup --------------------------------- */

const startOracle = async () => {
  console.log(`[Oracle ${ORACLE_INSTANCE_ID}] Oracle service starting...`);
  console.log(`[Oracle ${ORACLE_INSTANCE_ID}] Env file:`, envFile);
  console.log(`[Oracle ${ORACLE_INSTANCE_ID}] Oracle wallet:`, oracleWallet.address);
  console.log(`[Oracle ${ORACLE_INSTANCE_ID}] Contract:`, CONTRACT_ADDRESS);
  console.log(`[Oracle ${ORACLE_INSTANCE_ID}] RPC:`, RPC_URL);
  console.log(`[Oracle ${ORACLE_INSTANCE_ID}] Mock hospital API:`, MOCK_HOSPITAL_API_URL);
  console.log(`[Oracle ${ORACLE_INSTANCE_ID}] Registry snapshot:`, ORACLE_REGISTRY_SNAPSHOT);
  console.log(`[Oracle ${ORACLE_INSTANCE_ID}] Start block:`, ORACLE_START_BLOCK);
  console.log(`[Oracle ${ORACLE_INSTANCE_ID}] Poll interval:`, ORACLE_POLL_INTERVAL_MS, "ms");
  console.log(
    `[Oracle ${ORACLE_INSTANCE_ID}] Heartbeat interval:`,
    ORACLE_HEARTBEAT_INTERVAL_MS,
    "ms"
  );
  console.log(
    `[Oracle ${ORACLE_INSTANCE_ID}] Simulated network delay:`,
    oracle2SimulatedNetworkDelayMs,
    "ms"
  );

  const oracleRole = await contract.ORACLE_ROLE();
  const hasOracleRole = await contract.hasRole(oracleRole, oracleWallet.address);

  if (!hasOracleRole) {
    console.warn(`[Oracle ${ORACLE_INSTANCE_ID}] Warning: oracle wallet does not have ORACLE_ROLE on contract.`);
    console.warn(`[Oracle ${ORACLE_INSTANCE_ID}] Run backend script: npm run grant:oracle`);
  }

  cachedRegistryRoot = await contract.registryMerkleRoot();
  await loadPersistedCursor();
  await pollOracleRequests();

  setInterval(pollOracleRequests, ORACLE_POLL_INTERVAL_MS);

  console.log(`[Oracle ${ORACLE_INSTANCE_ID}] Oracle service polling for OracleRequested events...`);
};

startOracle().catch((error) => {
  console.error(`[Oracle ${ORACLE_INSTANCE_ID}] Oracle service failed to start:`, error.message);
  process.exit(1);
});
