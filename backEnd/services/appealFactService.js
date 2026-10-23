const { ethers } = require("ethers");
const assertAppealFactsMatch = (claim, appeal) => {
  if (appeal.proposedClaimAmountEth) {
    try { ethers.parseEther(appeal.proposedClaimAmountEth); } catch {
      const error = new Error("Appeal amount must be a valid ETH decimal");
      error.statusCode = 400;
      throw error;
    }
  }
  if ((appeal.proposedHospitalId && appeal.proposedHospitalId !== claim.hospitalId) ||
      (appeal.proposedClaimType && appeal.proposedClaimType !== claim.claimType) ||
      (appeal.proposedClaimAmountEth && ethers.parseEther(appeal.proposedClaimAmountEth) !== claim.claimAmount) ||
      (appeal.proposedInvoiceNumber && ethers.id(appeal.proposedInvoiceNumber.trim()).toLowerCase() !== claim.invoiceHash.toLowerCase())) {
    const error = new Error("Appeal corrections must first be recorded in the on-chain rejected claim");
    error.statusCode = 409;
    throw error;
  }
};
module.exports = { assertAppealFactsMatch };
