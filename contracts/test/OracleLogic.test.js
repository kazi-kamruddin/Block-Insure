const { expect } = require("chai");
const { ethers } = require("hardhat");
const { mine } = require("@nomicfoundation/hardhat-network-helpers");
const {
  configureOracleFixture,
  buildCommitment,
  commitResult,
  revealResult,
  finalizeExactResult,
} = require("./helpers/oracleCoordinator");

describe("OracleCoordinator - Exact Consensus and Commit-Reveal", function () {
  async function deployFixture(oracleCount = 3) {
    const [admin, claimOfficer, oracle1, oracle2, oracle3, user, attacker] =
      await ethers.getSigners();
    const InsuranceManager = await ethers.getContractFactory("InsuranceManager");
    const insuranceManager = await InsuranceManager.deploy();
    const allOracles = [oracle1, oracle2, oracle3].slice(0, oracleCount);

    await insuranceManager.grantProjectRole(
      await insuranceManager.CLAIM_OFFICER_ROLE(),
      claimOfficer.address
    );
    const coordinator = await configureOracleFixture(
      insuranceManager,
      admin,
      allOracles,
      { threshold: 2, commitBlocks: 8, revealBlocks: 8 }
    );

    const premium = ethers.parseEther("0.01");
    await insuranceManager.createPolicyPackage(
      "Health Basic",
      "HEALTH",
      premium,
      ethers.parseEther("1"),
      365,
      "HOSPITAL_BILL"
    );
    await insuranceManager.connect(user).purchasePolicy(1, { value: premium });
    const policy = await insuranceManager.getPolicy(1);
    await insuranceManager.connect(user).submitClaim(
      1,
      ethers.parseEther("0.2"),
      policy.startDate,
      "HOSPITALIZATION",
      "HOSP-001",
      hashText("invoice-001"),
      hashText("document-001"),
      "ipfs://document-001"
    );

    return {
      insuranceManager,
      coordinator,
      admin,
      claimOfficer,
      oracle1,
      oracle2,
      oracle3,
      allOracles,
      user,
      attacker,
    };
  }

  const hashText = (text) => ethers.keccak256(ethers.toUtf8Bytes(text));
  const salt = (text) => hashText(`salt:${text}`);

  async function requestClaim(fixture, signer = fixture.admin) {
    await fixture.insuranceManager.connect(signer).requestOracleVerification(1);
    return fixture.coordinator.getRequestByClaimId(1);
  }

  it("snapshots the claim, registry, model, quorum, and eligible oracle set", async function () {
    const fixture = await deployFixture();
    const request = await requestClaim(fixture, fixture.claimOfficer);

    expect(request.requestId).to.equal(1);
    expect(request.claimId).to.equal(1);
    expect(request.claimVersion).to.equal(1);
    expect(request.registryVersion).to.equal(1);
    expect(request.registryRoot).to.equal(await fixture.coordinator.currentRegistryRoot());
    expect(request.modelVersion).to.equal(await fixture.insuranceManager.oracleModelVersion());
    expect(request.requiredConfirmations).to.equal(2);
    expect(request.expectedResponses).to.equal(3);
    expect(await fixture.coordinator.eligibleForRequest(1, fixture.oracle1.address)).to.equal(true);
    expect(await fixture.coordinator.eligibleForRequest(1, fixture.attacker.address)).to.equal(false);
  });

  it("finalizes only when two oracles reveal the exact same verdict and result hash", async function () {
    const fixture = await deployFixture(2);
    const request = await requestClaim(fixture);
    const resultHash = hashText("canonical-result");

    await commitResult(fixture.coordinator, fixture.oracle1, request, true, resultHash, salt("1"));
    await commitResult(fixture.coordinator, fixture.oracle2, request, true, resultHash, salt("2"));
    await revealResult(fixture.coordinator, fixture.oracle1, request, true, resultHash, salt("1"));
    await expect(
      revealResult(fixture.coordinator, fixture.oracle2, request, true, resultHash, salt("2"))
    )
      .to.emit(fixture.coordinator, "OracleRequestFinalized")
      .withArgs(1, 1, true, resultHash, 1);

    expect((await fixture.insuranceManager.getClaim(1)).status).to.equal(11); // FUNDING_REQUIRED
    expect((await fixture.coordinator.getRequest(1)).resultHash).to.equal(resultHash);
  });

  it("does not confuse matching booleans with matching results", async function () {
    const fixture = await deployFixture(2);
    const request = await requestClaim(fixture);
    const firstHash = hashText("source-A-result");
    const secondHash = hashText("source-B-result");

    await commitResult(fixture.coordinator, fixture.oracle1, request, true, firstHash, salt("1"));
    await commitResult(fixture.coordinator, fixture.oracle2, request, true, secondHash, salt("2"));
    await revealResult(fixture.coordinator, fixture.oracle1, request, true, firstHash, salt("1"));
    await expect(
      revealResult(fixture.coordinator, fixture.oracle2, request, true, secondHash, salt("2"))
    )
      .to.emit(fixture.coordinator, "OracleRequestFinalized")
      .withArgs(1, 1, false, ethers.ZeroHash, 2);

    expect((await fixture.insuranceManager.getClaim(1)).status).to.equal(5);
  });

  it("fails conservatively when all revealed results conflict", async function () {
    const fixture = await deployFixture(3);
    const request = await requestClaim(fixture);
    const results = [hashText("A"), hashText("B"), hashText("C")];
    const verdicts = [true, false, true];

    for (let index = 0; index < 3; index += 1) {
      await commitResult(
        fixture.coordinator,
        fixture.allOracles[index],
        request,
        verdicts[index],
        results[index],
        salt(`${index}`)
      );
    }
    for (let index = 0; index < 3; index += 1) {
      await revealResult(
        fixture.coordinator,
        fixture.allOracles[index],
        request,
        verdicts[index],
        results[index],
        salt(`${index}`)
      );
    }

    const finalRequest = await fixture.coordinator.getRequest(1);
    expect(finalRequest.finalizationCode).to.equal(2);
    expect(finalRequest.verifiedResult).to.equal(false);
  });

  it("rejects a reveal without a commitment and a reveal with the wrong salt", async function () {
    const fixture = await deployFixture(2);
    const request = await requestClaim(fixture);
    const resultHash = hashText("canonical-result");

    await expect(
      revealResult(fixture.coordinator, fixture.attacker, request, true, resultHash, salt("x"))
    ).to.be.reverted;

    await commitResult(fixture.coordinator, fixture.oracle1, request, true, resultHash, salt("right"));
    await commitResult(fixture.coordinator, fixture.oracle2, request, true, resultHash, salt("second"));
    await expect(
      revealResult(fixture.coordinator, fixture.oracle1, request, true, resultHash, salt("wrong"))
    ).to.be.reverted;
  });

  it("binds commitments to claim, registry, and model versions", async function () {
    const fixture = await deployFixture(2);
    const request = await requestClaim(fixture);
    const resultHash = hashText("versioned-result");
    const commitment = buildCommitment(request, true, resultHash, salt("1"));

    await fixture.coordinator.connect(fixture.oracle1).commitOracleResult(1, commitment);
    await commitResult(fixture.coordinator, fixture.oracle2, request, true, resultHash, salt("2"));

    await expect(
      fixture.coordinator.connect(fixture.oracle1).revealOracleResult(
        1,
        true,
        resultHash,
        request.claimVersion,
        request.registryVersion + 1n,
        request.modelVersion,
        salt("1")
      )
    ).to.be.reverted;
  });

  it("keeps an in-flight request pinned when registry and model versions advance", async function () {
    const fixture = await deployFixture(2);
    const request = await requestClaim(fixture);
    const nextRoot = hashText("registry-v2");
    const nextSchema = hashText("schema-v2");
    const nextModel = hashText("model-v2");

    await fixture.coordinator.publishRegistrySnapshot(nextRoot, 30, nextSchema);
    await fixture.insuranceManager.updateOracleModelVersion(nextModel);

    const unchanged = await fixture.coordinator.getRequest(1);
    expect(unchanged.registryVersion).to.equal(request.registryVersion);
    expect(unchanged.registryRoot).to.equal(request.registryRoot);
    expect(unchanged.modelVersion).to.equal(request.modelVersion);
  });

  it("preserves eligibility for an in-flight request after oracle revocation", async function () {
    const fixture = await deployFixture(2);
    const request = await requestClaim(fixture);
    const resultHash = hashText("revocation-safe-result");

    await fixture.insuranceManager.revokeProjectRole(
      await fixture.insuranceManager.ORACLE_ROLE(),
      fixture.oracle1.address
    );
    expect(await fixture.coordinator.isActiveOracle(fixture.oracle1.address)).to.equal(false);

    await commitResult(fixture.coordinator, fixture.oracle1, request, true, resultHash, salt("1"));
  });

  it("rejects duplicate commitments and late commits", async function () {
    const fixture = await deployFixture(2);
    const request = await requestClaim(fixture);
    const resultHash = hashText("result");
    const commitment = buildCommitment(request, true, resultHash, salt("1"));

    await fixture.coordinator.connect(fixture.oracle1).commitOracleResult(1, commitment);
    await expect(
      fixture.coordinator.connect(fixture.oracle1).commitOracleResult(1, commitment)
    ).to.be.reverted;

    await mine(9);
    await expect(
      fixture.coordinator.connect(fixture.oracle2).commitOracleResult(1, commitment)
    ).to.be.reverted;
  });

  it("allows anyone to resolve a stalled request only after both windows expire", async function () {
    const fixture = await deployFixture(2);
    const request = await requestClaim(fixture);

    await expect(
      fixture.coordinator.connect(fixture.attacker).resolveTimedOutRequest(1)
    ).to.be.reverted;

    const latest = await ethers.provider.getBlockNumber();
    await mine(Number(request.revealDeadlineBlock) - latest + 1);
    await expect(
      fixture.coordinator.connect(fixture.attacker).resolveTimedOutRequest(1)
    )
      .to.emit(fixture.coordinator, "OracleRequestFinalized")
      .withArgs(1, 1, false, ethers.ZeroHash, 3);
    expect((await fixture.insuranceManager.getClaim(1)).status).to.equal(5);
  });

  it("blocks processing while paused and resumes safely after unpause", async function () {
    const fixture = await deployFixture(2);
    const request = await requestClaim(fixture);
    const resultHash = hashText("paused-result");
    const commitment = buildCommitment(request, true, resultHash, salt("1"));

    await fixture.insuranceManager.pause();
    await expect(
      fixture.coordinator.connect(fixture.oracle1).commitOracleResult(1, commitment)
    ).to.be.reverted;
    await fixture.insuranceManager.unpause();
    await fixture.coordinator.connect(fixture.oracle1).commitOracleResult(1, commitment);
  });

  it("rejects requests until a registry is committed and enough oracles exist", async function () {
    const [admin, oracle1, user] = await ethers.getSigners();
    const InsuranceManager = await ethers.getContractFactory("InsuranceManager");
    const manager = await InsuranceManager.deploy();
    const premium = ethers.parseEther("0.01");
    await manager.createPolicyPackage("P", "H", premium, ethers.parseEther("1"), 365, "D");
    await manager.connect(user).purchasePolicy(1, { value: premium });
    const policy = await manager.getPolicy(1);
    await manager.connect(user).submitClaim(
      1, ethers.parseEther("0.1"), policy.startDate, "T", "H", hashText("i"), hashText("d"), "cid"
    );
    await manager.grantProjectRole(await manager.ORACLE_ROLE(), oracle1.address);

    await expect(manager.requestOracleVerification(1)).to.be.reverted;

    const coordinator = await ethers.getContractAt("OracleCoordinator", await manager.oracleCoordinator());
    await coordinator.publishRegistrySnapshot(hashText("root"), 1, hashText("schema"));
    await expect(manager.requestOracleVerification(1)).to.be.reverted;
  });

  it("prevents callers from bypassing the coordinator or forging manager callbacks", async function () {
    const fixture = await deployFixture(2);
    const request = await requestClaim(fixture);

    await expect(
      fixture.coordinator
        .connect(fixture.attacker)
        .setOracle(fixture.attacker.address, true)
    ).to.be.reverted;
    await expect(
      fixture.coordinator.connect(fixture.attacker).createRequest(
        1,
        hashText("forged-query"),
        1,
        request.modelVersion
      )
    ).to.be.reverted;
    await expect(
      fixture.insuranceManager.connect(fixture.attacker).finalizeOracleResult(
        request.requestId,
        request.claimId,
        true,
        hashText("forged-result"),
        1
      )
    ).to.be.reverted;
  });

  it("provides a helper-compatible exact finalization path for downstream tests", async function () {
    const fixture = await deployFixture(2);
    await requestClaim(fixture);
    const resultHash = hashText("helper-result");
    await finalizeExactResult(
      fixture.coordinator,
      1,
      [fixture.oracle1, fixture.oracle2],
      true,
      resultHash
    );
    expect((await fixture.insuranceManager.getClaim(1)).status).to.equal(11); // FUNDING_REQUIRED
  });
});
