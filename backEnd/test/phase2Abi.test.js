const assert = require("node:assert/strict");
const test = require("node:test");

const managerArtifact = require("../abi/InsuranceManager.json");
const adjudicatorArtifact = require("../abi/ClaimAdjudicator.json");

const functionNames = (artifact) =>
  new Set(
    artifact.abi
      .filter((entry) => entry.type === "function")
      .map((entry) => entry.name)
  );

test("manager ABI exposes automatic payout and appeal hooks without admin adjudication", () => {
  const names = functionNames(managerArtifact);
  for (const required of [
    "configureClaimAdjudicator",
    "sendToManualReview",
    "finalizeExpiredManualReview",
    "activateFundedClaim",
    "withdrawSettlement",
    "submitAppeal",
    "submitAppealWithEvidence",
  ]) {
    assert.equal(names.has(required), true, `missing ${required}`);
  }
  for (const forbidden of [
    "approveClaim",
    "rejectClaim",
    "settleClaim",
    "closeClaim",
    "approveHighValueSettlement",
    "recordAuditorOutcome",
  ]) {
    assert.equal(names.has(forbidden), false, `obsolete ${forbidden} remains callable`);
  }
});

test("adjudicator ABI exposes four-auditor snapshots, automatic decisions, and pull payments", () => {
  const names = functionNames(adjudicatorArtifact);
  for (const required of [
    "getReview",
    "getVotes",
    "isAssigned",
    "allocatePayout",
    "fundPayout",
    "withdrawPayout",
    "getDecision",
    "appealRound",
    "auditorReputation",
  ]) {
    assert.equal(names.has(required), true, `missing ${required}`);
  }
});
