const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("InsuranceManager - Phase 8 Oracle Contract Logic", function () {
  async function deployFixture() {
    const [
      admin,
      claimOfficer,
      oracle,
      secondOracle,
      user,
      attacker,
    ] = await ethers.getSigners();

    const InsuranceManager = await ethers.getContractFactory("InsuranceManager");
    const insuranceManager = await InsuranceManager.deploy();

    const CLAIM_OFFICER_ROLE = await insuranceManager.CLAIM_OFFICER_ROLE();
    const ORACLE_ROLE = await insuranceManager.ORACLE_ROLE();

    await insuranceManager.grantProjectRole(CLAIM_OFFICER_ROLE, claimOfficer.address);
    await insuranceManager.grantProjectRole(ORACLE_ROLE, oracle.address);
    await insuranceManager.grantProjectRole(ORACLE_ROLE, secondOracle.address);

    const PREMIUM = ethers.parseEther("0.01");
    const COVERAGE = ethers.parseEther("1");

    await insuranceManager.createPolicyPackage(
      "Health Basic",
      "Health",
      PREMIUM,
      COVERAGE,
      365,
      "Hospital Bill"
    );

    await insuranceManager.connect(user).purchasePolicy(1, { value: PREMIUM });

    const policy = await insuranceManager.getPolicy(1);

    const CLAIM_AMOUNT = ethers.parseEther("0.2");
    const CLAIM_TYPE = "Hospitalization";
    const HOSPITAL_ID = "HOSP-001";
    const INVOICE_HASH = ethers.keccak256(ethers.toUtf8Bytes("oracle-invoice-001"));
    const DOCUMENT_HASH = ethers.keccak256(ethers.toUtf8Bytes("oracle-document-001"));
    const DOCUMENT_CID = "QmOracleDocument001";

    await insuranceManager.connect(user).submitClaim(
      1,
      CLAIM_AMOUNT,
      policy.startDate,
      CLAIM_TYPE,
      HOSPITAL_ID,
      INVOICE_HASH,
      DOCUMENT_HASH,
      DOCUMENT_CID
    );

    return {
      insuranceManager,
      admin,
      claimOfficer,
      oracle,
      secondOracle,
      user,
      attacker,
      PREMIUM,
      COVERAGE,
      policy,
      CLAIM_AMOUNT,
      CLAIM_TYPE,
      HOSPITAL_ID,
      INVOICE_HASH,
      DOCUMENT_HASH,
      DOCUMENT_CID,
    };
  }

  function hashText(text) {
    return ethers.keccak256(ethers.toUtf8Bytes(text));
  }

  it("Admin can request oracle verification for DUPLICATE_CHECKED claim", async function () {
    const { insuranceManager } = await deployFixture();

    await expect(insuranceManager.requestOracleVerification(1))
      .to.emit(insuranceManager, "OracleRequested")
      .withArgs(1, 1, "HOSPITAL");

    const claim = await insuranceManager.getClaim(1);
    expect(claim.status).to.equal(3); // ORACLE_PENDING

    const oracleRequest = await insuranceManager.getOracleRequest(1);

    expect(oracleRequest.requestId).to.equal(1);
    expect(oracleRequest.claimId).to.equal(1);
    expect(oracleRequest.oracleType).to.equal("HOSPITAL");
    expect(oracleRequest.requestBlock).to.be.greaterThan(0);
    expect(oracleRequest.isFulfilled).to.equal(false);
    expect(oracleRequest.verifiedResult).to.equal(false);
  });

  it("Claim officer can request oracle verification", async function () {
    const { insuranceManager, claimOfficer } = await deployFixture();

    await expect(
      insuranceManager.connect(claimOfficer).requestOracleVerification(1)
    )
      .to.emit(insuranceManager, "OracleRequested")
      .withArgs(1, 1, "HOSPITAL");

    const claim = await insuranceManager.getClaim(1);
    expect(claim.status).to.equal(3); // ORACLE_PENDING
  });

  it("Non-admin and non-claim-officer cannot request oracle verification", async function () {
    const { insuranceManager, attacker } = await deployFixture();

    await expect(
      insuranceManager.connect(attacker).requestOracleVerification(1)
    ).to.be.reverted;
  });

  it("Cannot request oracle verification for non-existing claim", async function () {
    const { insuranceManager } = await deployFixture();

    await expect(
      insuranceManager.requestOracleVerification(999)
    ).to.be.reverted;
  });

  it("Cannot request oracle verification twice for the same claim", async function () {
    const { insuranceManager } = await deployFixture();

    await insuranceManager.requestOracleVerification(1);

    await expect(
      insuranceManager.requestOracleVerification(1)
    ).to.be.reverted;
  });

  it("Cannot request oracle verification for FRAUD_FLAGGED claim", async function () {
    const { insuranceManager, user, policy, DOCUMENT_HASH } = await deployFixture();

    await insuranceManager.connect(user).submitClaim(
      1,
      ethers.parseEther("0.2"),
      policy.startDate,
      "Surgery",
      "HOSP-001",
      hashText("oracle-invoice-duplicate-test"),
      DOCUMENT_HASH,
      "QmDuplicateOracleDocument"
    );

    const fraudClaim = await insuranceManager.getClaim(2);
    expect(fraudClaim.status).to.equal(2); // FRAUD_FLAGGED

    await expect(
      insuranceManager.requestOracleVerification(2)
    ).to.be.reverted;
  });

  it("Oracle quorum finalizes a verified oracle result after enough confirmations", async function () {
    const { insuranceManager, oracle, secondOracle } = await deployFixture();

    await insuranceManager.requestOracleVerification(1);

    const resultHash = hashText("verified-oracle-response");

    await expect(
      insuranceManager.connect(oracle).submitOracleResult(
        1,
        true,
        resultHash,
        "LOW",
        "Hospital record matched"
      )
    )
      .to.emit(insuranceManager, "OracleConfirmationReceived")
      .withArgs(1, 1, oracle.address, true, 1);

    let claim = await insuranceManager.getClaim(1);
    expect(claim.status).to.equal(3); // ORACLE_PENDING

    const pendingOracleRequest = await insuranceManager.getOracleRequest(1);
    expect(await insuranceManager.oracleConfirmationCount(1)).to.equal(1);
    expect(await insuranceManager.oracleQuorumThreshold()).to.equal(2);
    expect(pendingOracleRequest.isFulfilled).to.equal(false);

    await expect(
      insuranceManager.connect(secondOracle).submitOracleResult(
        1,
        true,
        hashText("verified-oracle-response-2"),
        "LOW",
        "Second oracle matched hospital record"
      )
    )
      .to.emit(insuranceManager, "OracleConfirmationReceived")
      .withArgs(1, 1, secondOracle.address, true, 2)
      .and.to.emit(insuranceManager, "OracleResultSubmitted")
      .withArgs(1, 1, true, "LOW");

    claim = await insuranceManager.getClaim(1);
    expect(claim.status).to.equal(4); // ORACLE_VERIFIED
    expect(claim.riskScore).to.equal(100); // 90 + 25 capped at 100

    const oracleRequest = await insuranceManager.getOracleRequest(1);

    expect(oracleRequest.isFulfilled).to.equal(true);
    expect(oracleRequest.verifiedResult).to.equal(true);
    expect(oracleRequest.resultHash).to.equal(hashText("verified-oracle-response-2"));
    expect(oracleRequest.riskLevel).to.equal("LOW");
    expect(oracleRequest.remarks).to.equal("Second oracle matched hospital record");
  });

  it("Oracle quorum finalizes a failed oracle result after enough confirmations", async function () {
    const { insuranceManager, oracle, secondOracle } = await deployFixture();

    await insuranceManager.requestOracleVerification(1);

    const resultHash = hashText("failed-oracle-response");

    await expect(
      insuranceManager.connect(oracle).submitOracleResult(
        1,
        false,
        resultHash,
        "HIGH",
        "Invoice mismatch found"
      )
    )
      .to.emit(insuranceManager, "OracleConfirmationReceived")
      .withArgs(1, 1, oracle.address, false, 1);

    let claim = await insuranceManager.getClaim(1);
    expect(claim.status).to.equal(3); // ORACLE_PENDING

    await expect(
      insuranceManager.connect(secondOracle).submitOracleResult(
        1,
        false,
        hashText("failed-oracle-response-2"),
        "HIGH",
        "Second oracle found invoice mismatch"
      )
    )
      .to.emit(insuranceManager, "OracleConfirmationReceived")
      .withArgs(1, 1, secondOracle.address, false, 2)
      .and.to.emit(insuranceManager, "OracleResultSubmitted")
      .withArgs(1, 1, false, "HIGH");

    claim = await insuranceManager.getClaim(1);
    expect(claim.status).to.equal(5); // ORACLE_FAILED
    expect(claim.riskScore).to.equal(90);

    const oracleRequest = await insuranceManager.getOracleRequest(1);

    expect(oracleRequest.isFulfilled).to.equal(true);
    expect(oracleRequest.verifiedResult).to.equal(false);
    expect(oracleRequest.resultHash).to.equal(hashText("failed-oracle-response-2"));
    expect(oracleRequest.riskLevel).to.equal("HIGH");
    expect(oracleRequest.remarks).to.equal("Second oracle found invoice mismatch");
  });

  it("Non-oracle cannot submit oracle result", async function () {
    const { insuranceManager, attacker } = await deployFixture();

    await insuranceManager.requestOracleVerification(1);

    await expect(
      insuranceManager.connect(attacker).submitOracleResult(
        1,
        true,
        hashText("attacker-result"),
        "LOW",
        "Fake result"
      )
    ).to.be.reverted;
  });

  it("Same oracle cannot confirm the same request twice", async function () {
    const { insuranceManager, oracle } = await deployFixture();

    await insuranceManager.requestOracleVerification(1);

    await insuranceManager.connect(oracle).submitOracleResult(
      1,
      true,
      hashText("first-result"),
      "LOW",
      "Hospital record matched"
    );

    await expect(
      insuranceManager.connect(oracle).submitOracleResult(
        1,
        true,
        hashText("second-result"),
        "LOW",
        "Second submission"
      )
    ).to.be.reverted;
  });

  it("Admin can update oracle quorum threshold", async function () {
    const { insuranceManager, attacker } = await deployFixture();

    await insuranceManager.updateQuorumThreshold(1);

    expect(await insuranceManager.oracleQuorumThreshold()).to.equal(1);

    await expect(
      insuranceManager.updateQuorumThreshold(0)
    ).to.be.reverted;

    await expect(
      insuranceManager.connect(attacker).updateQuorumThreshold(2)
    ).to.be.reverted;
  });

  it("Admin can resolve an oracle request after its block timeout", async function () {
    const { insuranceManager, attacker, oracle } = await deployFixture();

    await expect(insuranceManager.updateOracleTimeoutBlocks(2))
      .to.emit(insuranceManager, "OracleTimeoutBlocksUpdated");
    expect(await insuranceManager.oracleTimeoutBlocks()).to.equal(2);

    await expect(
      insuranceManager.updateOracleTimeoutBlocks(0)
    ).to.be.reverted;

    await expect(
      insuranceManager.connect(attacker).updateOracleTimeoutBlocks(2)
    ).to.be.reverted;

    await insuranceManager.requestOracleVerification(1);

    await expect(
      insuranceManager.resolveTimedOutOracle(1)
    ).to.be.reverted;

    await ethers.provider.send("hardhat_mine", ["0x3"]);

    await expect(insuranceManager.resolveTimedOutOracle(1))
      .to.emit(insuranceManager, "OracleTimedOut");

    const claim = await insuranceManager.getClaim(1);
    const request = await insuranceManager.getOracleRequest(1);

    expect(claim.status).to.equal(5); // ORACLE_FAILED
    expect(request.isFulfilled).to.equal(true);
    expect(request.verifiedResult).to.equal(false);
    expect(request.riskLevel).to.equal("ORACLE_FAILED");

    await expect(
      insuranceManager.connect(oracle).submitOracleResult(
        1,
        true,
        hashText("late-result"),
        "LOW",
        "Late result"
      )
    ).to.be.reverted;

    await expect(
      insuranceManager.connect(attacker).resolveTimedOutOracle(1)
    ).to.be.reverted;
  });

  it("rejects oracle responses submitted after the configured timeout before resolution", async function () {
    const { insuranceManager, oracle } = await deployFixture();

    await insuranceManager.updateOracleTimeoutBlocks(2);
    await insuranceManager.requestOracleVerification(1);
    await ethers.provider.send("hardhat_mine", ["0x3"]);

    await expect(
      insuranceManager.connect(oracle).submitOracleResult(
        1,
        true,
        hashText("expired-result"),
        "LOW",
        "Response arrived after timeout"
      )
    ).to.be.reverted;
  });

  it("Split oracle confirmations finalize conservatively as failed", async function () {
    const { insuranceManager, oracle, secondOracle } = await deployFixture();

    await insuranceManager.requestOracleVerification(1);

    await insuranceManager.connect(oracle).submitOracleResult(
      1,
      true,
      hashText("split-verified-result"),
      "LOW",
      "First oracle matched record"
    );

    await insuranceManager.connect(secondOracle).submitOracleResult(
      1,
      false,
      hashText("split-failed-result"),
      "HIGH",
      "Second oracle found mismatch"
    );

    const claim = await insuranceManager.getClaim(1);
    const oracleRequest = await insuranceManager.getOracleRequest(1);

    expect(claim.status).to.equal(5); // ORACLE_FAILED
    expect(oracleRequest.isFulfilled).to.equal(true);
    expect(oracleRequest.verifiedResult).to.equal(false);
  });

  it("Rejects invalid oracle result data", async function () {
    const { insuranceManager, oracle } = await deployFixture();

    await insuranceManager.requestOracleVerification(1);

    await expect(
      insuranceManager.connect(oracle).submitOracleResult(
        1,
        true,
        ethers.ZeroHash,
        "LOW",
        "Hospital record matched"
      )
    ).to.be.reverted;

    await expect(
      insuranceManager.connect(oracle).submitOracleResult(
        1,
        true,
        hashText("valid-result"),
        "",
        "Hospital record matched"
      )
    ).to.be.reverted;

    await expect(
      insuranceManager.connect(oracle).submitOracleResult(
        1,
        true,
        hashText("valid-result"),
        "LOW",
        ""
      )
    ).to.be.reverted;
  });

  it("Can get oracle request by claim ID", async function () {
    const { insuranceManager } = await deployFixture();

    await insuranceManager.requestOracleVerification(1);

    const oracleRequest = await insuranceManager.getOracleRequestByClaimId(1);

    expect(oracleRequest.requestId).to.equal(1);
    expect(oracleRequest.claimId).to.equal(1);
    expect(oracleRequest.oracleType).to.equal("HOSPITAL");
  });

  it("Rejects reading non-existing oracle request", async function () {
    const { insuranceManager } = await deployFixture();

    await expect(
      insuranceManager.getOracleRequest(999)
    ).to.be.reverted;

    await expect(
      insuranceManager.getOracleRequestByClaimId(999)
    ).to.be.reverted;

    await expect(
      insuranceManager.getOracleRequestByClaimId(1)
    ).to.be.reverted;
  });
});
