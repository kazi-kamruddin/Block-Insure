require("dotenv").config();

const fs = require("fs");
const path = require("path");
const { performance } = require("perf_hooks");
const { ethers } = require("ethers");

const InsuranceManagerArtifact = require("../abi/InsuranceManager.json");
const { writeCsv } = require("./evaluateRiskModel");

const RESULTS_DIR = path.join(__dirname, "..", "evaluation-results");
const DEFAULT_LEVELS = [1, 5, 10, 20, 50];

const round = (value, decimals = 2) => Number(value.toFixed(decimals));

const getRequiredEnv = (key) => {
  if (!process.env[key]) {
    throw new Error(`${key} is missing in .env`);
  }

  return process.env[key];
};

const parseLevels = () => {
  const configured = process.env.LOAD_TEST_CONCURRENCY_LEVELS;

  if (!configured) return DEFAULT_LEVELS;

  const levels = configured
    .split(",")
    .map(Number)
    .filter((value) => Number.isInteger(value) && value > 0);

  if (levels.length === 0) {
    throw new Error("LOAD_TEST_CONCURRENCY_LEVELS contains no valid levels");
  }

  return levels;
};

const getPercentile = (values, percentile) => {
  if (values.length === 0) return null;
  const sorted = values.slice().sort((left, right) => left - right);
  const index = Math.min(
    Math.ceil((percentile / 100) * sorted.length) - 1,
    sorted.length - 1
  );
  return round(sorted[Math.max(index, 0)]);
};

const summarizeDurations = (values) => {
  if (values.length === 0) {
    return { averageMs: null, p95Ms: null, minMs: null, maxMs: null };
  }

  return {
    averageMs: round(values.reduce((total, value) => total + value, 0) / values.length),
    p95Ms: getPercentile(values, 95),
    minMs: round(Math.min(...values)),
    maxMs: round(Math.max(...values)),
  };
};

const measureBackendResponse = async (url) => {
  const startedAt = performance.now();
  const response = await fetch(url);
  const responseMs = performance.now() - startedAt;

  if (!response.ok) {
    throw new Error(`Backend benchmark request failed with HTTP ${response.status}`);
  }

  await response.text();
  return responseMs;
};

const parsePolicyId = (contract, receipt) => {
  for (const log of receipt.logs) {
    try {
      const parsedLog = contract.interface.parseLog(log);
      if (parsedLog?.name === "PolicyPurchased") {
        return parsedLog.args.policyId;
      }
    } catch (_) {
      // Ignore unrelated logs.
    }
  }

  throw new Error("PolicyPurchased event not found");
};

const purchaseBenchmarkPolicies = async (contract, packageId, count) => {
  const policyPackage = await contract.getPolicyPackage(packageId);

  if (!policyPackage.isActive) {
    throw new Error(`Policy package ${packageId} is inactive`);
  }

  const policyIds = [];

  for (let index = 0; index < count; index += 1) {
    const tx = await contract.purchasePolicy(packageId, {
      value: policyPackage.premiumAmount,
    });
    policyIds.push(parsePolicyId(contract, await tx.wait()));
  }

  return policyIds;
};

const runClaim = async ({
  contract,
  policyId,
  backendUrl,
  runId,
  index,
  claimAmount,
}) => {
  const endToEndStartedAt = performance.now();
  const backendResponseMs = await measureBackendResponse(backendUrl);
  const policy = await contract.getPolicy(policyId);
  const blockchainStartedAt = performance.now();
  const tx = await contract.submitClaim(
    policyId,
    claimAmount,
    policy.startDate,
    "HOSPITALIZATION",
    "HOSP-001",
    ethers.keccak256(ethers.toUtf8Bytes(`${runId}-invoice-${index}`)),
    ethers.keccak256(ethers.toUtf8Bytes(`${runId}-document-${index}`)),
    `load-test://${runId}/${index}`
  );
  const receipt = await tx.wait();

  return {
    index,
    transactionHash: tx.hash,
    blockNumber: receipt.blockNumber,
    backendResponseMs: round(backendResponseMs),
    blockchainConfirmationMs: round(performance.now() - blockchainStartedAt),
    endToEndMs: round(performance.now() - endToEndStartedAt),
  };
};

