const fs = require("fs");
const path = require("path");

const projectRoot = path.resolve(__dirname, "..", "..");
const artifactPath = path.join(
  projectRoot,
  "contracts",
  "artifacts",
  "contracts",
  "InsuranceManager.sol",
  "InsuranceManager.json"
);
const artifact = JSON.parse(fs.readFileSync(artifactPath, "utf8"));
const abiDocument = `${JSON.stringify(
  {
    contractName: "InsuranceManager",
    abi: artifact.abi,
  },
  null,
  2
)}\n`;

[
  path.join(projectRoot, "backend", "abi", "InsuranceManager.json"),
  path.join(projectRoot, "frontend", "src", "abi", "InsuranceManager.json"),
  path.join(projectRoot, "oracle", "abi", "InsuranceManager.json"),
].forEach((target) => {
  fs.writeFileSync(target, abiDocument, "utf8");
  console.log(`Updated ${path.relative(projectRoot, target)}`);
});
