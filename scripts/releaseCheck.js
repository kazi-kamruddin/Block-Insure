const fs = require("node:fs");
const path = require("node:path");
const {
  CONTRACT_ADDRESS_KEYS,
  PRODUCTION_REQUIRED_KEYS,
  inspectRuntimeEnvironment,
} = require("../backEnd/config/runtimeConfig");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const TEMPLATE_PATH = path.join(PROJECT_ROOT, "deploy", "production.env.example");
const DEFAULT_ENV_PATH = path.join(PROJECT_ROOT, "deploy", "production.env");
const FRONTEND_ADDRESS_KEYS = {
  VITE_CONTRACT_ADDRESS: "VITE_CONTRACT_ADDRESS",
  VITE_POLICY_BENEFITS_ADDRESS: "POLICY_BENEFITS_ADDRESS",
  VITE_EVIDENCE_REGISTRY_ADDRESS: "EVIDENCE_REGISTRY_ADDRESS",
  VITE_HOSPITAL_VERIFICATION_REGISTRY_ADDRESS:
    "HOSPITAL_VERIFICATION_REGISTRY_ADDRESS",
  VITE_BANK_IDENTITY_REGISTRY_ADDRESS: "BANK_IDENTITY_REGISTRY_ADDRESS",
  VITE_PROTOCOL_DEPLOYMENT_REGISTRY_ADDRESS:
    "PROTOCOL_DEPLOYMENT_REGISTRY_ADDRESS",
};
const RELEASE_FILES = [
  ".dockerignore",
  "deploy/backend.Dockerfile",
  "deploy/oracle.Dockerfile",
  "deploy/frontend.Dockerfile",
  "deploy/nginx.conf",
  "deploy/Caddyfile",
  "deploy/compose.production.yml",
  "docs/deployment-guide.md",
];

