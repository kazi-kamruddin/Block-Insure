const { expect } = require("chai");
const hre = require("hardhat");

describe("InsuranceManager - Deployment Readiness", function () {
  const deploymentSizeTest = hre.__SOLIDITY_COVERAGE_RUNNING ? it.skip : it;

  deploymentSizeTest("keeps deployed bytecode under the EIP-170 contract size limit", async function () {
    const artifact = require("../artifacts/contracts/InsuranceManager.sol/InsuranceManager.json");
    const coordinatorArtifact = require("../artifacts/contracts/OracleCoordinator.sol/OracleCoordinator.json");
    const adjudicatorArtifact = require("../artifacts/contracts/ClaimAdjudicator.sol/ClaimAdjudicator.json");
    const economicsArtifact = require("../artifacts/contracts/PolicyEconomics.sol/PolicyEconomics.json");
    const evidenceArtifact = require("../artifacts/contracts/EvidenceRegistry.sol/EvidenceRegistry.json");
    const benefitsArtifact = require("../artifacts/contracts/PolicyBenefitsManager.sol/PolicyBenefitsManager.json");
    const registryArtifact = require("../artifacts/contracts/ProtocolDeploymentRegistry.sol/ProtocolDeploymentRegistry.json");
    const deployedBytes = (artifact.deployedBytecode.length - 2) / 2;
    const coordinatorBytes = (coordinatorArtifact.deployedBytecode.length - 2) / 2;
    const adjudicatorBytes = (adjudicatorArtifact.deployedBytecode.length - 2) / 2;
    const moduleSizes = [economicsArtifact, evidenceArtifact, benefitsArtifact, registryArtifact]
      .map((moduleArtifact) => (moduleArtifact.deployedBytecode.length - 2) / 2);

    expect(deployedBytes).to.be.lessThanOrEqual(24576);
    expect(coordinatorBytes).to.be.lessThanOrEqual(24576);
    expect(adjudicatorBytes).to.be.lessThanOrEqual(24576);
    moduleSizes.forEach((size) => expect(size).to.be.lessThanOrEqual(24576));
  });
});
