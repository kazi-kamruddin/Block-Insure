require("dotenv").config();

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
const ORACLE_PRIVATE_KEY = getRequiredEnv("ORACLE_PRIVATE_KEY");

const BACKEND_API_URL = process.env.BACKEND_API_URL || "http://localhost:5000";
const MOCK_HOSPITAL_API_URL =
  process.env.MOCK_HOSPITAL_API_URL ||
  "http://localhost:5000/mock/hospital/verify";

const ORACLE_START_BLOCK = Number(process.env.ORACLE_START_BLOCK || 0);
const ORACLE_POLL_INTERVAL_MS = Number(
  process.env.ORACLE_POLL_INTERVAL_MS || 5000
);
const ORACLE_API_KEY = process.env.ORACLE_API_KEY || "";

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
      },
      {
        headers: ORACLE_API_KEY ? { "x-oracle-api-key": ORACLE_API_KEY } : {},
      }
    );

    console.log("Oracle log saved to backend");
  } catch (error) {
    console.warn("Oracle log save failed:", error.message);
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
    console.warn("Submit failed once. Retrying in 5 seconds...");
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

  try {
    const oracleRequest = await contract.getOracleRequest(requestId);

    if (oracleRequest.isFulfilled) {
      return;
    }

    console.log("\nOracleRequested event received");
    console.log("Request ID:", requestId.toString());
    console.log("Claim ID:", claimId.toString());
    console.log("Oracle Type:", oracleType);

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

    console.log("Checking mock hospital API...");
    console.log(queryData);

    const hospitalResponse = await axios.get(MOCK_HOSPITAL_API_URL, {
      params: {
        hospitalId: claim.hospitalId,
        invoiceHash: claim.invoiceHash,
        claimAmountWei: claim.claimAmount.toString(),
        claimAmountEth: ethers.formatEther(claim.claimAmount),
        claimType: claim.claimType,
        incidentDate: claim.incidentDate.toString(),
      },
    });

    const onChainSnapshot = await contract.getRegistrySnapshot();
    const localMerkleRoot = hospitalResponse.data.merkleProof?.rootHash || "";
    const onChainMerkleRoot = onChainSnapshot.root || onChainSnapshot[0];
    const registrySnapshotTimestamp =
      onChainSnapshot.timestamp || onChainSnapshot[1];
    const registrySnapshotBlock =
      onChainSnapshot.blockNumber || onChainSnapshot[2];
    const merkleRootMatchesChain =
      normalizeHash(localMerkleRoot) !== "" &&
      normalizeHash(localMerkleRoot) === normalizeHash(onChainMerkleRoot);
    const verified = hospitalResponse.data.verified === true;
    const riskLevel =
      hospitalResponse.data.riskLevel || (verified ? "LOW" : "HIGH");

    const remarks =
      hospitalResponse.data.message ||
      (verified ? "Hospital record matched" : "Hospital record mismatch");

    const oracleResponse = {
      requestId: requestId.toString(),
      claimId: claimId.toString(),
      oracleType,
      queryData,
      hospitalVerification: hospitalResponse.data,
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
    };

    const resultHash = buildResultHash(oracleResponse);

    console.log("Submitting oracle result...");
    console.log("Verified:", verified);
    console.log("Risk level:", riskLevel);
    console.log("Merkle root matches chain:", merkleRootMatchesChain);
    console.log("Result hash:", resultHash);

    const tx = await submitWithRetry(
      requestId,
      verified,
      resultHash,
      riskLevel,
      remarks
    );

    console.log("Oracle tx sent:", tx.hash);

    await tx.wait();

    console.log("Oracle result confirmed on-chain");

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
    });
  } catch (error) {
    console.error("Oracle handler failed:", error.message);
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
    console.error("Oracle polling failed:", error.message);
  } finally {
    isPolling = false;
  }
};

/* ----------------------------- Startup --------------------------------- */

const startOracle = async () => {
  console.log("Oracle service starting...");
  console.log("Oracle wallet:", oracleWallet.address);
  console.log("Contract:", CONTRACT_ADDRESS);
  console.log("RPC:", RPC_URL);
  console.log("Mock hospital API:", MOCK_HOSPITAL_API_URL);
  console.log("Start block:", ORACLE_START_BLOCK);
  console.log("Poll interval:", ORACLE_POLL_INTERVAL_MS, "ms");

  const oracleRole = await contract.ORACLE_ROLE();
  const hasOracleRole = await contract.hasRole(oracleRole, oracleWallet.address);

  if (!hasOracleRole) {
    console.warn("Warning: oracle wallet does not have ORACLE_ROLE on contract.");
    console.warn("Run backend script: npm run grant:oracle");
  }

  await pollOracleRequests();

  setInterval(pollOracleRequests, ORACLE_POLL_INTERVAL_MS);

  console.log("Oracle service polling for OracleRequested events...");
};

startOracle().catch((error) => {
  console.error("Oracle service failed to start:", error.message);
  process.exit(1);
});
