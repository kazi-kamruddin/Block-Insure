const test = require("node:test");
const assert = require("node:assert/strict");
const { Wallet } = require("ethers");
const {
  assertRuntimeEnvironment,
  inspectRuntimeEnvironment,
} = require("../config/runtimeConfig");

const address = (digit) => `0x${digit.repeat(40)}`;
const privateKey = (digit) => `0x${digit.repeat(64)}`;
const productionEnvironment = () => ({
  NODE_ENV: "production",
  MONGODB_URI: "mongodb+srv://example.invalid/block-insure",
  JWT_SECRET: "a-production-secret-with-32-characters",
  RPC_URL: "https://rpc.example.invalid",
  CHAIN_ID: "11155111",
  ALLOWED_ORIGINS: "https://insurance.example.invalid",
  SIWE_URI: "https://insurance.example.invalid",
  VITE_CONTRACT_ADDRESS: address("1"),
  POLICY_BENEFITS_ADDRESS: address("2"),
  EVIDENCE_REGISTRY_ADDRESS: address("3"),
  HOSPITAL_VERIFICATION_REGISTRY_ADDRESS: address("4"),
  BANK_IDENTITY_REGISTRY_ADDRESS: address("5"),
  PROTOCOL_DEPLOYMENT_REGISTRY_ADDRESS: address("6"),
  ADMIN_PRIVATE_KEY: privateKey("1"),
  BANK_PRIVATE_KEY: privateKey("2"),
  BANK_WALLET_ADDRESS: new Wallet(privateKey("2")).address,
  BANK_OTP_SECRET: "a-distinct-bank-otp-secret-with-32-characters",
  EVIDENCE_LOG_SIGNER_PRIVATE_KEY: privateKey("3"),
  ORACLE_PRIVATE_KEY: privateKey("4"),
  ORACLE_PRIVATE_KEY_2: privateKey("5"),
  ORACLE_API_KEY: "an-oracle-api-key-with-32-characters",
  PRE_PROXY_SIGNING_KEYS_JSON: JSON.stringify({
    publicKey: "b64:public",
    privateKey: "b64:private",
  }),
  PINATA_JWT: "pinata-token",
  TRUST_PROXY: "1",
  EXPOSE_INTERNAL_ERRORS: "false",
  DEV_ALLOW_CLAIM_LIMIT_RESET: "false",
  DEMO_USE_HARDHAT_ACCOUNTS: "false",
  ENABLE_SIMULATED_HOSPITAL_API: "true",
  CLAIM_OFFICER_WALLET_ADDRESS: address("7"),
  AUDITOR_WALLET_ADDRESS: address("8"),
  AUDITOR_WALLET_ADDRESS_2: address("9"),
  AUDITOR_WALLET_ADDRESS_3: address("a"),
  AUDITOR_WALLET_ADDRESS_4: address("b"),
  HOSPITAL_WALLET_ADDRESSES: ["c", "d", "e", "f", "1"]
    .map(address)
    .join(","),
  DEMO_BANK_ACCOUNT_OWNER_ADDRESSES: ["2", "3", "4"]
    .map(address)
    .join(","),
});

test("accepts an explicit production environment", () => {
  const result = assertRuntimeEnvironment(productionEnvironment());
  assert.equal(result.production, true);
  assert.equal(result.trustProxy, 1);
  assert.equal(result.simulatedHospitalApiEnabled, true);
});

test("rejects local URLs, local chain IDs, and unsafe development switches", () => {
  const environment = productionEnvironment();
  environment.RPC_URL = "http://127.0.0.1:8545";
  environment.CHAIN_ID = "31337";
  environment.EXPOSE_INTERNAL_ERRORS = "true";
  environment.DEV_ALLOW_CLAIM_LIMIT_RESET = "true";
  const result = inspectRuntimeEnvironment(environment);
  assert.match(result.failures.join("\n"), /HTTPS or WSS/);
  assert.match(result.failures.join("\n"), /31337/);
  assert.match(result.failures.join("\n"), /EXPOSE_INTERNAL_ERRORS/);
  assert.match(result.failures.join("\n"), /DEV_ALLOW_CLAIM_LIMIT_RESET/);
});

test("rejects invalid contract addresses and weak authentication secrets", () => {
  const environment = productionEnvironment();
  environment.JWT_SECRET = "short";
  environment.EVIDENCE_REGISTRY_ADDRESS = "not-an-address";
  const result = inspectRuntimeEnvironment(environment);
  assert.match(result.failures.join("\n"), /at least 32/);
  assert.match(result.failures.join("\n"), /EVIDENCE_REGISTRY_ADDRESS/);
});

test("keeps local development defaults compatible", () => {
  const result = assertRuntimeEnvironment({ NODE_ENV: "development" });
  assert.equal(result.production, false);
  assert.equal(result.simulatedHospitalApiEnabled, true);
  assert.ok(result.allowedOrigins.some((origin) => origin.includes("localhost")));
});
