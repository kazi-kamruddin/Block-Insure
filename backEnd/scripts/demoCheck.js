require("dotenv").config();

const fs = require("fs");
const net = require("net");
const path = require("path");

const checks = [
  { name: "Hardhat node", host: "127.0.0.1", port: 8545 },
  { name: "Backend server", host: "127.0.0.1", port: Number(process.env.PORT || 5000) },
  { name: "Frontend app", host: "127.0.0.1", port: 5173 },
  { name: "MongoDB", host: "127.0.0.1", port: 27017 },
  { name: "Oracle worker 1", host: "127.0.0.1", port: Number(process.env.ORACLE_WORKER_PORT || 0), optional: true },
  { name: "Oracle worker 2", host: "127.0.0.1", port: Number(process.env.ORACLE2_WORKER_PORT || 0), optional: true },
];

const requiredEnv = [
  "MONGODB_URI",
  "RPC_URL",
  "VITE_CONTRACT_ADDRESS",
  "ADMIN_PRIVATE_KEY",
];

function checkPort({ host, port }) {
  return new Promise((resolve) => {
    if (!port) return resolve(false);

    const socket = net.createConnection({ host, port, timeout: 1200 }, () => {
      socket.destroy();
      resolve(true);
    });

    socket.on("error", () => resolve(false));
    socket.on("timeout", () => {
      socket.destroy();
      resolve(false);
    });
  });
}

async function main() {
  console.log("Block-Insure local demo readiness checklist\n");

  for (const key of requiredEnv) {
    console.log(`${process.env[key] ? "✅" : "❌"} Env ${key}`);
  }

  console.log("");

  for (const check of checks) {
    const ok = await checkPort(check);
    const symbol = ok ? "✅" : check.optional ? "⚠️" : "❌";
    const suffix = check.port ? `${check.host}:${check.port}` : "port not configured";
    console.log(`${symbol} ${check.name} (${suffix})`);
  }

  const contractArtifact = path.resolve(
    __dirname,
    "..",
    "abi",
    "InsuranceManager.json"
  );
  console.log(`${fs.existsSync(contractArtifact) ? "✅" : "❌"} Backend contract ABI`);

  console.log("\nBefore defense, run these in order when needed:");
  console.log("1. cd contracts && npx hardhat node");
  console.log("2. cd contracts && npx hardhat run scripts/deploy-local.js --network localhost");
  console.log("3. cd backend && npm run grant:roles");
  console.log("4. cd backend && npm run push:merkle");
  console.log("5. cd backend && npm run demo:populate");
  console.log("6. cd backend && npm run verify:demo");
  console.log("7. cd backend && npm run dev");
  console.log("8. cd frontend && npm run dev");
}

main();
