const { expect } = require("chai");
const hre = require("hardhat");

describe("InsuranceManager - Deployment Readiness", function () {
  const deploymentSizeTest = hre.__SOLIDITY_COVERAGE_RUNNING ? it.skip : it;

  deploymentSizeTest("keeps deployed bytecode under the EIP-170 contract size limit", async function () {
    const artifact = require("../artifacts/contracts/InsuranceManager.sol/InsuranceManager.json");
    const coordinatorArtifact = require("../artifacts/contracts/OracleCoordinator.sol/OracleCoordinator.json");
    const deployedBytes = (artifact.deployedBytecode.length - 2) / 2;
    const coordinatorBytes = (coordinatorArtifact.deployedBytecode.length - 2) / 2;

    expect(deployedBytes).to.be.lessThanOrEqual(24576);
    expect(coordinatorBytes).to.be.lessThanOrEqual(24576);
  });
});
