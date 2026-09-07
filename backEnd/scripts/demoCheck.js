require("dotenv").config();

const fs = require("fs");
const net = require("net");
const path = require("path");

const checks = [
  { name: "Hardhat node", host: "127.0.0.1", port: 8545 },
  { name: "Backend server", host: "127.0.0.1", port: Number(process.env.PORT || 5000) },
  { name: "Frontend app", host: "localhost", port: 5173 },
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
  let failures = 0;

  for (const key of requiredEnv) {
    const configured = Boolean(process.env[key]);
    if (!configured) failures += 1;
    console.log(`${configured ? "✅" : "❌"} Env ${key}`);
  }

  console.log("");

  for (const check of checks) {
    const ok = await checkPort(check);
    if (!ok) failures += 1;
    const symbol = ok ? "✅" : "❌";
    const suffix = check.port ? `${check.host}:${check.port}` : "port not configured";
    console.log(`${symbol} ${check.name} (${suffix})`);
  }

  const contractArtifact = path.resolve(
    __dirname,
    "..",
    "abi",
    "InsuranceManager.json"
  );
  const abiExists = fs.existsSync(contractArtifact);
  if (!abiExists) failures += 1;
  console.log(`${abiExists ? "✅" : "❌"} Backend contract ABI`);

  console.log("\nSupervisor rehearsal:");
  console.log("1. Start a deterministic stack: npm run dev:hybrid");
  console.log("2. In a second terminal: npm run preflight:metamask");
  console.log("3. Read docs/supervisor-showcase-guide.md before presenting");

  if (failures) {
    throw new Error(`Local demo readiness failed with ${failures} issue(s)`);
  }
  console.log("\nLocal demo readiness checks passed.");
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
