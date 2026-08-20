const fs = require("node:fs");
const path = require("node:path");
const {
  Contract,
  JsonRpcProvider,
  Wallet,
} = require("../backEnd/node_modules/ethers");
const InsuranceManagerArtifact = require("../backEnd/abi/InsuranceManager.json");

const projectRoot = path.resolve(__dirname, "..");
const DEFAULT_LOCAL_USER_PRIVATE_KEY =
  "0x59c6995e998f97a5a0044966f094538ea59f3b31f82b83fe5c7f3099b6a6c0e8";

function readEnv(relativePath) {
  const filePath = path.join(projectRoot, relativePath);
  if (!fs.existsSync(filePath)) return null;

  return Object.fromEntries(
    fs
      .readFileSync(filePath, "utf8")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#") && line.includes("="))
      .map((line) => {
        const separator = line.indexOf("=");
        return [line.slice(0, separator).trim(), line.slice(separator + 1).trim()];
      })
  );
}

function requireValue(failures, values, key, fileLabel) {
  const value = values?.[key];
  if (!value) failures.push(`${key} is missing in ${fileLabel}`);
  return value || "";
}

function normalizePrivateKey(value) {
  const trimmed = String(value || "").trim();
  return /^[0-9a-fA-F]{64}$/.test(trimmed) ? `0x${trimmed}` : trimmed;
}

function loadWallet(failures, privateKey, label) {
  try {
    return new Wallet(normalizePrivateKey(privateKey));
  } catch {
    failures.push(`${label} is not a valid private key`);
    return null;
  }
}

async function checkHttp(failures, label, url, expectedText = "") {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
    const body = await response.text();
    if (!response.ok) {
      failures.push(`${label} returned HTTP ${response.status}`);
    } else if (expectedText && !body.includes(expectedText)) {
      failures.push(`${label} response did not contain ${expectedText}`);
    }
  } catch (error) {
    failures.push(`${label} is not reachable at ${url}: ${error.message}`);
  }
}

