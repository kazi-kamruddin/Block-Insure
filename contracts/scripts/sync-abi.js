const fs = require("fs");
const path = require("path");

const projectRoot = path.resolve(__dirname, "..", "..");

for (const contractName of ["InsuranceManager", "OracleCoordinator", "ClaimAdjudicator"]) {
  const artifactPath = path.join(
    projectRoot,
    "contracts",
    "artifacts",
    "contracts",
    `${contractName}.sol`,
    `${contractName}.json`
  );
  const artifact = JSON.parse(fs.readFileSync(artifactPath, "utf8"));
  const abiDocument = `${JSON.stringify({ contractName, abi: artifact.abi }, null, 2)}\n`;

  for (const target of [
    path.join(projectRoot, "backEnd", "abi", `${contractName}.json`),
    path.join(projectRoot, "frontEnd", "src", "abi", `${contractName}.json`),
    path.join(projectRoot, "oracle", "abi", `${contractName}.json`),
  ]) {
    fs.writeFileSync(target, abiDocument, "utf8");
    console.log(`Updated ${path.relative(projectRoot, target)}`);
  }
}
