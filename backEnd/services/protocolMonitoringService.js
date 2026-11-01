// Descriptive operational monitoring. No inferred labels, training, threshold
// mutation or claim-state writes. Distinct requests avoid double counting workers.
function summarize(logs) {
  const requests = new Map();
  for (const row of logs) {
    const data = row.responseData, assessment = data?.assessment;
    if (assessment?.model !== "XGBoost" || data?.modelIdentity?.role !== "ORACLE_ROUTING") continue;
    const key = `${row.requestId}:${row.queryData?.claimVersion}`;
    if (!requests.has(key)) requests.set(key, []);
    requests.get(key).push(assessment);
  }
  const cases = [...requests.values()], scored = cases.map((group) => group.find((v) => Number.isFinite(v.score))).filter(Boolean);
  const bins = Array(10).fill(0);
  for (const row of scored) bins[Math.min(9, Math.max(0, Math.floor(row.score * 10)))]++;
  const mean = (rows) => rows.length ? rows.reduce((sum, row) => sum + row.score, 0) / rows.length : null;
  const half = Math.floor(scored.length / 2), recent = scored.slice(0, half), previous = scored.slice(half);
  return { requestsObserved: cases.length, scoredRequests: scored.length,
    reviewedByOracle: cases.filter((group) => group.some((v) => !v.verified)).length,
    inferenceOrContextUnavailable: cases.filter((group) => group.some((v) => v.unavailable)).length,
    missingPriorPatientHistory: scored.filter((v) => !v.assessment?.context?.historyAvailable).length,
    missingPriorProviderHistory: scored.filter((v) => !v.assessment?.context?.providerHistoryAvailable).length,
    oodWarnings: scored.filter((v) => v.assessment?.result?.oodWarning).length,
    ambiguousConformalSets: scored.filter((v) => v.assessment?.result?.predictionSet?.length !== 1).length,
    workerAssessmentDisagreements: cases.filter((group) => new Set(group.map((v) => v.verificationCode)).size > 1).length,
    oneWorkerOnly: cases.filter((group) => group.length < 2).length,
    scoreHistogram: bins, meanScore: mean(scored), recentHalfMeanScore: mean(recent), earlierHalfMeanScore: mean(previous),
    policyVersions: [...new Set(scored.map((v) => v.assessment.result.policyVersion))],
    interpretation: "Observed Oracle routing is not fraud truth or actual Auditor workload. Score-window differences and missing-history/OOD counts are drift indicators, not accuracy estimates or automatic update triggers." };
}
module.exports = { summarize };
