const { isAddress, Wallet } = require("ethers");

const LOCAL_ORIGINS = [
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "http://localhost:3000",
  "http://127.0.0.1:3000",
];

const PRODUCTION_REQUIRED_KEYS = [
  "MONGODB_URI",
  "JWT_SECRET",
  "RPC_URL",
  "CHAIN_ID",
  "ALLOWED_ORIGINS",
  "SIWE_URI",
  "VITE_CONTRACT_ADDRESS",
  "POLICY_BENEFITS_ADDRESS",
  "EVIDENCE_REGISTRY_ADDRESS",
  "HOSPITAL_VERIFICATION_REGISTRY_ADDRESS",
  "BANK_IDENTITY_REGISTRY_ADDRESS",
  "PROTOCOL_DEPLOYMENT_REGISTRY_ADDRESS",
  "ADMIN_PRIVATE_KEY",
  "BANK_PRIVATE_KEY",
  "BANK_WALLET_ADDRESS",
  "BANK_OTP_SECRET",
  "EVIDENCE_LOG_SIGNER_PRIVATE_KEY",
  "ORACLE_API_KEY",
  "PRE_PROXY_SIGNING_KEYS_JSON",
  "CLAIM_OFFICER_WALLET_ADDRESS",
  "AUDITOR_WALLET_ADDRESS",
  "AUDITOR_WALLET_ADDRESS_2",
  "AUDITOR_WALLET_ADDRESS_3",
  "AUDITOR_WALLET_ADDRESS_4",
  "HOSPITAL_WALLET_ADDRESSES",
  "DEMO_BANK_ACCOUNT_OWNER_ADDRESSES",
];

const CONTRACT_ADDRESS_KEYS = [
  "VITE_CONTRACT_ADDRESS",
  "POLICY_BENEFITS_ADDRESS",
  "EVIDENCE_REGISTRY_ADDRESS",
  "HOSPITAL_VERIFICATION_REGISTRY_ADDRESS",
  "BANK_IDENTITY_REGISTRY_ADDRESS",
  "PROTOCOL_DEPLOYMENT_REGISTRY_ADDRESS",
];

const splitCommaSeparated = (value) =>
  String(value || "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);

const validUrl = (value, protocols) => {
  try {
    return protocols.includes(new URL(value).protocol);
  } catch {
    return false;
  }
};

const parseTrustProxy = (value) => {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized || normalized === "false" || normalized === "0") return false;
  if (normalized === "true") return 1;
  if (/^[1-9]\d*$/.test(normalized)) return Number(normalized);
  return null;
};

