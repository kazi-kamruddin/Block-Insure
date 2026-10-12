const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const dotenv = require("../backEnd/node_modules/dotenv");
const { HDNodeWallet } = require("../backEnd/node_modules/ethers");
const {
  HARDHAT_NETWORK_MNEMONIC,
} = require("../contracts/node_modules/hardhat/internal/core/config/default-config");

const projectRoot = path.resolve(__dirname, "..");
const backendEnvironmentPath = path.join(projectRoot, "backEnd", ".env");
const npmCli = process.env.npm_execpath || path.join(
  path.dirname(process.execPath),
  "node_modules",
  "npm",
  "bin",
  "npm-cli.js"
);
const scriptName = process.argv[2];
const scriptArguments = process.argv.slice(3);

if (!scriptName) {
  throw new Error("Usage: node scripts/runIsolatedE2E.js <npm-script>");
}
if (!fs.existsSync(backendEnvironmentPath)) {
  throw new Error("backEnd/.env is required for the isolated E2E environment");
}

const savedEnvironment = dotenv.parse(fs.readFileSync(backendEnvironmentPath));
const configuredMongoUri =
  process.env.E2E_MONGODB_URI || savedEnvironment.MONGODB_URI;
if (!configuredMongoUri) {
  throw new Error("MONGODB_URI is missing from backEnd/.env");
}

const mongoUrl = new URL(configuredMongoUri);
if (!["mongodb:", "mongodb+srv:"].includes(mongoUrl.protocol)) {
  throw new Error("Configured MONGODB_URI is not a MongoDB URL");
}
mongoUrl.pathname = "/block_insure_e2e";
if (
  process.env.E2E_REQUIRE_LOCAL_MONGO === "true" &&
  !["127.0.0.1", "localhost", "::1"].includes(mongoUrl.hostname)
) {
  throw new Error("E2E_REQUIRE_LOCAL_MONGO requires a loopback MongoDB host");
}

const wallet = (index) =>
  HDNodeWallet.fromPhrase(
    HARDHAT_NETWORK_MNEMONIC,
    undefined,
    `m/44'/60'/0'/0/${index}`
  );
const wallets = Array.from({ length: 18 }, (_, index) => wallet(index));
const rpcProxyEnabled = process.env.E2E_RPC_PROXY === "true";
const e2ePinataBaseUrl = process.env.E2E_PINATA_API_URL
  ? new URL(process.env.E2E_PINATA_API_URL).origin
  : process.env.E2E_PINATA_API_BASE_URL;

const isolatedEnvironment = {
  ...process.env,
  MONGODB_URI: mongoUrl.toString(),
  FORCE_PUBLIC_DNS: "true",
  RPC_URL: "http://127.0.0.1:8545",
  E2E_RPC_URL: "http://127.0.0.1:8545",
  E2E_CHAIN_ID: "31337",
  E2E_APP_URL: "http://localhost:5173",
  E2E_API_URL: "http://localhost:5000",
  E2E_HEADED: process.env.E2E_HEADED || "true",
  ...(e2ePinataBaseUrl
    ? {
        PINATA_API_BASE_URL: e2ePinataBaseUrl,
        VITE_IPFS_GATEWAY: `${e2ePinataBaseUrl}/ipfs/`,
      }
    : {}),
  ...(process.env.E2E_PINATA_JWT
    ? { PINATA_JWT: process.env.E2E_PINATA_JWT }
    : {}),
  ...(rpcProxyEnabled
    ? {
        E2E_BACKEND_RPC_URL: "http://127.0.0.1:18545",
        E2E_RPC_PROXY_TARGET_URL: "http://127.0.0.1:8545",
        E2E_RPC_PROXY_PORT: "18545",
      }
    : {}),
  DEMO_USE_HARDHAT_ACCOUNTS: "true",
  DEV_ALLOW_CLAIM_LIMIT_RESET: "true",
  ADMIN_PRIVATE_KEY: wallets[0].privateKey,
  CLAIM_OFFICER_WALLET_ADDRESS: wallets[0].address,
  E2E_USER_PRIVATE_KEY: wallets[1].privateKey,
  ORACLE_PRIVATE_KEY: wallets[2].privateKey,
  ORACLE_PRIVATE_KEY_2: wallets[3].privateKey,
  AUDITOR_WALLET_ADDRESS: wallets[6].address,
  AUDITOR_WALLET_ADDRESS_2: wallets[7].address,
  AUDITOR_WALLET_ADDRESS_3: wallets[8].address,
  AUDITOR_WALLET_ADDRESS_4: wallets[9].address,
  E2E_AUDITOR_PRIVATE_KEY_1: wallets[6].privateKey,
  E2E_AUDITOR_PRIVATE_KEY_2: wallets[7].privateKey,
  E2E_AUDITOR_PRIVATE_KEY_3: wallets[8].privateKey,
  E2E_AUDITOR_PRIVATE_KEY_4: wallets[9].privateKey,
  HOSPITAL_WALLET_ADDRESSES: wallets.slice(10, 15).map((entry) => entry.address).join(","),
  E2E_HOSPITAL_PRIVATE_KEY: wallets[10].privateKey,
  E2E_HOSPITAL_PRIVATE_KEY_2: wallets[11].privateKey,
  BANK_WALLET_ADDRESS: wallets[15].address,
  E2E_BANK_PRIVATE_KEY: wallets[15].privateKey,
  E2E_BENEFICIARY_PRIVATE_KEY: wallets[16].privateKey,
  DEMO_BANK_ACCOUNT_OWNER_ADDRESSES: [wallets[1], wallets[16], wallets[17]]
    .map((entry) => entry.address)
    .join(","),
};

console.log(
  `[Isolated E2E] npm run ${scriptName}; MongoDB host=${mongoUrl.hostname}; database=block_insure_e2e; ` +
    `RPC=http://127.0.0.1:8545; chainId=31337; wallets=Hardhat defaults; ` +
    `browser=${isolatedEnvironment.E2E_HEADED === "true" ? "headed" : "headless"}; ` +
    `backendRpcProxy=${rpcProxyEnabled ? "enabled" : "disabled"}; ` +
    `evidenceHost=${e2ePinataBaseUrl ? new URL(e2ePinataBaseUrl).hostname : "saved-config"}`
);

const child = spawn(process.execPath, [npmCli, "run", scriptName, ...scriptArguments], {
  cwd: projectRoot,
  env: isolatedEnvironment,
  stdio: "inherit",
  windowsHide: true,
});

child.once("error", (error) => {
  console.error(`[Isolated E2E] Failed to start npm: ${error.message}`);
  process.exitCode = 1;
});
child.once("exit", (code, signal) => {
  if (signal) {
    console.error(`[Isolated E2E] npm stopped by ${signal}`);
    process.exitCode = 1;
  } else {
    process.exitCode = code ?? 1;
  }
});
