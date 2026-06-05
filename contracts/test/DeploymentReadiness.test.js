const { expect } = require("chai");

describe("InsuranceManager - Deployment Readiness", function () {
  it("keeps deployed bytecode under the EIP-170 contract size limit", async function () {
    const artifact = require("../artifacts/contracts/InsuranceManager.sol/InsuranceManager.json");
    const deployedBytes = (artifact.deployedBytecode.length - 2) / 2;

    expect(deployedBytes).to.be.lessThanOrEqual(24576);
  });
});