const inspectRuntimeEnvironment = (environment = process.env) => {
  const production = environment.NODE_ENV === "production";
  const failures = [];
  const warnings = [];
  const configuredOrigins = splitCommaSeparated(environment.ALLOWED_ORIGINS);
  const allowedOrigins = configuredOrigins.length
    ? configuredOrigins
    : LOCAL_ORIGINS;
  const trustProxy = parseTrustProxy(environment.TRUST_PROXY);
  const simulatedHospitalApiEnabled = production
    ? environment.ENABLE_SIMULATED_HOSPITAL_API === "true"
    : environment.ENABLE_SIMULATED_HOSPITAL_API !== "false";

  if (production) {
    for (const key of PRODUCTION_REQUIRED_KEYS) {
      if (!String(environment[key] || "").trim()) failures.push(`${key} is required`);
    }

    if (String(environment.JWT_SECRET || "").length < 32) {
      failures.push("JWT_SECRET must contain at least 32 characters");
    }
    if (!validUrl(environment.MONGODB_URI, ["mongodb:", "mongodb+srv:"])) {
      failures.push("MONGODB_URI must be a valid MongoDB connection URL");
    }
    if (!validUrl(environment.RPC_URL, ["https:", "wss:"])) {
      failures.push("RPC_URL must use HTTPS or WSS in production");
    }
    if (!validUrl(environment.SIWE_URI, ["https:"])) {
      failures.push("SIWE_URI must be an HTTPS URL in production");
    }
    for (const origin of configuredOrigins) {
      if (!validUrl(origin, ["https:"])) {
        failures.push(`ALLOWED_ORIGINS contains a non-HTTPS origin: ${origin}`);
      }
    }
    if (!Number.isSafeInteger(Number(environment.CHAIN_ID)) || Number(environment.CHAIN_ID) <= 0) {
      failures.push("CHAIN_ID must be a positive integer");
    }
    if (Number(environment.CHAIN_ID) === 31337) {
      failures.push("Production must not use the local Hardhat chain ID 31337");
    }
    for (const key of CONTRACT_ADDRESS_KEYS) {
      if (environment[key] && !isAddress(environment[key])) {
        failures.push(`${key} must be a valid Ethereum address`);
      }
    }
    for (const key of [
      "CLAIM_OFFICER_WALLET_ADDRESS",
      "AUDITOR_WALLET_ADDRESS",
      "AUDITOR_WALLET_ADDRESS_2",
      "AUDITOR_WALLET_ADDRESS_3",
      "AUDITOR_WALLET_ADDRESS_4",
      "BANK_WALLET_ADDRESS",
    ]) {
      if (environment[key] && !isAddress(environment[key])) {
        failures.push(`${key} must be a valid Ethereum address`);
      }
    }
    for (const [key, expectedCount] of [
      ["HOSPITAL_WALLET_ADDRESSES", 5],
      ["DEMO_BANK_ACCOUNT_OWNER_ADDRESSES", 3],
    ]) {
      const addresses = splitCommaSeparated(environment[key]);
      if (addresses.length !== expectedCount || addresses.some((value) => !isAddress(value))) {
        failures.push(`${key} must contain exactly ${expectedCount} valid Ethereum addresses`);
      }
    }
    for (const key of [
      "ADMIN_PRIVATE_KEY",
      "BANK_PRIVATE_KEY",
      "EVIDENCE_LOG_SIGNER_PRIVATE_KEY",
    ]) {
      try {
        if (environment[key]) new Wallet(environment[key]);
      } catch {
        failures.push(`${key} must be a valid Ethereum private key`);
      }
    }
    try {
      if (
        environment.BANK_PRIVATE_KEY &&
        environment.BANK_WALLET_ADDRESS &&
        new Wallet(environment.BANK_PRIVATE_KEY).address.toLowerCase() !==
          environment.BANK_WALLET_ADDRESS.toLowerCase()
      ) {
        failures.push("BANK_PRIVATE_KEY must control BANK_WALLET_ADDRESS");
      }
    } catch {
      // The private-key validator reports the actionable failure.
    }
    if (
      !environment.PINATA_JWT &&
      !(environment.PINATA_API_KEY && environment.PINATA_SECRET)
    ) {
      failures.push("Pinata credentials are required for evidence uploads");
    }
    try {
      const signingKeys = JSON.parse(environment.PRE_PROXY_SIGNING_KEYS_JSON || "null");
      if (!signingKeys?.publicKey || !signingKeys?.privateKey) {
        failures.push(
          "PRE_PROXY_SIGNING_KEYS_JSON must contain serialized publicKey and privateKey values"
        );
      }
    } catch {
      failures.push("PRE_PROXY_SIGNING_KEYS_JSON must be valid JSON");
    }
    if (String(environment.ORACLE_API_KEY || "").length < 32) {
      failures.push("ORACLE_API_KEY must contain at least 32 characters");
    }
    if (String(environment.BANK_OTP_SECRET || "").length < 32) {
      failures.push("BANK_OTP_SECRET must contain at least 32 characters");
    }
    if (environment.BANK_OTP_SECRET === environment.JWT_SECRET) {
      failures.push("BANK_OTP_SECRET must be distinct from JWT_SECRET");
    }
    if (environment.EXPOSE_INTERNAL_ERRORS === "true") {
      failures.push("EXPOSE_INTERNAL_ERRORS must be false in production");
    }
    if (environment.DEV_ALLOW_CLAIM_LIMIT_RESET === "true") {
      failures.push("DEV_ALLOW_CLAIM_LIMIT_RESET must be false in production");
    }
    if (environment.DEMO_USE_HARDHAT_ACCOUNTS === "true") {
      failures.push("DEMO_USE_HARDHAT_ACCOUNTS must be false in production");
    }
    if (trustProxy === false) {
      failures.push("TRUST_PROXY must identify the trusted reverse-proxy hop count");
    }
    if (!simulatedHospitalApiEnabled) {
      warnings.push(
        "Simulated hospital API is disabled; hybrid registry and oracle demo endpoints will be unavailable"
      );
    }
  }

  if (trustProxy === null) failures.push("TRUST_PROXY must be true, false, or a positive integer");

  return {
    allowedOrigins,
    failures,
    production,
    simulatedHospitalApiEnabled,
    trustProxy: trustProxy ?? false,
    warnings,
  };
};

const assertRuntimeEnvironment = (environment = process.env) => {
  const result = inspectRuntimeEnvironment(environment);
  if (result.failures.length) {
    throw new Error(
      `Invalid Block-Insure runtime configuration:\n- ${result.failures.join("\n- ")}`
    );
  }
  return result;
};

module.exports = {
  CONTRACT_ADDRESS_KEYS,
  LOCAL_ORIGINS,
  PRODUCTION_REQUIRED_KEYS,
  assertRuntimeEnvironment,
  inspectRuntimeEnvironment,
};
