const { test, expect } = require("@playwright/test");

test("Oracle fulfillment distinguishes exact quorum, disagreement and timeout", async () => {
  const { describeOracleFinalization } = await import("../../frontEnd/src/utils/oracleFinalization.js");
  // A timeout can be fulfilled with no reveals. Even two incompatible reveals
  // do not establish exact-result quorum. Counts cannot substitute for the code.
  for (const finalizationCode of [2n, 3n, 0n, 99n]) {
    const outcome = describeOracleFinalization({ isFulfilled: true, finalizationCode });
    expect(outcome.quorumReached).toBe(false);
    expect(outcome.message).not.toBe("Oracle quorum reached.");
  }
  expect(describeOracleFinalization({ isFulfilled: true, finalizationCode: 3n }).message).toContain("timed out");
  expect(describeOracleFinalization({ isFulfilled: true, finalizationCode: 2n }).message).toContain("disagreed");
  // Matching negative decisions still form a quorum; they are not approvals.
  expect(describeOracleFinalization({ isFulfilled: true, finalizationCode: 1n, verifiedResult: false }).quorumReached).toBe(true);
  expect(describeOracleFinalization({ isFulfilled: false, finalizationCode: 1n }).quorumReached).toBe(false);
});
