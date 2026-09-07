const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { Wallet } = require("ethers");
const {
  parseEnv,
  verifyProductionEnvironment,
} = require("../../scripts/releaseCheck");

const projectRoot = path.resolve(__dirname, "..", "..");
const address = (number) => `0x${number.toString(16).padStart(40, "0")}`;
const privateKey = (number) => `0x${number.toString(16).padStart(64, "0")}`;

const validEnvironment = () => {
  const template = parseEnv(
    fs.readFileSync(
      path.join(projectRoot, "deploy", "production.env.example"),
      "utf8"
    )
  );
  return {
    ...template,
    NODE_ENV: "production",
    PUBLIC_APP_URL: "https://insurance.example.com",
    PUBLIC_HOST: "insurance.example.com",
    TLS_EMAIL: "operator@example.com",
    ALLOWED_ORIGINS: "https://insurance.example.com",
    SIWE_URI: "https://insurance.example.com",
    SIWE_DOMAIN: "insurance.example.com",
    MONGODB_URI: "mongodb+srv://example.invalid/block-insure",
    JWT_SECRET: "jwt-secret-that-is-longer-than-32-characters",
    BANK_OTP_SECRET: "bank-secret-that-is-longer-than-32-characters",
    CHAIN_ID: "11155111",
    RPC_URL: "https://rpc.example.invalid",
    VITE_RPC_URL: "https://rpc.example.invalid",
    VITE_CHAIN_ID: "11155111",
    VITE_CONTRACT_ADDRESS: address(1),
    CONTRACT_ADDRESS: address(1),
    POLICY_BENEFITS_ADDRESS: address(2),
    VITE_POLICY_BENEFITS_ADDRESS: address(2),
    EVIDENCE_REGISTRY_ADDRESS: address(3),
    VITE_EVIDENCE_REGISTRY_ADDRESS: address(3),
    HOSPITAL_VERIFICATION_REGISTRY_ADDRESS: address(4),
    VITE_HOSPITAL_VERIFICATION_REGISTRY_ADDRESS: address(4),
    BANK_IDENTITY_REGISTRY_ADDRESS: address(5),
    VITE_BANK_IDENTITY_REGISTRY_ADDRESS: address(5),
    PROTOCOL_DEPLOYMENT_REGISTRY_ADDRESS: address(6),
    VITE_PROTOCOL_DEPLOYMENT_REGISTRY_ADDRESS: address(6),
    VITE_CLAIM_ADJUDICATOR_ADDRESS: address(7),
    VITE_POLICY_ECONOMICS_ADDRESS: address(8),
    CLAIM_OFFICER_WALLET_ADDRESS: address(9),
    AUDITOR_WALLET_ADDRESS: address(10),
    AUDITOR_WALLET_ADDRESS_2: address(11),
    AUDITOR_WALLET_ADDRESS_3: address(12),
    AUDITOR_WALLET_ADDRESS_4: address(13),
    HOSPITAL_WALLET_ADDRESSES: [14, 15, 16, 17, 18]
      .map(address)
      .join(","),
    DEMO_BANK_ACCOUNT_OWNER_ADDRESSES: [19, 20, 21]
      .map(address)
      .join(","),
    ADMIN_PRIVATE_KEY: privateKey(1),
    BANK_PRIVATE_KEY: privateKey(2),
    BANK_WALLET_ADDRESS: new Wallet(privateKey(2)).address,
    EVIDENCE_LOG_SIGNER_PRIVATE_KEY: privateKey(3),
    ORACLE_PRIVATE_KEY: privateKey(4),
    ORACLE_PRIVATE_KEY_2: privateKey(5),
    ORACLE_API_KEY: "oracle-secret-that-is-longer-than-32-characters",
    PRE_PROXY_SIGNING_KEYS_JSON: JSON.stringify({
      publicKey: "b64:public",
      privateKey: "b64:private",
    }),
    PINATA_JWT: "pinata-test-token",
    TRUST_PROXY: "1",
    ENABLE_SIMULATED_HOSPITAL_API: "true",
    EXPOSE_INTERNAL_ERRORS: "false",
    DEV_ALLOW_CLAIM_LIMIT_RESET: "false",
    DEMO_USE_HARDHAT_ACCOUNTS: "false",
  };
};

test("production release configuration is complete and internally consistent", () => {
  assert.deepEqual(verifyProductionEnvironment(validEnvironment()), []);
});

test("production release gate rejects local chains and shared signing keys", () => {
  const environment = validEnvironment();
  environment.CHAIN_ID = "31337";
  environment.VITE_CHAIN_ID = "31337";
  environment.ORACLE_PRIVATE_KEY_2 = environment.ORACLE_PRIVATE_KEY;
  const failures = verifyProductionEnvironment(environment).join("\n");
  assert.match(failures, /31337/);
  assert.match(failures, /must be distinct/);
});
