const fs = require("node:fs");
const dns = require("node:dns");
const path = require("node:path");

dns.setDefaultResultOrder("ipv4first");
if (process.env.FORCE_PUBLIC_DNS === "true") {
  dns.setServers(["8.8.8.8", "1.1.1.1"]);
}

const projectRoot = path.resolve(__dirname, "../..");
const DEFAULT_LOCAL_USER_PRIVATE_KEY =
  "0x59c6995e998f97a5a0044966f094538ea59f3b31f82b83fe5c7f3099b6a6c0e8";
const DEFAULT_LOCAL_HOSPITAL_PRIVATE_KEY =
  "0xf214f2b2cd398c806f84e317254e0f0b801d0643303237d97a22a48e01628897";
const DEFAULT_LOCAL_BANK_PRIVATE_KEY =
  "0x8166f546bab6da521a8369cab06c5d2b9e46670292d85c875ee9ec20e84ffb61";

function readEnv(relativePath) {
  const filePath = path.join(projectRoot, relativePath);
  if (!fs.existsSync(filePath)) return { ...process.env };

  const fileEnvironment = Object.fromEntries(
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

  // Explicit process-level values let an isolated E2E launcher select a
  // disposable database and local-only wallets without rewriting developers'
  // normal environment files.
  return { ...fileEnvironment, ...process.env };
}

function normalizePrivateKey(value) {
  const key = String(value || "").trim();
  return /^[0-9a-fA-F]{64}$/.test(key) ? `0x${key}` : key;
}

function requireDisposableE2EMongoUri(value = process.env.MONGODB_URI) {
  if (!value) throw new Error("MONGODB_URI is required for database-backed E2E assertions");

  const parsed = new URL(value);
  const databaseName = parsed.pathname.replace(/^\//, "");
  if (databaseName !== "block_insure_e2e") {
    throw new Error("Refusing database-backed E2E assertions outside block_insure_e2e");
  }

  if (
    process.env.E2E_REQUIRE_LOCAL_MONGO === "true" &&
    !["127.0.0.1", "localhost", "::1"].includes(parsed.hostname)
  ) {
    throw new Error("E2E_REQUIRE_LOCAL_MONGO requires a loopback MongoDB host");
  }

  return value;
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
    backendRpcProxyUrl: process.env.E2E_BACKEND_RPC_URL || "",
    chainId: Number(e2e.E2E_CHAIN_ID || 31337),
    actionTimeoutMs: Number(e2e.E2E_ACTION_TIMEOUT_MS || 15_000),
    scenarioTimeoutMs: Number(e2e.E2E_SCENARIO_TIMEOUT_MS || 120_000),
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
      hospital: {
        role: "HOSPITAL",
        home: "/hospital/dashboard",
        privateKey: requirePrivateKey(
          e2e.E2E_HOSPITAL_PRIVATE_KEY || DEFAULT_LOCAL_HOSPITAL_PRIVATE_KEY,
          "E2E_HOSPITAL_PRIVATE_KEY"
        ),
      },
      hospital2: {
        role: "HOSPITAL",
        home: "/hospital/dashboard",
        privateKey: requirePrivateKey(
          e2e.E2E_HOSPITAL_PRIVATE_KEY_2,
          "E2E_HOSPITAL_PRIVATE_KEY_2"
        ),
      },
      bank: {
        role: "BANK",
        home: "/bank/dashboard",
        privateKey: requirePrivateKey(
          e2e.E2E_BANK_PRIVATE_KEY || DEFAULT_LOCAL_BANK_PRIVATE_KEY,
          "E2E_BANK_PRIVATE_KEY"
        ),
      },
      beneficiary: {
        role: "USER",
        home: "/user/dashboard",
        privateKey: requirePrivateKey(
          e2e.E2E_BENEFICIARY_PRIVATE_KEY,
          "E2E_BENEFICIARY_PRIVATE_KEY"
        ),
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

module.exports = {
  getE2EConfig,
  normalizePrivateKey,
  requireDisposableE2EMongoUri,
};
