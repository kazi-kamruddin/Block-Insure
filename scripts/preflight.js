const fs = require("node:fs");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");

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
        return [line.slice(0, separator), line.slice(separator + 1)];
      })
  );
}

function main() {
  const failures = [];
  const warnings = [];
  const files = {
    backend: readEnv("backEnd/.env"),
    frontend: readEnv("frontEnd/.env"),
    contracts: readEnv("contracts/.env"),
    oracleOne: readEnv("oracle/.env"),
    oracleTwo: readEnv("oracle/.env.oracle2"),
  };

  for (const [label, values] of Object.entries(files)) {
    if (!values) failures.push(`${label} environment file is missing`);
  }

  const required = [
    ["backend", "MONGODB_URI"],
    ["backend", "JWT_SECRET"],
    ["backend", "RPC_URL"],
    ["backend", "VITE_CONTRACT_ADDRESS"],
    ["backend", "ADMIN_PRIVATE_KEY"],
    ["backend", "ORACLE_PRIVATE_KEY"],
    ["backend", "ORACLE_PRIVATE_KEY_2"],
    ["backend", "ORACLE_API_KEY"],
    ["frontend", "VITE_CONTRACT_ADDRESS"],
    ["contracts", "ADMIN_PRIVATE_KEY"],
    ["oracleOne", "CONTRACT_ADDRESS"],
    ["oracleOne", "ORACLE_PRIVATE_KEY"],
    ["oracleOne", "ORACLE_API_KEY"],
    ["oracleTwo", "CONTRACT_ADDRESS"],
    ["oracleTwo", "ORACLE_PRIVATE_KEY_2"],
    ["oracleTwo", "ORACLE_API_KEY"],
  ];

  for (const [fileLabel, key] of required) {
    if (files[fileLabel] && !files[fileLabel][key]) {
      failures.push(`${key} is missing in ${fileLabel}`);
    }
  }

  if (
    files.backend &&
    !files.backend.AUDITOR_WALLET_ADDRESS_2 &&
    !files.backend.DEMO_AUDITOR_PRIVATE_KEY_2
  ) {
    warnings.push(
      "Second auditor is not configured; set AUDITOR_WALLET_ADDRESS_2 before a clean setup"
    );
  }

  if (failures.length) {
    throw new Error(`Preflight failed:\n- ${failures.join("\n- ")}`);
  }

  warnings.forEach((warning) => console.warn(`[Preflight] Warning: ${warning}`));
  console.log("[Preflight] Environment files and required service values are ready.");
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