const parseEnv = (content) =>
  Object.fromEntries(
    content
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#") && line.includes("="))
      .map((line) => {
        const separator = line.indexOf("=");
        const key = line.slice(0, separator).trim();
        let value = line.slice(separator + 1).trim();
        if (
          value.length >= 2 &&
          ((value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'")))
        ) {
          value = value.slice(1, -1);
        }
        return [key, value];
      })
  );

const resolveEnvironmentPath = (args) => {
  const index = args.indexOf("--env");
  if (index === -1) return DEFAULT_ENV_PATH;
  if (!args[index + 1]) throw new Error("--env requires a file path");
  return path.resolve(PROJECT_ROOT, args[index + 1]);
};

const isPrivateKey = (value) => /^0x[0-9a-fA-F]{64}$/.test(String(value || ""));
const isAddress = (value) => /^0x[0-9a-fA-F]{40}$/.test(String(value || ""));
const isLocalUrl = (value) => /(?:localhost|127\.0\.0\.1|0\.0\.0\.0)/i.test(value || "");

const requiredTemplateKeys = () => [
  ...PRODUCTION_REQUIRED_KEYS,
  ...Object.keys(FRONTEND_ADDRESS_KEYS),
  "NODE_ENV",
  "PUBLIC_APP_URL",
  "PUBLIC_HOST",
  "TLS_EMAIL",
  "VITE_RPC_URL",
  "VITE_CHAIN_ID",
  "VITE_NETWORK_NAME",
  "VITE_BLOCK_EXPLORER_URL",
  "CONTRACT_ADDRESS",
  "ORACLE_PRIVATE_KEY",
  "ORACLE_PRIVATE_KEY_2",
  "BACKEND_API_URL",
  "MOCK_HOSPITAL_API_URL",
];

const verifyReleaseFiles = (failures) => {
  for (const relativePath of RELEASE_FILES) {
    if (!fs.existsSync(path.join(PROJECT_ROOT, relativePath))) {
      failures.push(`Release file is missing: ${relativePath}`);
    }
  }
};

const verifyTemplate = (environment) => {
  const failures = [];
  verifyReleaseFiles(failures);
  for (const key of requiredTemplateKeys()) {
    if (!(key in environment)) failures.push(`Deployment template is missing ${key}`);
  }
  return failures;
};

const verifyProductionEnvironment = (environment) => {
  const failures = [...inspectRuntimeEnvironment(environment).failures];
  verifyReleaseFiles(failures);

  if (environment.NODE_ENV !== "production") {
    failures.push("NODE_ENV must be production");
  }
  if (!/^https:\/\//i.test(environment.PUBLIC_APP_URL || "")) {
    failures.push("PUBLIC_APP_URL must use HTTPS");
  }
  try {
    if (new URL(environment.PUBLIC_APP_URL).host !== environment.PUBLIC_HOST) {
      failures.push("PUBLIC_HOST must equal the hostname in PUBLIC_APP_URL");
    }
  } catch {
    // PUBLIC_APP_URL already has a dedicated validation error.
  }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(environment.TLS_EMAIL || "")) {
    failures.push("TLS_EMAIL must be a valid certificate-notification email address");
  }
  if (
    !String(environment.ALLOWED_ORIGINS || "")
      .split(",")
      .map((value) => value.trim())
      .includes(environment.PUBLIC_APP_URL)
  ) {
    failures.push("ALLOWED_ORIGINS must contain PUBLIC_APP_URL exactly");
  }
  if (environment.SIWE_URI !== environment.PUBLIC_APP_URL) {
    failures.push("SIWE_URI must equal PUBLIC_APP_URL");
  }
  if (environment.CONTRACT_ADDRESS !== environment.VITE_CONTRACT_ADDRESS) {
    failures.push("CONTRACT_ADDRESS must equal VITE_CONTRACT_ADDRESS");
  }
  if (String(environment.VITE_CHAIN_ID) !== String(environment.CHAIN_ID)) {
    failures.push("VITE_CHAIN_ID must equal CHAIN_ID");
  }
  if (environment.VITE_RPC_URL !== environment.RPC_URL) {
    failures.push("VITE_RPC_URL must equal RPC_URL");
  }
  for (const [frontendKey, backendKey] of Object.entries(FRONTEND_ADDRESS_KEYS)) {
    if (environment[frontendKey] !== environment[backendKey]) {
      failures.push(`${frontendKey} must equal ${backendKey}`);
    }
    if (!isAddress(environment[frontendKey])) {
      failures.push(`${frontendKey} must be a valid Ethereum address`);
    }
  }
  for (const key of [...CONTRACT_ADDRESS_KEYS, "CONTRACT_ADDRESS"]) {
    if (!environment[key]) failures.push(`${key} is required`);
  }
  for (const key of [
    "ADMIN_PRIVATE_KEY",
    "BANK_PRIVATE_KEY",
    "EVIDENCE_LOG_SIGNER_PRIVATE_KEY",
    "ORACLE_PRIVATE_KEY",
    "ORACLE_PRIVATE_KEY_2",
  ]) {
    if (!isPrivateKey(environment[key])) failures.push(`${key} must be a 32-byte hex private key`);
  }
  const uniqueKeys = new Set(
    [
      environment.ADMIN_PRIVATE_KEY,
      environment.BANK_PRIVATE_KEY,
      environment.EVIDENCE_LOG_SIGNER_PRIVATE_KEY,
      environment.ORACLE_PRIVATE_KEY,
      environment.ORACLE_PRIVATE_KEY_2,
    ].map((value) => String(value || "").toLowerCase())
  );
  if (uniqueKeys.size !== 5) {
    failures.push("Admin, bank, evidence signer, and both oracle private keys must be distinct");
  }
  const actorAddresses = [
    environment.CLAIM_OFFICER_WALLET_ADDRESS,
    environment.AUDITOR_WALLET_ADDRESS,
    environment.AUDITOR_WALLET_ADDRESS_2,
    environment.AUDITOR_WALLET_ADDRESS_3,
    environment.AUDITOR_WALLET_ADDRESS_4,
    environment.BANK_WALLET_ADDRESS,
    ...String(environment.HOSPITAL_WALLET_ADDRESSES || "").split(","),
  ].map((value) => String(value || "").trim().toLowerCase());
  if (new Set(actorAddresses).size !== actorAddresses.length) {
    failures.push("Claim officer, auditors, bank, and hospitals must use distinct wallets");
  }
  const componentAddresses = Object.keys(FRONTEND_ADDRESS_KEYS).map((key) =>
    String(environment[key] || "").toLowerCase()
  );
  if (new Set(componentAddresses).size !== componentAddresses.length) {
    failures.push("Every deployed protocol component must have a distinct address");
  }
  for (const key of ["RPC_URL", "VITE_RPC_URL", "PUBLIC_APP_URL"]) {
    if (isLocalUrl(environment[key])) failures.push(`${key} must not point to localhost`);
  }
  return [...new Set(failures)];
};

const main = () => {
  const args = process.argv.slice(2);
  const templateMode = args.includes("--template");
  const filePath = templateMode ? TEMPLATE_PATH : resolveEnvironmentPath(args);
  if (!fs.existsSync(filePath)) {
    throw new Error(
      `Deployment environment not found: ${filePath}\nCopy deploy/production.env.example to deploy/production.env and fill every secret.`
    );
  }
  const environment = parseEnv(fs.readFileSync(filePath, "utf8"));
  const failures = templateMode
    ? verifyTemplate(environment)
    : verifyProductionEnvironment(environment);
  if (failures.length) {
    throw new Error(`Release check failed:\n- ${failures.join("\n- ")}`);
  }
  console.log(
    templateMode
      ? "[Release check] Deployment template and release files are complete."
      : `[Release check] Production environment is internally consistent for chain ${environment.CHAIN_ID}.`
  );
};

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = {
  parseEnv,
  verifyProductionEnvironment,
  verifyTemplate,
};
