const instanceFromEnvironment = process.env.ORACLE_INSTANCE_ID || "1";
const envFile =
  process.env.ORACLE_ENV_FILE ||
  (instanceFromEnvironment === "2" ? ".env.oracle2" : ".env");

require("dotenv").config({ path: envFile });

const axios = require("axios");
const { ethers } = require("ethers");
const InsuranceManagerArtifact = require("./abi/InsuranceManager.json");

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
const ORACLE_API_KEY = process.env.ORACLE_API_KEY || "";
const ORACLE_REGISTRY_SNAPSHOT =
  process.env.ORACLE_REGISTRY_SNAPSHOT ||
  (ORACLE_INSTANCE_ID === "2" ? "oracle2" : "primary");

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

/* ----------------------------- Helpers --------------------------------- */

const buildResultHash = (oracleResponse) => {
  return ethers.keccak256(ethers.toUtf8Bytes(JSON.stringify(oracleResponse)));
};

const normalizeHash = (value) => String(value || "").trim().toLowerCase();
const sleep = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

const saveOracleLog = async ({
  requestId,
  claimId,
  oracleType,
  queryData,
  responseData,
  resultHash,
  verified,
  riskLevel,
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
        submittedTxHash,
        responseTimeMs,
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

const submitWithRetry = async (
  requestId,
  verified,
  resultHash,
  riskLevel,
  remarks
) => {
  try {
    return await contract.submitOracleResult(
      requestId,
      verified,
      resultHash,
      riskLevel,
      remarks
    );
  } catch (error) {
    console.warn(`[Oracle ${ORACLE_INSTANCE_ID}] Submit failed once. Retrying in 5 seconds...`);
    await new Promise((resolve) => setTimeout(resolve, 5000));

    return await contract.submitOracleResult(
      requestId,
      verified,
      resultHash,
      riskLevel,
      remarks
    );
  }
};

/* ----------------------------- Handler --------------------------------- */

const handleOracleRequested = async (requestId, claimId, oracleType) => {
  const requestKey = requestId.toString();

  if (processingRequests.has(requestKey)) {
    return;
  }

  processingRequests.add(requestKey);
  const startedAt = Date.now();

  try {
    const oracleRequest = await contract.getOracleRequest(requestId);

    if (oracleRequest.isFulfilled) {
      return;
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
        return;
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
    const hospitalVerified = hospitalResponse.data.verified === true;
    const verified = hospitalVerified && merkleRootMatchesChain;
    const riskLevel =
      !merkleRootMatchesChain
        ? "HIGH"
        : hospitalResponse.data.riskLevel || (verified ? "LOW" : "HIGH");

    const remarks =
      !merkleRootMatchesChain
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
      submittedTxHash: tx.hash,
      responseTimeMs,
    });
  } catch (error) {
    console.error(`[Oracle ${ORACLE_INSTANCE_ID}] Oracle handler failed:`, error.message);
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
      return;
    }

    const filter = contract.filters.OracleRequested();

    const events = await contract.queryFilter(
      filter,
      nextOracleScanBlock,
      latestBlock
    );

    for (const event of events) {
      const { requestId, claimId, oracleType } = event.args;

      await handleOracleRequested(requestId, claimId, oracleType);
    }

    nextOracleScanBlock = latestBlock + 1;
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

  await pollOracleRequests();

  setInterval(pollOracleRequests, ORACLE_POLL_INTERVAL_MS);

  console.log(`[Oracle ${ORACLE_INSTANCE_ID}] Oracle service polling for OracleRequested events...`);
};

startOracle().catch((error) => {
  console.error(`[Oracle ${ORACLE_INSTANCE_ID}] Oracle service failed to start:`, error.message);
  process.exit(1);
});
