const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("InsuranceManager - Phase 6 Fraud and Duplicate Detection", function () {
  async function deployFixture() {
    const [admin, user, otherUser] = await ethers.getSigners();

    const InsuranceManager = await ethers.getContractFactory("InsuranceManager");
    const insuranceManager = await InsuranceManager.deploy();

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
    await insuranceManager.connect(otherUser).purchasePolicy(1, { value: PREMIUM });

    const userPolicy = await insuranceManager.getPolicy(1);
    const otherUserPolicy = await insuranceManager.getPolicy(2);

    return {
      insuranceManager,
      admin,
      user,
      otherUser,
      PREMIUM,
      COVERAGE,
      userPolicy,
      otherUserPolicy,
    };
  }

  function hashText(text) {
    return ethers.keccak256(ethers.toUtf8Bytes(text));
  }

  async function submitBasicClaim({
    insuranceManager,
    signer,
    policyId,
    claimAmount,
    incidentDate,
    claimType,
    hospitalId,
    invoiceHash,
    documentHash,
    documentCID,
  }) {
    return insuranceManager.connect(signer).submitClaim(
      policyId,
      claimAmount,
      incidentDate,
      claimType,
      hospitalId,
      invoiceHash,
      documentHash,
      documentCID
    );
  }

  it("Valid claim becomes DUPLICATE_CHECKED after fraud checks pass", async function () {
    const { insuranceManager, user, userPolicy } = await deployFixture();

    await submitBasicClaim({
      insuranceManager,
      signer: user,
      policyId: 1,
      claimAmount: ethers.parseEther("0.2"),
      incidentDate: userPolicy.startDate,
      claimType: "Hospitalization",
      hospitalId: "HOSP-001",
      invoiceHash: hashText("invoice-valid-001"),
      documentHash: hashText("document-valid-001"),
      documentCID: "QmDocumentValid001",
    });

    const claim = await insuranceManager.getClaim(1);

    expect(claim.status).to.equal(1); // DUPLICATE_CHECKED
    expect(await insuranceManager.getClaimStatus(1)).to.equal(1);
  });

  it("Duplicate document hash flags the second claim as FRAUD_FLAGGED", async function () {
    const { insuranceManager, user, userPolicy } = await deployFixture();

    const duplicateDocumentHash = hashText("same-document");

    await submitBasicClaim({
      insuranceManager,
      signer: user,
      policyId: 1,
      claimAmount: ethers.parseEther("0.2"),
      incidentDate: userPolicy.startDate,
      claimType: "Hospitalization",
      hospitalId: "HOSP-001",
      invoiceHash: hashText("invoice-001"),
      documentHash: duplicateDocumentHash,
      documentCID: "QmDocument001",
    });

    await expect(
      submitBasicClaim({
        insuranceManager,
        signer: user,
        policyId: 1,
        claimAmount: ethers.parseEther("0.2"),
        incidentDate: userPolicy.startDate,
        claimType: "Surgery",
        hospitalId: "HOSP-001",
        invoiceHash: hashText("invoice-002"),
        documentHash: duplicateDocumentHash,
        documentCID: "QmDocumentDuplicate",
      })
    )
      .to.emit(insuranceManager, "ClaimFlagged")
      .withArgs(2, "Duplicate document hash");

    const secondClaim = await insuranceManager.getClaim(2);

    expect(secondClaim.status).to.equal(2); // FRAUD_FLAGGED
    expect(await insuranceManager.getClaimStatus(2)).to.equal(2);
  });

  it("Duplicate invoice hash flags the second claim as FRAUD_FLAGGED", async function () {
    const { insuranceManager, user, userPolicy } = await deployFixture();

    const duplicateInvoiceHash = hashText("same-invoice");

    await submitBasicClaim({
      insuranceManager,
      signer: user,
      policyId: 1,
      claimAmount: ethers.parseEther("0.2"),
      incidentDate: userPolicy.startDate,
      claimType: "Hospitalization",
      hospitalId: "HOSP-001",
      invoiceHash: duplicateInvoiceHash,
      documentHash: hashText("document-001"),
      documentCID: "QmDocument001",
    });

    await expect(
      submitBasicClaim({
        insuranceManager,
        signer: user,
        policyId: 1,
        claimAmount: ethers.parseEther("0.2"),
        incidentDate: userPolicy.startDate,
        claimType: "Surgery",
        hospitalId: "HOSP-001",
        invoiceHash: duplicateInvoiceHash,
        documentHash: hashText("document-002"),
        documentCID: "QmDocument002",
      })
    )
      .to.emit(insuranceManager, "ClaimFlagged")
      .withArgs(2, "Duplicate invoice hash");

    const secondClaim = await insuranceManager.getClaim(2);

    expect(secondClaim.status).to.equal(2); // FRAUD_FLAGGED
    expect(await insuranceManager.getClaimStatus(2)).to.equal(2);
  });

  it("Same user + same incident date + same claim type flags duplicate claim", async function () {
    const { insuranceManager, user, userPolicy } = await deployFixture();

    const sameIncidentDate = userPolicy.startDate;
    const sameClaimType = "Hospitalization";

    await submitBasicClaim({
      insuranceManager,
      signer: user,
      policyId: 1,
      claimAmount: ethers.parseEther("0.2"),
      incidentDate: sameIncidentDate,
      claimType: sameClaimType,
      hospitalId: "HOSP-001",
      invoiceHash: hashText("invoice-001"),
      documentHash: hashText("document-001"),
      documentCID: "QmDocument001",
    });

    await expect(
      submitBasicClaim({
        insuranceManager,
        signer: user,
        policyId: 1,
        claimAmount: ethers.parseEther("0.2"),
        incidentDate: sameIncidentDate,
        claimType: sameClaimType,
        hospitalId: "HOSP-001",
        invoiceHash: hashText("invoice-002"),
        documentHash: hashText("document-002"),
        documentCID: "QmDocument002",
      })
    )
      .to.emit(insuranceManager, "ClaimFlagged")
      .withArgs(2, "Duplicate user date claim type");

    const secondClaim = await insuranceManager.getClaim(2);

    expect(secondClaim.status).to.equal(2); // FRAUD_FLAGGED
    expect(await insuranceManager.getClaimStatus(2)).to.equal(2);
  });

  it("Same claim type from different user is not automatically fraud", async function () {
    const { insuranceManager, user, otherUser, userPolicy, otherUserPolicy } =
      await deployFixture();

    const sameClaimType = "Hospitalization";

    await submitBasicClaim({
      insuranceManager,
      signer: user,
      policyId: 1,
      claimAmount: ethers.parseEther("0.2"),
      incidentDate: userPolicy.startDate,
      claimType: sameClaimType,
      hospitalId: "HOSP-001",
      invoiceHash: hashText("invoice-user-001"),
      documentHash: hashText("document-user-001"),
      documentCID: "QmUserDocument001",
    });

    await submitBasicClaim({
      insuranceManager,
      signer: otherUser,
      policyId: 2,
      claimAmount: ethers.parseEther("0.2"),
      incidentDate: otherUserPolicy.startDate,
      claimType: sameClaimType,
      hospitalId: "HOSP-002",
      invoiceHash: hashText("invoice-other-user-001"),
      documentHash: hashText("document-other-user-001"),
      documentCID: "QmOtherUserDocument001",
    });

    const secondClaim = await insuranceManager.getClaim(2);

    expect(secondClaim.status).to.equal(1); // DUPLICATE_CHECKED
    expect(await insuranceManager.getClaimStatus(2)).to.equal(1);
  });

  it("Fraudulent claim data is not registered as used for new invoice/document hashes", async function () {
    const { insuranceManager, user, userPolicy } = await deployFixture();

    const originalDocumentHash = hashText("original-document");
    const newInvoiceUsedOnlyInFraudClaim = hashText("invoice-inside-fraud-claim");

    await submitBasicClaim({
      insuranceManager,
      signer: user,
      policyId: 1,
      claimAmount: ethers.parseEther("0.2"),
      incidentDate: userPolicy.startDate,
      claimType: "Hospitalization",
      hospitalId: "HOSP-001",
      invoiceHash: hashText("invoice-original"),
      documentHash: originalDocumentHash,
      documentCID: "QmOriginalDocument",
    });

    await submitBasicClaim({
      insuranceManager,
      signer: user,
      policyId: 1,
      claimAmount: ethers.parseEther("0.2"),
      incidentDate: userPolicy.startDate,
      claimType: "Surgery",
      hospitalId: "HOSP-001",
      invoiceHash: newInvoiceUsedOnlyInFraudClaim,
      documentHash: originalDocumentHash,
      documentCID: "QmFraudDocument",
    });

    const fraudClaim = await insuranceManager.getClaim(2);
    expect(fraudClaim.status).to.equal(2); // FRAUD_FLAGGED

    await submitBasicClaim({
      insuranceManager,
      signer: user,
      policyId: 1,
      claimAmount: ethers.parseEther("0.2"),
      incidentDate: userPolicy.startDate,
      claimType: "Accident Treatment",
      hospitalId: "HOSP-001",
      invoiceHash: newInvoiceUsedOnlyInFraudClaim,
      documentHash: hashText("fresh-document-after-fraud"),
      documentCID: "QmFreshDocumentAfterFraud",
    });

    const thirdClaim = await insuranceManager.getClaim(3);

    expect(thirdClaim.status).to.equal(1); // DUPLICATE_CHECKED
    expect(await insuranceManager.getClaimStatus(3)).to.equal(1);
  });

  it("Rejects claim status for non-existing claim", async function () {
    const { insuranceManager } = await deployFixture();

    await expect(insuranceManager.getClaimStatus(999))
      .to.be.reverted;
  });
});
