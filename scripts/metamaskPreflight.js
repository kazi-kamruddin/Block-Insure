const fs = require("node:fs");
const path = require("node:path");
const {
  Contract,
  JsonRpcProvider,
  Wallet,
  formatEther,
} = require("../backEnd/node_modules/ethers");
const InsuranceManagerArtifact = require("../backEnd/abi/InsuranceManager.json");
const { getE2EConfig } = require("../e2e/support/environment");

const PROJECT_ROOT = path.resolve(__dirname, "..");

function readEnv(relativePath) {
  const filePath = path.join(PROJECT_ROOT, relativePath);
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

function requireValue(values, key, label) {
  if (!values[key]) throw new Error(`${key} is missing in ${label}`);
  return values[key];
}

async function main() {
  const config = getE2EConfig();
  const backend = readEnv("backEnd/.env");
  const contractAddress = requireValue(
    backend,
    "VITE_CONTRACT_ADDRESS",
    "backEnd/.env"
  );
  const provider = new JsonRpcProvider(config.rpcUrl);
  const contract = new Contract(
    contractAddress,
    InsuranceManagerArtifact.abi,
    provider
  );

  const network = await provider.getNetwork();
  const [adminRole, auditorRole, oracleRole] = await Promise.all([
    contract.DEFAULT_ADMIN_ROLE(),
    contract.AUDITOR_ROLE(),
    contract.ORACLE_ROLE(),
  ]);
  const roleHashes = { ADMIN: adminRole, AUDITOR: auditorRole, ORACLE: oracleRole };
  const browserProfiles = [
    ["Policyholder", new Wallet(config.actors.user.privateKey).address, "USER"],
    ["Admin", new Wallet(config.actors.admin.privateKey).address, "ADMIN"],
    ...["auditor1", "auditor2", "auditor3", "auditor4"].map(
      (actorName, index) => [
        `Auditor ${index + 1}`,
        new Wallet(config.actors[actorName].privateKey).address,
        "AUDITOR",
      ]
    ),
  ];
  const workers = [
    ["Oracle 1", new Wallet(requireValue(backend, "ORACLE_PRIVATE_KEY", "backEnd/.env")).address, "ORACLE"],
    ["Oracle 2", new Wallet(requireValue(backend, "ORACLE_PRIVATE_KEY_2", "backEnd/.env")).address, "ORACLE"],
  ];

  const inspectActor = async ([profile, address, expectedRole]) => {
    const [balance, isAdmin, isAuditor, isOracle] = await Promise.all([
      provider.getBalance(address),
      contract.hasRole(adminRole, address),
      contract.hasRole(auditorRole, address),
      contract.hasRole(oracleRole, address),
    ]);
    const roleCorrect =
      expectedRole === "USER"
        ? !isAdmin && !isAuditor && !isOracle
        : await contract.hasRole(roleHashes[expectedRole], address);
    return {
      profile,
      address,
      expectedRole,
      roleReady: roleCorrect ? "YES" : "NO",
      localETH: formatEther(balance),
    };
  };

  const [profileRows, workerRows, reserve, packageCounter, policyCounter, claimCounter] =
    await Promise.all([
      Promise.all(browserProfiles.map(inspectActor)),
      Promise.all(workers.map(inspectActor)),
      provider.getBalance(contractAddress),
      contract.packageCounter(),
      contract.policyCounter(),
      contract.claimCounter(),
    ]);

  console.log("\nBlock-Insure MetaMask manual-rehearsal preflight\n");
  console.log(`Frontend:         ${config.appUrl}`);
  console.log(`RPC URL:          ${config.rpcUrl}`);
  console.log(`Chain ID:         ${network.chainId}`);
  console.log(`Currency symbol:  ETH`);
  console.log(`Contract:         ${contractAddress}`);
  console.log(`Settlement reserve: ${formatEther(reserve)} ETH`);
  console.log(
    `Current state: ${Number(packageCounter) - 1} packages, ${Number(policyCounter) - 1} policies, ${Number(claimCounter) - 1} claims`
  );
  console.log("\nMetaMask browser profiles (compare these public addresses):");
  console.table(profileRows);
  console.log("Oracle workers (do not use these as browser profiles):");
  console.table(workerRows);

  const failures = [...profileRows, ...workerRows].filter(
    (row) => row.roleReady !== "YES" || Number(row.localETH) <= 0
  );
  if (network.chainId !== BigInt(config.chainId)) {
    failures.push({ profile: "Network", roleReady: "NO", localETH: "-" });
  }
  if (failures.length > 0) {
    throw new Error("One or more MetaMask rehearsal identities are not ready");
  }

  console.log("MetaMask rehearsal identities are ready. No private key was printed.");
  provider.destroy();
}

main().catch((error) => {
  console.error(`[MetaMask preflight] ${error.shortMessage || error.message}`);
  process.exitCode = 1;
});
