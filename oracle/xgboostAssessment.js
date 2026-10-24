// Deterministic, dependency-free advisory inference. Never creates transactions.
// Exact unrounded trees; explanations use cover-weighted tree-path-dependent
// Shapley values. Small exported trees permit exact coalition enumeration.
const finite = (value) => typeof value === "number" && Number.isFinite(value);
const sigmoid = (value) => 1 / (1 + Math.exp(-value));
const clamp = (value) => Math.max(1e-7, Math.min(1 - 1e-7, value));

function temporalFeatures(lags, artifact) {
  if (!Array.isArray(lags) || lags.some((v) => !finite(v) || v < 1 || v > 90)) throw new Error("Invalid prior-day history");
  const excitation = (1 - Math.exp(-artifact.beta)) * lags.reduce((sum, lag) => sum + Math.exp(-artifact.beta * (lag - 1)), 0);
  const baseline = (lags.length + 30 * artifact.mu) / 120;
  return {
    temporal_hawkes_intensity: Math.log1p((artifact.baselineScale * baseline + artifact.alpha * excitation) / Math.max(baseline, 1e-6)),
    temporal_hawkes_excitation: Math.log1p(excitation / Math.max(baseline, 1e-6)),
    temporal_hawkes_available: Number(artifact.available),
  };
}

function oodDistance(features, group, diagnosis, artifact) {
  const params = artifact.parameters;
  let key = diagnosis && params.groups[`diagnosis:${diagnosis}`] ? `diagnosis:${diagnosis}` : `treatment:${group}`;
  if (!params.groups[key]) key = "pooled";
  const fit = params.groups[key];
  const delta = artifact.features.map((name, i) => {
    if (!finite(features[name])) throw new Error("Missing OOD feature");
    return (Math.fround(features[name]) - params.mean[i]) / params.scale[i] - fit.mean[i];
  });
  const squared = delta.reduce((sum, value, i) => sum + value * fit.precision[i].reduce((s, coefficient, j) => s + coefficient * delta[j], 0), 0);
  return { distance: Math.sqrt(Math.max(0, squared)), groupSource: key.split(":")[0] };
}

