const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("InsuranceManager - Phase 5 Claim Submission System", function () {
  async function deployFixture() {
    const [admin, user, otherUser] = await ethers.getSigners();

    const InsuranceManager = await ethers.getContractFactory("InsuranceManager");
    const insuranceManager = await InsuranceManager.deploy();

    const PACKAGE_NAME = "Health Basic";
    const POLICY_TYPE = "Health";
    const PREMIUM = ethers.parseEther("0.01");
    const COVERAGE = ethers.parseEther("1");
    const DURATION_DAYS = 365;
    const REQUIRED_DOCUMENT = "Hospital Bill";

    await insuranceManager.createPolicyPackage(
      PACKAGE_NAME,
      POLICY_TYPE,
      PREMIUM,
      COVERAGE,
      DURATION_DAYS,
      REQUIRED_DOCUMENT
    );

    await insuranceManager.connect(user).purchasePolicy(1, { value: PREMIUM });

    const policy = await insuranceManager.getPolicy(1);

    const CLAIM_AMOUNT = ethers.parseEther("0.2");
    const CLAIM_TYPE = "Hospitalization";
    const HOSPITAL_ID = "HOSP-001";
    const INVOICE_HASH = ethers.keccak256(ethers.toUtf8Bytes("invoice-001"));
    const DOCUMENT_HASH = ethers.keccak256(ethers.toUtf8Bytes("hospital-bill-001.pdf"));
    const DOCUMENT_CID = "QmHospitalBillCID001";

    return {
      insuranceManager,
      admin,
      user,
      otherUser,
      PREMIUM,
      COVERAGE,
      policy,
      CLAIM_AMOUNT,
      CLAIM_TYPE,
      HOSPITAL_ID,
      INVOICE_HASH,
      DOCUMENT_HASH,
      DOCUMENT_CID,
      REQUIRED_DOCUMENT,
    };
  }

  it("User can submit a valid claim against their active policy", async function () {
    const {
      insuranceManager,
      user,
      policy,
      CLAIM_AMOUNT,
      CLAIM_TYPE,
      HOSPITAL_ID,
      INVOICE_HASH,
      DOCUMENT_HASH,
      DOCUMENT_CID,
    } = await deployFixture();

    const incidentDate = policy.startDate;

    await expect(
      insuranceManager.connect(user).submitClaim(
        1,
        CLAIM_AMOUNT,
        incidentDate,
        CLAIM_TYPE,
        HOSPITAL_ID,
        INVOICE_HASH,
        DOCUMENT_HASH,
        DOCUMENT_CID
      )
    )
      .to.emit(insuranceManager, "ClaimSubmitted")
      .withArgs(1, 1, user.address, CLAIM_AMOUNT);

    const claim = await insuranceManager.getClaim(1);

    expect(claim.claimId).to.equal(1);
    expect(claim.policyId).to.equal(1);
    expect(claim.claimantWallet).to.equal(user.address);
    expect(claim.claimAmount).to.equal(CLAIM_AMOUNT);
    expect(claim.incidentDate).to.equal(incidentDate);
    expect(claim.claimType).to.equal(CLAIM_TYPE);
    expect(claim.hospitalId).to.equal(HOSPITAL_ID);
    expect(claim.invoiceHash).to.equal(INVOICE_HASH);
    expect(claim.documentHash).to.equal(DOCUMENT_HASH);
    expect(claim.documentCID).to.equal(DOCUMENT_CID);
    expect(claim.status).to.equal(1); // ClaimStatus.DUPLICATE_CHECKED
    expect(claim.riskScore).to.equal(90);
  });

  it("Stores claim document metadata", async function () {
    const {
      insuranceManager,
      user,
      policy,
      CLAIM_AMOUNT,
      CLAIM_TYPE,
      HOSPITAL_ID,
      INVOICE_HASH,
      DOCUMENT_HASH,
      DOCUMENT_CID,
      REQUIRED_DOCUMENT,
    } = await deployFixture();

    await expect(
      insuranceManager.connect(user).submitClaim(
        1,
        CLAIM_AMOUNT,
        policy.startDate,
        CLAIM_TYPE,
        HOSPITAL_ID,
        INVOICE_HASH,
        DOCUMENT_HASH,
        DOCUMENT_CID
      )
    )
      .to.emit(insuranceManager, "DocumentAdded")
      .withArgs(1, DOCUMENT_HASH, DOCUMENT_CID);

    const documents = await insuranceManager.getClaimDocuments(1);

    expect(documents.length).to.equal(1);
    expect(documents[0].documentHash).to.equal(DOCUMENT_HASH);
    expect(documents[0].documentCID).to.equal(DOCUMENT_CID);
    expect(documents[0].documentType).to.equal(REQUIRED_DOCUMENT);
  });

  it("Stores submitted claim ID under claimant wallet", async function () {
    const {
      insuranceManager,
      user,
      policy,
      CLAIM_AMOUNT,
      CLAIM_TYPE,
      HOSPITAL_ID,
      INVOICE_HASH,
      DOCUMENT_HASH,
      DOCUMENT_CID,
    } = await deployFixture();

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

    const userClaimIds = await insuranceManager.getClaimsByWallet(user.address);

    expect(userClaimIds.map((id) => Number(id))).to.deep.equal([1]);
  });

  it("Rejects claim for non-existing policy", async function () {
    const {
      insuranceManager,
      user,
      CLAIM_AMOUNT,
      CLAIM_TYPE,
      HOSPITAL_ID,
      INVOICE_HASH,
      DOCUMENT_HASH,
      DOCUMENT_CID,
    } = await deployFixture();

    const now = await time.latest();

    await expect(
      insuranceManager.connect(user).submitClaim(
        999,
        CLAIM_AMOUNT,
        now,
        CLAIM_TYPE,
        HOSPITAL_ID,
        INVOICE_HASH,
        DOCUMENT_HASH,
        DOCUMENT_CID
      )
    ).to.be.revertedWith("Policy does not exist");
  });

  it("Rejects claim if caller is not the policy holder", async function () {
    const {
      insuranceManager,
      otherUser,
      policy,
      CLAIM_AMOUNT,
      CLAIM_TYPE,
      HOSPITAL_ID,
      INVOICE_HASH,
      DOCUMENT_HASH,
      DOCUMENT_CID,
    } = await deployFixture();

    await expect(
      insuranceManager.connect(otherUser).submitClaim(
        1,
        CLAIM_AMOUNT,
        policy.startDate,
        CLAIM_TYPE,
        HOSPITAL_ID,
        INVOICE_HASH,
        DOCUMENT_HASH,
        DOCUMENT_CID
      )
    ).to.be.revertedWith("Caller is not policy holder");
  });

  it("Rejects claim if incident date is before policy start date", async function () {
    const {
      insuranceManager,
      user,
      policy,
      CLAIM_AMOUNT,
      CLAIM_TYPE,
      HOSPITAL_ID,
      INVOICE_HASH,
      DOCUMENT_HASH,
      DOCUMENT_CID,
    } = await deployFixture();

    const beforePolicyStart = policy.startDate - 1n;

    await expect(
      insuranceManager.connect(user).submitClaim(
        1,
        CLAIM_AMOUNT,
        beforePolicyStart,
        CLAIM_TYPE,
        HOSPITAL_ID,
        INVOICE_HASH,
        DOCUMENT_HASH,
        DOCUMENT_CID
      )
    ).to.be.revertedWith("Incident date outside policy period");
  });

  it("Rejects claim if incident date is in the future", async function () {
    const {
      insuranceManager,
      user,
      CLAIM_AMOUNT,
      CLAIM_TYPE,
      HOSPITAL_ID,
      INVOICE_HASH,
      DOCUMENT_HASH,
      DOCUMENT_CID,
    } = await deployFixture();

    const futureIncidentDate = BigInt(await time.latest()) + 1000n;

    await expect(
      insuranceManager.connect(user).submitClaim(
        1,
        CLAIM_AMOUNT,
        futureIncidentDate,
        CLAIM_TYPE,
        HOSPITAL_ID,
        INVOICE_HASH,
        DOCUMENT_HASH,
        DOCUMENT_CID
      )
    ).to.be.revertedWith("Incident date cannot be in the future");
  });

  it("Rejects claim amount greater than policy coverage", async function () {
    const {
      insuranceManager,
      user,
      policy,
      CLAIM_TYPE,
      HOSPITAL_ID,
      INVOICE_HASH,
      DOCUMENT_HASH,
      DOCUMENT_CID,
    } = await deployFixture();

    const excessiveClaimAmount = ethers.parseEther("2");

    await expect(
      insuranceManager.connect(user).submitClaim(
        1,
        excessiveClaimAmount,
        policy.startDate,
        CLAIM_TYPE,
        HOSPITAL_ID,
        INVOICE_HASH,
        DOCUMENT_HASH,
        DOCUMENT_CID
      )
    ).to.be.revertedWith("Claim amount exceeds coverage");
  });

  it("Rejects claim with zero claim amount", async function () {
    const {
      insuranceManager,
      user,
      policy,
      CLAIM_TYPE,
      HOSPITAL_ID,
      INVOICE_HASH,
      DOCUMENT_HASH,
      DOCUMENT_CID,
    } = await deployFixture();

    await expect(
      insuranceManager.connect(user).submitClaim(
        1,
        0,
        policy.startDate,
        CLAIM_TYPE,
        HOSPITAL_ID,
        INVOICE_HASH,
        DOCUMENT_HASH,
        DOCUMENT_CID
      )
    ).to.be.revertedWith("Claim amount must be greater than zero");
  });

  it("Rejects claim with missing text fields", async function () {
    const {
      insuranceManager,
      user,
      policy,
      CLAIM_AMOUNT,
      HOSPITAL_ID,
      INVOICE_HASH,
      DOCUMENT_HASH,
      DOCUMENT_CID,
    } = await deployFixture();

    await expect(
      insuranceManager.connect(user).submitClaim(
        1,
        CLAIM_AMOUNT,
        policy.startDate,
        "",
        HOSPITAL_ID,
        INVOICE_HASH,
        DOCUMENT_HASH,
        DOCUMENT_CID
      )
    ).to.be.revertedWith("Claim type required");

    await expect(
      insuranceManager.connect(user).submitClaim(
        1,
        CLAIM_AMOUNT,
        policy.startDate,
        "Hospitalization",
        "",
        INVOICE_HASH,
        DOCUMENT_HASH,
        DOCUMENT_CID
      )
    ).to.be.revertedWith("Hospital ID required");

    await expect(
      insuranceManager.connect(user).submitClaim(
        1,
        CLAIM_AMOUNT,
        policy.startDate,
        "Hospitalization",
        HOSPITAL_ID,
        INVOICE_HASH,
        DOCUMENT_HASH,
        ""
      )
    ).to.be.revertedWith("Document CID required");
  });

  it("Rejects claim with missing hashes", async function () {
    const {
      insuranceManager,
      user,
      policy,
      CLAIM_AMOUNT,
      CLAIM_TYPE,
      HOSPITAL_ID,
      DOCUMENT_CID,
    } = await deployFixture();

    const ZERO_HASH = ethers.ZeroHash;
    const validInvoiceHash = ethers.keccak256(ethers.toUtf8Bytes("invoice-valid"));
    const validDocumentHash = ethers.keccak256(ethers.toUtf8Bytes("document-valid"));

    await expect(
      insuranceManager.connect(user).submitClaim(
        1,
        CLAIM_AMOUNT,
        policy.startDate,
        CLAIM_TYPE,
        HOSPITAL_ID,
        ZERO_HASH,
        validDocumentHash,
        DOCUMENT_CID
      )
    ).to.be.revertedWith("Invoice hash required");

    await expect(
      insuranceManager.connect(user).submitClaim(
        1,
        CLAIM_AMOUNT,
        policy.startDate,
        CLAIM_TYPE,
        HOSPITAL_ID,
        validInvoiceHash,
        ZERO_HASH,
        DOCUMENT_CID
      )
    ).to.be.revertedWith("Document hash required");
  });

  it("Rejects reading non-existing claim or claim documents", async function () {
    const { insuranceManager } = await deployFixture();

    await expect(insuranceManager.getClaim(999))
      .to.be.revertedWith("Claim does not exist");

    await expect(insuranceManager.getClaimDocuments(999))
      .to.be.revertedWith("Claim does not exist");
  });

  it("Claim submission is blocked when contract is paused", async function () {
    const {
      insuranceManager,
      user,
      policy,
      CLAIM_AMOUNT,
      CLAIM_TYPE,
      HOSPITAL_ID,
      INVOICE_HASH,
      DOCUMENT_HASH,
      DOCUMENT_CID,
    } = await deployFixture();

    await insuranceManager.pause();

    await expect(
      insuranceManager.connect(user).submitClaim(
        1,
        CLAIM_AMOUNT,
        policy.startDate,
        CLAIM_TYPE,
        HOSPITAL_ID,
        INVOICE_HASH,
        DOCUMENT_HASH,
        DOCUMENT_CID
      )
    ).to.be.reverted;
  });
});