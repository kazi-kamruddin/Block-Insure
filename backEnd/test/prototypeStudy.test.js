const test = require("node:test");
const assert = require("node:assert/strict");
const { selectOperatingPoint } = require("../services/operatingPointService");
const { compactObservation, historicalContext, createHistoryIndex } = require("../services/historicalContextService");
const { pairedClusterIntervals } = require("../services/clusterUncertaintyService");
test("paired uncertainty is reproducible and does not claim independent datasets", () => {
  const clusters = [{ rules_only: [1, 0, 1], candidate: [2, 0, 0] }, { rules_only: [1, 1, 0], candidate: [1, 1, 0] }];
  assert.deepEqual(pairedClusterIntervals(clusters), pairedClusterIntervals(clusters));
  assert.deepEqual(pairedClusterIntervals(clusters).intervals.rules_only, { lower: 0, upper: 0 });
  assert.throws(() => pairedClusterIntervals([]), /Insufficient/);
});
test("operating points honor score ties and account for mandatory rule routes", () => {
  const rows = Array.from({ length: 10 }, (_, index) => ({ score: 0.5, actualFraud: index === 0, rule: index === 0 }));
  const result = selectOperatingPoint(rows, { budget: 0.2 });
  assert.equal(result.reviewed, 1);
  assert.ok(result.threshold > 1);
  assert.equal(selectOperatingPoint(rows, { budget: 0 }).effectiveBudget, 0.1);
  assert.throws(() => selectOperatingPoint([{ score: NaN }]), /finite/);
});
test("historical similarity excludes current/future/same-day records, not recurring care controls", () => {
  const base = { patientHash: "p", hospitalId: "h", treatmentType: "CARE", diagnosisCode: "D", billAmount: "1", expectedBillMax: "2", admissionDate: "2026-10-15" };
  const earlier = { ...base, admissionDate: "2026-10-14" };
  const observations = [earlier, base, { ...base, admissionDate: "2026-10-16" }].map(compactObservation);
  assert.equal(historicalContext(base, observations).priorSimilarCount, 1);
  assert.equal(historicalContext({ ...base, patientHash: "other" }, observations).priorSimilarCount, 0);
  const index = createHistoryIndex();
  [earlier, base].forEach((record) => index.add(record)); index.seal();
  assert.deepEqual(index.query(base), historicalContext(base, observations));
  assert.deepEqual(index.query(base), index.query({ ...base, fraudLabel: "PROVIDER_COMPROMISE", scenarioInjected: true }));
  assert.throws(() => index.add(base), /sealed/);
});