function compile(bundle) {
  const { pipeline, trees, policy } = bundle;
  if (pipeline.schemaVersion !== "advanced-candidate-v2" || trees.schema !== "advanced-trees-v1" || trees.baseMargin !== 0 ||
      JSON.stringify(trees.features) !== JSON.stringify(pipeline.features) || pipeline.hawkes.mode !== "provider_normalized_daily" ||
      policy.version !== "xgboost-advisory-v1" || !finite(policy.threshold) || policy.threshold < 0 || policy.threshold > 1.00000000001 ||
      policy.scoreScale !== 1000000000 || !Number.isSafeInteger(policy.thresholdUnits) || policy.thresholdUnits < 0 || policy.thresholdUnits > 1000000001 ||
      policy.authority !== "ADMIN_ADVISORY_ONLY" || !Array.isArray(trees.trees) || !trees.trees.length || trees.trees.length > 100) throw new Error("Unsupported advisory bundle");
  const compiled = trees.trees.map((tree) => {
    const names = new Set();
    function walk(node, depth = 0) {
      if (depth > 3 || !finite(node.cover) || node.cover <= 0) throw new Error("Unsupported explanation tree");
      if (node.leaf !== undefined) {
        if (!finite(node.leaf)) throw new Error("Invalid leaf");
        return;
      }
      if (!pipeline.features.includes(node.split) || !finite(node.split_condition) || node.children?.length !== 2 ||
          !node.children.some((child) => child.nodeid === node.yes) || !node.children.some((child) => child.nodeid === node.no) || node.yes === node.no) throw new Error("Invalid split");
      names.add(node.split); node.children.forEach((child) => walk(child, depth + 1));
    }
    walk(tree);
    return { tree, names: [...names] };
  });

  function score(observation, { explain = true } = {}) {
    if (typeof observation.mandatory !== "boolean" || !observation.features || typeof observation.group !== "string") throw new Error("Explicit observation required");
    const values = { ...observation.features, ...temporalFeatures(observation.providerLags, pipeline.hawkes) };
    const ood = oodDistance(values, observation.group, observation.diagnosis || "", pipeline.ood);
    values.ood_distance = ood.distance;
    const features = Object.fromEntries(pipeline.features.map((name) => {
      if (!finite(values[name]) || !finite(Math.fround(values[name]))) throw new Error("Missing or nonfinite feature");
      return [name, Math.fround(values[name])];
    }));
    let margin = Math.fround(0), base = 0;
    const contributions = Object.fromEntries(pipeline.features.map((name) => [name, 0]));
    for (const { tree, names } of compiled) {
      const branch = (node) => node.children.find((child) => child.nodeid === (features[node.split] < Math.fround(node.split_condition) ? node.yes : node.no));
      let leaf = tree;
      while (leaf.leaf === undefined) leaf = branch(leaf);
      margin = Math.fround(margin + Math.fround(leaf.leaf));
      if (!explain) continue;
      function expectation(node, known) {
        if (node.leaf !== undefined) return Math.fround(node.leaf);
        if (known.has(node.split)) return expectation(branch(node), known);
        const total = node.children.reduce((sum, child) => sum + child.cover, 0);
        return node.children.reduce((sum, child) => sum + child.cover / total * expectation(child, known), 0);
      }
      const n = names.length, expectations = [];
      for (let mask = 0; mask < 2 ** n; mask++) expectations[mask] = expectation(tree, new Set(names.filter((_, i) => mask & (1 << i))));
      base += expectations[0];
      const factorial = (v) => { let result = 1; for (let i = 2; i <= v; i++) result *= i; return result; };
      names.forEach((name, i) => {
        for (let mask = 0; mask < 2 ** n; mask++) {
          if (mask & (1 << i)) continue;
          const count = mask.toString(2).replaceAll("0", "").length;
          contributions[name] += factorial(count) * factorial(n - count - 1) / factorial(n) * (expectations[mask | (1 << i)] - expectations[mask]);
        }
      });
    }
    const raw = clamp(sigmoid(margin));
    const riskScore = sigmoid(pipeline.calibration.slope * Math.log(raw / (1 - raw)) + pipeline.calibration.intercept);
    const quantile = pipeline.conformal.quantile;
    const predictionSet = [riskScore <= quantile["0"] ? "CONTROL" : null, 1 - riskScore <= quantile["1"] ? "SIMULATED_ACTION" : null].filter(Boolean);
    const riskScoreUnits = Math.floor(riskScore * policy.scoreScale + 0.5);
    const modelReview = riskScoreUnits >= policy.thresholdUnits;
    return {
      method: "XGBoost with explainable graph-temporal fusion and uncertainty quantification",
      authority: "ADMIN_ADVISORY_ONLY", riskScore, riskScoreUnits, rawMargin: margin,
      riskMeaning: "Score calibrated on constructed billing actions; not a real-world fraud probability",
      recommendation: observation.mandatory || modelReview ? "REVIEW_RECOMMENDED" : "NO_ADDITIONAL_MODEL_REVIEW",
      reasons: [observation.mandatory ? "INTEGRITY_OR_EXISTING_REVIEW_RULE" : null, modelReview ? "MODEL_THRESHOLD" : null].filter(Boolean),
      uncertainty: { ood: { ...ood, warning: ood.distance > pipeline.ood.threshold }, predictionSet,
        ambiguous: predictionSet.length !== 1, nominalCoverage: 0.9, coverageGuaranteedForRuntime: false,
        triggersReview: false },
      policy: { version: policy.version, threshold: policy.threshold, thresholdUnits: policy.thresholdUnits, scoreScale: policy.scoreScale,
        comparisonBudget: policy.comparisonBudget, runtimeCapacityGuarantee: false },
      ...(explain ? { explanation: { method: "Exact tree-path-dependent Shapley values", scale: "raw_margin", base, contributions,
        additivityError: Math.abs(base + Object.values(contributions).reduce((s, v) => s + v, 0) - margin) } } : {}),
      transactionCreated: false,
    };
  }
  return { score };
}

module.exports = { compile, temporalFeatures, oodDistance };
