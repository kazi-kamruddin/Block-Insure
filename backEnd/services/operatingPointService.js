// Validation-only threshold selection for the UNION of mandatory rules and
// advisory scores. Reject-all/flag-all ties never silently exceed a budget.
const summarizeDecisions = (rows, threshold) => {
  let tp = 0, fp = 0, fn = 0, reviewed = 0;
  for (const row of rows) {
    const decision = row.rule || row.score >= threshold;
    reviewed += Number(decision);
    tp += Number(decision && row.actualFraud);
    fp += Number(decision && !row.actualFraud);
    fn += Number(!decision && row.actualFraud);
  }
  return { tp, fp, fn, reviewed, reviewRate: reviewed / Math.max(1, rows.length),
    f1: 2 * tp / Math.max(1, 2 * tp + fp + fn),
    cost: (10 * fn + fp + 0.25 * reviewed) / Math.max(1, rows.length) };
};
const selectOperatingPoint = (rows, { objective = "cost", budget = 0.2 } = {}) => {
  if (!rows.length || !["cost", "f1"].includes(objective) || !Number.isFinite(budget) || budget < 0 || budget > 1) throw new Error("Invalid operating-point configuration");
  if (rows.some((row) => !Number.isFinite(row.score) || row.score < 0 || row.score > 1)) throw new Error("Scores must be finite probabilities");
  const mandatoryRate = rows.filter((row) => row.rule).length / rows.length;
  const effectiveBudget = Math.max(budget, mandatoryRate);
  const thresholds = [1 + Number.EPSILON, ...new Set(rows.map((row) => row.score))];
  const candidates = thresholds.map((threshold) => ({ threshold, ...summarizeDecisions(rows, threshold) }))
    .filter((point) => point.reviewRate <= effectiveBudget + 1e-12);
  candidates.sort((a, b) => (objective === "cost" ? a.cost - b.cost : b.f1 - a.f1) || a.reviewed - b.reviewed || b.threshold - a.threshold);
  return { ...candidates[0], objective, requestedBudget: budget, effectiveBudget, mandatoryRate,
    costWeights: { missedAttack: 10, unmutatedRoute: 1, review: 0.25 },
    selection: "Policy partition only; union with mandatory rules; conservative whole-score ties" };
};
module.exports = { summarizeDecisions, selectOperatingPoint };
