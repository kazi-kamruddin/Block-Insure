const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  buildAppealCommitmentPayload,
  hashAppealCommitment,
} = require("../services/appealCommitmentService");

describe("appeal commitment service", () => {
  it("normalizes every field into a deterministic correction commitment", () => {
    const payload = buildAppealCommitmentPayload({
      claimId: 7,
      appealReason: "  wrong invoice  ",
      reasonCategory: "document_error",
      proposedHospitalId: "hosp-001",
      proposedInvoiceNumber: " INV-7 ",
      proposedClaimType: "hospitalization",
      additionalDocumentHash: "ABCDEF",
    });

    assert.deepEqual(payload, {
      schema: "BLOCK_INSURE_APPEAL_V1",
      claimId: "7",
      appealReason: "wrong invoice",
      appealDescription: "wrong invoice",
      reasonCategory: "DOCUMENT_ERROR",
      additionalDocumentCID: "",
      proposedHospitalId: "HOSP-001",
      proposedInvoiceNumber: "INV-7",
      proposedClaimType: "HOSPITALIZATION",
      additionalDocumentHash: "abcdef",
      proposedClaimAmountEth: "",
    });
    assert.match(hashAppealCommitment(payload), /^0x[a-f\d]{64}$/);
    assert.equal(hashAppealCommitment(payload), hashAppealCommitment({ ...payload }));
  });

  it("changes the commitment when a proposed correction changes", () => {
    const original = buildAppealCommitmentPayload({
      claimId: "1",
      appealReason: "correct it",
      proposedInvoiceNumber: "INV-OLD",
    });
    const tampered = buildAppealCommitmentPayload({
      claimId: "1",
      appealReason: "correct it",
      proposedInvoiceNumber: "INV-NEW",
    });

    assert.notEqual(hashAppealCommitment(tampered), hashAppealCommitment(original));
  });
});
