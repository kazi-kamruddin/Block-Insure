const test = require("node:test"), assert = require("node:assert/strict");
const { finalizeReport } = require("../../scripts/runReleaseVerification");

test("passing stages cannot claim release success if source drifted during the last stage", () => {
  const report = { plannedStages: ["synthetic"], results: [{ stage: "synthetic", passed: true }] };
  assert.throws(() => finalizeReport(report, () => { throw new Error("source changed"); }), /source changed/);
  assert.equal(report.localCampaignPassed, false);
  assert.equal(report.sourceUnchangedAfterVerification, false);
  finalizeReport(report, () => {});
  assert.equal(report.localCampaignPassed, true);
  assert.equal(report.sourceUnchangedAfterVerification, true);
  report.results[0].passed = false;
  finalizeReport(report, () => {});
  assert.equal(report.localCampaignPassed, false);
});
