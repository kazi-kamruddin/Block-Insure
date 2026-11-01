const { ethers } = require("hardhat");

// Protocol-only tests attest synthetic availability directly as the insurer.
// Actual PRE transformations and owner-offline viewing belong to integration/E2E.
async function attestTestAccess(fixture, claimId) {
  const version = await fixture.manager.claimVersion(claimId);
  await fixture.adjudicator.activateReview(claimId, version, ethers.id(`test-evidence:${claimId}:${version}`), ethers.id(`test-grants:${claimId}:${version}`));
}
module.exports = { attestTestAccess };
