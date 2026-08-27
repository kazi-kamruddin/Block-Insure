const fs = require("node:fs");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "../..");
const DEFAULT_LOCAL_USER_PRIVATE_KEY =
  "0x59c6995e998f97a5a0044966f094538ea59f3b31f82b83fe5c7f3099b6a6c0e8";

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
        return [line.slice(0, separator).trim(), line.slice(separator + 1).trim()];
      })
  );
}

function normalizePrivateKey(value) {
  const key = String(value || "").trim();
  return /^[0-9a-fA-F]{64}$/.test(key) ? `0x${key}` : key;
}

function requirePrivateKey(value, label) {
  const privateKey = normalizePrivateKey(value);
  if (!/^0x[0-9a-fA-F]{64}$/.test(privateKey)) {
    throw new Error(`${label} is missing or invalid. Run npm run preflight:e2e.`);
  }
  return privateKey;
}

let cachedConfig;

function getE2EConfig() {
  if (cachedConfig) return cachedConfig;

  const backend = readEnv("backEnd/.env");
  const e2e = readEnv("e2e/.env");

  cachedConfig = {
    projectRoot,
    appUrl: e2e.E2E_APP_URL || "http://localhost:5173",
    apiUrl: e2e.E2E_API_URL || "http://localhost:5000",
    rpcUrl: e2e.E2E_RPC_URL || backend.RPC_URL || "http://127.0.0.1:8545",
    chainId: Number(e2e.E2E_CHAIN_ID || 31337),
    actionTimeoutMs: Number(e2e.E2E_ACTION_TIMEOUT_MS || 15_000),
    scenarioTimeoutMs: Number(e2e.E2E_SCENARIO_TIMEOUT_MS || 120_000),
    pinataMode: e2e.E2E_PINATA_MODE || "real",
    actors: {
      user: {
        role: "USER",
        home: "/user/dashboard",
        privateKey: requirePrivateKey(
          e2e.E2E_USER_PRIVATE_KEY || DEFAULT_LOCAL_USER_PRIVATE_KEY,
          "E2E_USER_PRIVATE_KEY"
        ),
      },
      admin: {
        role: "ADMIN",
        home: "/admin/dashboard",
        privateKey: requirePrivateKey(backend.ADMIN_PRIVATE_KEY, "ADMIN_PRIVATE_KEY"),
      },
      auditor1: auditorActor(e2e, 1),
      auditor2: auditorActor(e2e, 2),
      auditor3: auditorActor(e2e, 3),
      auditor4: auditorActor(e2e, 4),
    },
  };

  return cachedConfig;
}

function auditorActor(e2e, index) {
  return {
    role: "AUDITOR",
    home: "/auditor/dashboard",
    privateKey: requirePrivateKey(
      e2e[`E2E_AUDITOR_PRIVATE_KEY_${index}`],
      `E2E_AUDITOR_PRIVATE_KEY_${index}`
    ),
  };
}

module.exports = { getE2EConfig, normalizePrivateKey };
