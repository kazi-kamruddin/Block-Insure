// Paired provider-cluster bootstrap. Intervals describe this controlled test
// cohort, not naturally adjudicated fraud or independent source replications.
function pairedClusterIntervals(clusters, { repetitions = 500, seed = 73 } = {}) {
  if (!Array.isArray(clusters) || clusters.length < 2 || !Number.isInteger(repetitions) || repetitions < 100) throw new Error("Insufficient clusters or bootstrap repetitions");
  let state = seed >>> 0;
  const random = () => { state = (Math.imul(1664525, state) + 1013904223) >>> 0; return state / 4294967296; };
  const names = Object.keys(clusters[0]);
  const values = Object.fromEntries(names.map((name) => [name, []]));
  const metric = ([tp, fp, fn]) => 2 * tp / Math.max(1, 2 * tp + fp + fn);
  for (let iteration = 0; iteration < repetitions; iteration++) {
    const totals = Object.fromEntries(names.map((name) => [name, [0, 0, 0]]));
    for (let draw = 0; draw < clusters.length; draw++) {
      const cluster = clusters[Math.floor(random() * clusters.length)];
      for (const name of names) cluster[name].forEach((value, index) => { totals[name][index] += value; });
    }
    const reference = metric(totals.rules_only);
    for (const name of names) values[name].push(metric(totals[name]) - reference);
  }
  return { clusters: clusters.length, repetitions, seed, unit: "provider", estimand: "paired F1 difference from rules_only", confidence: 0.95,
    intervals: Object.fromEntries(names.map((name) => { const ordered = values[name].sort((a, b) => a - b); return [name, { lower: ordered[Math.floor(repetitions * 0.025)], upper: ordered[Math.ceil(repetitions * 0.975) - 1] }]; })),
    limitation: "Percentile intervals on one fixed controlled cohort; provider resampling does not remove cross-provider patient dependence or scenario-construction bias. Not corrected for multiple comparisons; not a promotion test." };
}
module.exports = { pairedClusterIntervals };