const runLevel = async ({
  contract,
  packageId,
  concurrency,
  backendUrl,
  claimAmount,
}) => {
  console.log(`Preparing ${concurrency} policies for concurrency N=${concurrency}...`);
  const policyIds = await purchaseBenchmarkPolicies(contract, packageId, concurrency);
  const runId = `claim-load-${Date.now()}-${concurrency}`;
  const startedAt = performance.now();
  const settled = await Promise.allSettled(
    policyIds.map((policyId, index) =>
      runClaim({
        contract,
        policyId,
        backendUrl,
        runId,
        index,
        claimAmount,
      })
    )
  );
  const wallClockMs = performance.now() - startedAt;
  const successful = settled
    .filter((result) => result.status === "fulfilled")
    .map((result) => result.value);
  const failures = settled
    .filter((result) => result.status === "rejected")
    .map((result) => result.reason?.message || String(result.reason));

  return {
    concurrency,
    attemptedClaims: concurrency,
    successfulClaims: successful.length,
    failedClaims: failures.length,
    wallClockMs: round(wallClockMs),
    throughputClaimsPerSecond: round(successful.length / (wallClockMs / 1000), 4),
    backend: summarizeDurations(successful.map((item) => item.backendResponseMs)),
    blockchain: summarizeDurations(
      successful.map((item) => item.blockchainConfirmationMs)
    ),
    endToEnd: summarizeDurations(successful.map((item) => item.endToEndMs)),
    failures,
    samples: successful,
  };
};

const runLoadTest = async () => {
  const provider = new ethers.JsonRpcProvider(getRequiredEnv("RPC_URL"));
  const wallet = new ethers.Wallet(getRequiredEnv("ADMIN_PRIVATE_KEY"), provider);
  const signer = new ethers.NonceManager(wallet);
  const contract = new ethers.Contract(
    getRequiredEnv("VITE_CONTRACT_ADDRESS"),
    InsuranceManagerArtifact.abi,
    signer
  );
  const packageId = BigInt(process.env.LOAD_TEST_PACKAGE_ID || "1");
  const claimAmount = ethers.parseEther(process.env.LOAD_TEST_CLAIM_AMOUNT_ETH || "0.01");
  const backendUrl =
    process.env.LOAD_TEST_BACKEND_URL ||
    `http://localhost:${process.env.PORT || 5000}/health`;
  const levels = parseLevels();
  const rows = [];

  await measureBackendResponse(backendUrl);
  await provider.getBlockNumber();

  for (const concurrency of levels) {
    const row = await runLevel({
      contract,
      packageId,
      concurrency,
      backendUrl,
      claimAmount,
    });
    rows.push(row);
    console.log(
      `N=${concurrency}: ${row.throughputClaimsPerSecond} claims/s, ` +
        `${row.endToEnd.averageMs}ms average end-to-end`
    );
  }

  const results = {
    generatedAt: new Date().toISOString(),
    methodology: {
      concurrencyLevels: levels,
      backendMeasurement: `HTTP response time for ${backendUrl}`,
      blockchainMeasurement: "submitClaim transaction send-to-receipt duration",
      endToEndMeasurement: "backend request plus blockchain claim confirmation",
      setupExcluded:
        "Policy purchases are completed before each timed run and excluded from latency.",
    },
    conclusion:
      "Compare average backend and blockchain durations to identify the primary throughput bottleneck.",
    rows,
  };

  fs.mkdirSync(RESULTS_DIR, { recursive: true });
  fs.writeFileSync(
    path.join(RESULTS_DIR, "claim-throughput-results.json"),
    `${JSON.stringify(results, null, 2)}\n`,
    "utf8"
  );
  writeCsv(
    path.join(RESULTS_DIR, "claim-throughput-results.csv"),
    rows.map((row) => ({
      concurrency: row.concurrency,
      successfulClaims: row.successfulClaims,
      failedClaims: row.failedClaims,
      throughputClaimsPerSecond: row.throughputClaimsPerSecond,
      averageBackendResponseMs: row.backend.averageMs,
      averageBlockchainConfirmationMs: row.blockchain.averageMs,
      averageEndToEndMs: row.endToEnd.averageMs,
      p95EndToEndMs: row.endToEnd.p95Ms,
    }))
  );

  return results;
};

if (require.main === module) {
  runLoadTest().catch((error) => {
    console.error("Claim load test failed:", error.message);
    process.exit(1);
  });
}

module.exports = {
  getPercentile,
  parseLevels,
  runLoadTest,
  summarizeDurations,
};
