const fs = require("node:fs");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(projectRoot, relativePath), "utf8"));
}

function readEnv(relativePath) {
  const filePath = path.join(projectRoot, relativePath);
  if (!fs.existsSync(filePath)) return {};

  return Object.fromEntries(
    fs
      .readFileSync(filePath, "utf8")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#") && line.includes("="))
      .map((line) => {
        const separator = line.indexOf("=");
        return [line.slice(0, separator), line.slice(separator + 1)];
      })
  );
}

function assert(condition, message, failures) {
  if (!condition) failures.push(message);
}

function normalize(value) {
  return String(value || "").trim().toLowerCase();
}

function main() {
  const failures = [];
  const warnings = [];
  const artifact = readJson(
    "contracts/artifacts/contracts/InsuranceManager.sol/InsuranceManager.json"
  );
  const benefitsArtifact = readJson(
    "contracts/artifacts/contracts/PolicyBenefitsManager.sol/PolicyBenefitsManager.json"
  );
  const abiTargets = [
    "backEnd/abi/InsuranceManager.json",
    "frontEnd/src/abi/InsuranceManager.json",
    "oracle/abi/InsuranceManager.json",
  ];

  for (const target of abiTargets) {
    const targetAbi = readJson(target).abi;
    assert(
      JSON.stringify(targetAbi) === JSON.stringify(artifact.abi),
      `${target} ABI does not match the compiled contract artifact`,
      failures
    );
  }

  const requiredFunctions = [
    "submitClaim",
    "requestOracleVerification",
    "submitOracleResult",
    "castVote",
    "settleClaim",
    "submitAppeal",
  ];
  const functionNames = new Set(
    artifact.abi
      .filter((entry) => entry.type === "function")
      .map((entry) => entry.name)
  );
  for (const functionName of requiredFunctions) {
    assert(
      functionNames.has(functionName),
      `Compiled ABI is missing ${functionName}`,
      failures
    );
  }

  const requiredBenefitFunctions = [
    "publishBenefitTerms",
    "setBeneficiaries",
    "requestBenefit",
    "approveBenefit",
    "rejectBenefit",
    "settleBenefit",
  ];
  const benefitFunctionNames = new Set(
    benefitsArtifact.abi
      .filter((entry) => entry.type === "function")
      .map((entry) => entry.name)
  );
  for (const functionName of requiredBenefitFunctions) {
    assert(
      benefitFunctionNames.has(functionName),
      `PolicyBenefitsManager ABI is missing ${functionName}`,
      failures
    );
  }

  const deployedBytes = Math.max(
    (String(artifact.deployedBytecode || "0x").length - 2) / 2,
    0
  );
  assert(
    deployedBytes <= 24_576,
    `InsuranceManager deployed bytecode is ${deployedBytes} bytes (EIP-170 maximum 24576)`,
    failures
  );
  const configuredSizeBudget = Number(
    process.env.CONTRACT_RUNTIME_SIZE_BUDGET_BYTES || 24_448
  );
  assert(
    Number.isInteger(configuredSizeBudget) &&
      configuredSizeBudget > 0 &&
      configuredSizeBudget <= 24_576,
    "CONTRACT_RUNTIME_SIZE_BUDGET_BYTES must be an integer between 1 and 24576",
    failures
  );
  assert(
    deployedBytes <= configuredSizeBudget,
    `InsuranceManager deployed bytecode is ${deployedBytes} bytes, above the configured ${configuredSizeBudget}-byte maintenance budget`,
    failures
  );
  if (24_576 - deployedBytes < 512) {
    warnings.push(
      `InsuranceManager has only ${24_576 - deployedBytes} bytes of EIP-170 headroom`
    );
  }
  const benefitsDeployedBytes = Math.max(
    (String(benefitsArtifact.deployedBytecode || "0x").length - 2) / 2,
    0
  );
  assert(
    benefitsDeployedBytes <= 24_576,
    `PolicyBenefitsManager deployed bytecode is ${benefitsDeployedBytes} bytes (EIP-170 maximum 24576)`,
    failures
  );

  const environments = [
    ["backend", readEnv("backEnd/.env"), "VITE_CONTRACT_ADDRESS"],
    ["frontend", readEnv("frontEnd/.env"), "VITE_CONTRACT_ADDRESS"],
    ["oracle 1", readEnv("oracle/.env"), "CONTRACT_ADDRESS"],
    ["oracle 2", readEnv("oracle/.env.oracle2"), "CONTRACT_ADDRESS"],
  ];
  const configuredAddresses = environments
    .map(([label, values, key]) => [label, normalize(values[key])])
    .filter(([, address]) => address);
  const addressSet = new Set(configuredAddresses.map(([, address]) => address));

  assert(configuredAddresses.length === 4, "A service contract address is missing", failures);
  assert(addressSet.size === 1, "Service contract addresses are not synchronized", failures);
  for (const [label, address] of configuredAddresses) {
    assert(
      /^0x[a-f0-9]{40}$/.test(address) && !/^0x0{40}$/.test(address),
      `${label} contract address is invalid`,
      failures
    );
  }

  const backendEnv = environments[0][1];
  const frontendEnv = environments[1][1];
  const oracleOneEnv = environments[2][1];
  const oracleTwoEnv = environments[3][1];
  const benefitAddresses = [
    normalize(backendEnv.POLICY_BENEFITS_ADDRESS),
    normalize(frontendEnv.VITE_POLICY_BENEFITS_ADDRESS),
  ].filter(Boolean);
  if (benefitAddresses.length === 0) {
    warnings.push(
      "PolicyBenefitsManager is not deployed in the current local environment; run setup:local before using Phase 2"
    );
  } else {
    assert(
      benefitAddresses.length === 2 && new Set(benefitAddresses).size === 1,
      "Backend and frontend policy-benefits addresses are not synchronized",
      failures
    );
    benefitAddresses.forEach((address) =>
      assert(
        /^0x[a-f0-9]{40}$/.test(address) && !/^0x0{40}$/.test(address),
        "A policy-benefits address is invalid",
        failures
      )
    );
  }
  assert(
    backendEnv.ORACLE_PRIVATE_KEY &&
      backendEnv.ORACLE_PRIVATE_KEY_2 &&
      backendEnv.ORACLE_PRIVATE_KEY !== backendEnv.ORACLE_PRIVATE_KEY_2,
    "Two distinct oracle signing keys are required",
    failures
  );
  if (
    !backendEnv.AUDITOR_WALLET_ADDRESS ||
    (!backendEnv.AUDITOR_WALLET_ADDRESS_2 &&
      !backendEnv.DEMO_AUDITOR_PRIVATE_KEY_2)
  ) {
    warnings.push(
      "Set AUDITOR_WALLET_ADDRESS_2 (or DEMO_AUDITOR_PRIVATE_KEY_2) before the next clean setup so the two-vote quorum can be exercised"
    );
  }
  assert(
    Number(backendEnv.MINIMUM_AUDITOR_VOTES || 2) >= 2,
    "MINIMUM_AUDITOR_VOTES must be at least 2",
    failures
  );
  assert(
    normalize(oracleOneEnv.RPC_URL) === normalize(oracleTwoEnv.RPC_URL),
    "Oracle RPC endpoints are not synchronized",
    failures
  );
  assert(
    oracleOneEnv.ORACLE_INSTANCE_ID !== oracleTwoEnv.ORACLE_INSTANCE_ID,
    "Oracle instance identities must be distinct",
    failures
  );
  assert(
    oracleOneEnv.ORACLE_API_KEY &&
      oracleOneEnv.ORACLE_API_KEY === oracleTwoEnv.ORACLE_API_KEY &&
      oracleOneEnv.ORACLE_API_KEY === backendEnv.ORACLE_API_KEY,
    "Oracle API authentication keys are not synchronized",
    failures
  );

  if (failures.length) {
    throw new Error(
      `Synchronization/integrity verification failed:\n- ${failures.join("\n- ")}`
    );
  }

  warnings.forEach((warning) => console.warn(`Configuration warning: ${warning}`));
  console.log(
    `Synchronization/integrity verification passed: 3 core ABI copies match, 4 core service addresses match, contract sizes are ${deployedBytes}/24576 and ${benefitsDeployedBytes}/24576 bytes, and Oracle authentication/RPC settings are synchronized.`
  );
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
