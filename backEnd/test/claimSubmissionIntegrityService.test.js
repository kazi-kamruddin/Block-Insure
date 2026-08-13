const test = require("node:test");
const assert = require("node:assert/strict");

const {
  claimMatchesSubmittedFacts,
} = require("../services/claimSubmissionIntegrityService");
const ClaimSubmissionAttempt = require("../models/ClaimSubmissionAttempt");

const claim = {
  incidentDate: 1_800_000_000n,
  claimAmount: 200_000_000_000_000_000n,
  claimType: "SURGERY",
};

const facts = {
  incidentDate: "1800000000",
  claimAmountWei: "200000000000000000",
  claimType: "surgery",
};

test("accepts a confirmed claim only when every authorized material fact matches", () => {
  assert.equal(claimMatchesSubmittedFacts(claim, facts), true);
  assert.equal(
    claimMatchesSubmittedFacts(claim, { ...facts, claimAmountWei: "1" }),
    false
  );
  assert.equal(
    claimMatchesSubmittedFacts(claim, { ...facts, incidentDate: "1800000001" }),
    false
  );
  assert.equal(
    claimMatchesSubmittedFacts(claim, { ...facts, claimType: "DENTAL" }),
    false
  );
});

test("rejects reconciliation when the authorization has no fact snapshot", () => {
  assert.equal(claimMatchesSubmittedFacts(claim, null), false);
  assert.equal(claimMatchesSubmittedFacts(claim, {}), false);
});

test("allows completed eligibility snapshots to opt out of temporary-attempt expiry", () => {
  const completed = new ClaimSubmissionAttempt({
    walletAddress: "0x0000000000000000000000000000000000000001",
    policyId: "1",
    status: "COMPLETED",
    expiresAt: null,
  });

  assert.equal(completed.validateSync(), undefined);
  assert.equal(completed.expiresAt, null);
});