async function main() {
  const failures = [];
  const warnings = [];
  const backend = readEnv("backEnd/.env") || {};
  const e2e = readEnv("e2e/.env");

  if (!e2e) {
    throw new Error("e2e/.env is missing; copy e2e/.env.example first");
  }

  const rpcUrl = e2e.E2E_RPC_URL || backend.RPC_URL || "http://127.0.0.1:8545";
  const appUrl = e2e.E2E_APP_URL || "http://localhost:5173";
  const apiUrl = e2e.E2E_API_URL || "http://localhost:5000";
  const expectedChainId = BigInt(e2e.E2E_CHAIN_ID || 31337);
  const contractAddress = requireValue(
    failures,
    backend,
    "VITE_CONTRACT_ADDRESS",
    "backEnd/.env"
  );

  const adminPrivateKey = requireValue(
    failures,
    backend,
    "ADMIN_PRIVATE_KEY",
    "backEnd/.env"
  );
  const oraclePrivateKey = requireValue(
    failures,
    backend,
    "ORACLE_PRIVATE_KEY",
    "backEnd/.env"
  );
  const oracleTwoPrivateKey = requireValue(
    failures,
    backend,
    "ORACLE_PRIVATE_KEY_2",
    "backEnd/.env"
  );
  requireValue(failures, backend, "JWT_SECRET", "backEnd/.env");
  requireValue(failures, backend, "MONGODB_URI", "backEnd/.env");

  const adminWallet = adminPrivateKey
    ? loadWallet(failures, adminPrivateKey, "ADMIN_PRIVATE_KEY")
    : null;
  const userWallet = loadWallet(
    failures,
    e2e.E2E_USER_PRIVATE_KEY || DEFAULT_LOCAL_USER_PRIVATE_KEY,
    "E2E_USER_PRIVATE_KEY"
  );
  const oracleWallet = oraclePrivateKey
    ? loadWallet(failures, oraclePrivateKey, "ORACLE_PRIVATE_KEY")
    : null;
  const oracleTwoWallet = oracleTwoPrivateKey
    ? loadWallet(failures, oracleTwoPrivateKey, "ORACLE_PRIVATE_KEY_2")
    : null;

  const auditorAddresses = [1, 2, 3, 4].map((index) =>
    requireValue(
      failures,
      backend,
      index === 1 ? "AUDITOR_WALLET_ADDRESS" : `AUDITOR_WALLET_ADDRESS_${index}`,
      "backEnd/.env"
    )
  );
  const auditorKeys = [1, 2, 3, 4].map((index) =>
    requireValue(
      failures,
      e2e,
      `E2E_AUDITOR_PRIVATE_KEY_${index}`,
      "e2e/.env"
    )
  );

  const derivedAuditorAddresses = auditorKeys.map((privateKey, index) => {
    if (!privateKey) return "";
    return (
      loadWallet(
        failures,
        privateKey,
        `E2E_AUDITOR_PRIVATE_KEY_${index + 1}`
      )?.address || ""
    );
  });

  derivedAuditorAddresses.forEach((derivedAddress, index) => {
    const configuredAddress = auditorAddresses[index];
    if (
      derivedAddress &&
      configuredAddress &&
      derivedAddress.toLowerCase() !== configuredAddress.toLowerCase()
    ) {
      failures.push(
        `Auditor ${index + 1} key in e2e/.env does not match its address in backEnd/.env`
      );
    }
  });

  const distinctAuditors = new Set(
    derivedAuditorAddresses.filter(Boolean).map((address) => address.toLowerCase())
  );
  if (distinctAuditors.size !== derivedAuditorAddresses.filter(Boolean).length) {
    failures.push("The four E2E Auditor private keys must represent distinct wallets");
  }

  const browserRoleAddresses = [
    adminWallet?.address,
    userWallet?.address,
    ...derivedAuditorAddresses,
  ].filter(Boolean);
  if (
    new Set(browserRoleAddresses.map((address) => address.toLowerCase())).size !==
    browserRoleAddresses.length
  ) {
    failures.push("Admin, User, and Auditor browser wallets must all be distinct");
  }

  if (e2e.E2E_PINATA_MODE === "real") {
    if (
      !backend.PINATA_JWT &&
      !(backend.PINATA_API_KEY && backend.PINATA_SECRET)
    ) {
      failures.push("Real Pinata mode requires backend Pinata API credentials");
    }
  } else if (e2e.E2E_PINATA_MODE !== "mock") {
    failures.push('E2E_PINATA_MODE must be either "real" or "mock"');
  }

  if (backend.DEV_ALLOW_CLAIM_LIMIT_RESET !== "true") {
    warnings.push("DEV_ALLOW_CLAIM_LIMIT_RESET is not true; repeated claim tests may hit the daily allowance");
  }

  await Promise.all([
    checkHttp(failures, "Frontend", appUrl, "Block-Insure"),
    checkHttp(failures, "Backend health check", `${apiUrl}/health`, "Backend is healthy"),
  ]);

  if (contractAddress) {
    try {
      const provider = new JsonRpcProvider(rpcUrl);
      const network = await provider.getNetwork();
      if (network.chainId !== expectedChainId) {
        failures.push(
          `RPC chain ID is ${network.chainId}; expected ${expectedChainId}`
        );
      }

      const code = await provider.getCode(contractAddress);
      if (code === "0x") {
        failures.push("No InsuranceManager bytecode exists at the configured address");
      } else {
        const contract = new Contract(
          contractAddress,
          InsuranceManagerArtifact.abi,
          provider
        );
        const [adminRole, auditorRole, oracleRole] = await Promise.all([
          contract.DEFAULT_ADMIN_ROLE(),
          contract.AUDITOR_ROLE(),
          contract.ORACLE_ROLE(),
        ]);

        if (
          adminWallet &&
          !(await contract.hasRole(adminRole, adminWallet.address))
        ) {
          failures.push("Admin wallet does not have DEFAULT_ADMIN_ROLE on the current deployment");
        }

        if (derivedAuditorAddresses.every(Boolean)) {
          const roleChecks = await Promise.all(
            derivedAuditorAddresses.map((address) =>
              contract.hasRole(auditorRole, address)
            )
          );
          roleChecks.forEach((hasRole, index) => {
            if (!hasRole) {
              failures.push(`Auditor ${index + 1} does not have AUDITOR_ROLE on the current deployment`);
            }
          });
        }

        const configuredOracles = [oracleWallet, oracleTwoWallet];
        const oracleRoleChecks = await Promise.all(
          configuredOracles.filter(Boolean).map((wallet) =>
            contract.hasRole(oracleRole, wallet.address)
          )
        );
        oracleRoleChecks.forEach((hasRole, index) => {
          if (!hasRole) {
            failures.push(`Oracle ${index + 1} does not have ORACLE_ROLE on the current deployment`);
          }
        });

        if (userWallet) {
          const [balance, isAdmin, isAuditor, isOracle] = await Promise.all([
            provider.getBalance(userWallet.address),
            contract.hasRole(adminRole, userWallet.address),
            contract.hasRole(auditorRole, userWallet.address),
            contract.hasRole(oracleRole, userWallet.address),
          ]);
          if (balance === 0n) {
            failures.push("User wallet has no local ETH for browser transactions");
          }
          if (isAdmin || isAuditor || isOracle) {
            failures.push("User wallet unexpectedly has a privileged contract role");
          }
        }
      }
      provider.destroy();
    } catch (error) {
      failures.push(`Blockchain preflight failed: ${error.shortMessage || error.message}`);
    }
  }

  warnings.forEach((warning) => console.warn(`[E2E preflight] Warning: ${warning}`));

  if (failures.length) {
    throw new Error(`E2E preflight failed:\n- ${failures.join("\n- ")}`);
  }

  console.log(
    "[E2E preflight] Admin, User, 4 Auditors, 2 Oracles, services, chain, claim controls, and evidence configuration are ready."
  );
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
