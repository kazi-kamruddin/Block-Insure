import { useQuery } from "@tanstack/react-query";
import { getClaimAdvisory } from "../services/api";
import EvidenceField from "./EvidenceField";

const percent = (value) => Number.isFinite(value) ? `${(value * 100).toFixed(2)}%` : "Unavailable";
const label = (value) => String(value || "").replaceAll("_", " ").toLowerCase();

export default function XgboostAdvisoryPanel({ claimId, claimVersion, status }) {
  const { data, error, isLoading, isFetching, refetch } = useQuery({
    queryKey: ["adminXgboostAdvisory", String(claimId), String(claimVersion), status],
    queryFn: () => getClaimAdvisory(claimId), enabled: Boolean(claimId),
    staleTime: 30_000, refetchOnWindowFocus: false, retry: false,
  });
  const result = error ? null : data?.advisory;
  const assessment = result?.assessment;
  const drivers = Object.entries(assessment?.explanation?.contributions || {}).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).slice(0, 8);

  return (
    <section className="card min-w-0 space-y-4" aria-labelledby="xgboost-advisory-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 id="xgboost-advisory-title">XGBoost advisory assessment</h3>
          <p className="muted-text">Primary Admin advisory · Protocol shadow</p>
        </div>
        <button type="button" className="min-h-11" onClick={() => refetch()} disabled={isFetching}>
          {isFetching ? "Assessing…" : "Refresh advisory"}
        </button>
      </div>
      <p>This assessment supports your review. It creates no approval, rejection, manual-review transition or payout. Existing Oracle outcomes remain authoritative.</p>
      {isLoading ? <p role="status">Loading the committed registry assessment…</p> : null}
      {error ? <p role="alert">XGBoost assessment unavailable. Refresh to retry; the existing claim workflow remains available.</p> : null}
      {result?.status === "UNAVAILABLE" ? <p role="status">Assessment unavailable: {label(result.reason)}. No replacement or zero-risk score was supplied.</p> : null}
      {result?.status === "AVAILABLE" ? (
        <>
          <div className="grid min-w-0 gap-3 sm:grid-cols-2">
            <article className="min-w-0 rounded-lg border border-[var(--line)] p-3">
              <h4>XGBoost · Primary advisory</h4>
              <p className="text-2xl font-bold">{percent(assessment.riskScore)}</p>
              <p>{label(assessment.recommendation)}</p>
              <p className="muted-text">{assessment.riskMeaning}</p>
            </article>
            <article className="min-w-0 rounded-lg border border-[var(--line)] p-3">
              <h4>Bernoulli NB · Protocol comparison</h4>
              <p className="text-2xl font-bold">{percent(result.comparison.riskScore)}</p>
              <p>{label(result.comparison.recommendation)}</p>
              <p className="muted-text">Same snapshot, each model’s frozen feature contract. This is separate from recorded Oracle results.</p>
            </article>
          </div>
          <div>
            <h4>Uncertainty and historical context</h4>
            <ul>
              <li>OOD: {assessment.uncertainty.ood.warning ? "Outside the fitted reference range" : "Within the fitted reference range"}; {assessment.uncertainty.ood.groupSource} reference.</li>
              <li>Conformal set: {assessment.uncertainty.predictionSet.length ? assessment.uncertainty.predictionSet.map(label).join(" + ") : "Empty — unsupported observation"}.</li>
              <li>These warnings do not independently trigger review. Nominal 90% coverage is not guaranteed for runtime claims.</li>
              <li>Prior patient/provider context: {result.context.historyAvailable ? "Available" : "No matching prior history in this snapshot"}.</li>
              <li>Provider history: {result.context.providerHistoryAvailable ? "Available" : "Unavailable in the prior window"}.</li>
              <li>Comparison budget: {percent(assessment.policy.comparisonBudget)}; this is a validation target, not a live queue limit.</li>
            </ul>
            <p>Worker shadow agreement: <strong>{label(result.workerShadow?.status || "UNAVAILABLE")}</strong> ({result.workerShadow?.reports || 0} reports).</p>
            <p className="muted-text">Shadow agreement never changes Oracle verification or payout. Matching workers share the registry and model; this is execution agreement, not medical truth.</p>
          </div>
          <details>
            <summary className="min-h-11 cursor-pointer py-3">Why this score? Exact SHAP explanation</summary>
            <p>Contributions add to the raw model margin, not percentage-point fraud probabilities. They explain the model, not medical truth or causation.</p>
            <ul className="space-y-2">
              {drivers.map(([name, contribution]) => <li className="flex flex-wrap justify-between gap-2 break-words" key={name}>
                <span>{label(name)}</span><strong>{contribution >= 0 ? "+" : ""}{contribution.toFixed(4)} margin</strong>
              </li>)}
            </ul>
            <p>Base margin: {assessment.explanation.base.toFixed(4)}. Assessed margin: {assessment.rawMargin.toFixed(4)}.</p>
          </details>
          <details>
            <summary className="min-h-11 cursor-pointer py-3">Assessment provenance and limitations</summary>
            <div className="min-w-0 [overflow-wrap:anywhere]">
              <p>Claim version: {result.claimVersion}. Policy: {assessment.policy.version}. Fixed research seed: {result.provenance.seed}.</p>
              <p>Context cutoff: {result.context.cutoff}. {result.context.semantics}.</p>
              <p>{result.context.unknownHistory}.</p>
              <p>Training uses engineered billing-action labels. Scores are not validated probabilities of natural fraud. The selected configuration is an advisory trade-off, not a demonstrated overall improvement over NB.</p>
              <EvidenceField label="Assessment ID" value={result.assessmentId} />
              <EvidenceField label="Model bundle hash" value={result.binding.bundleHash} />
              <EvidenceField label="Committed registry root" value={result.binding.registryRoot} />
            </div>
          </details>
        </>
      ) : null}
    </section>
  );
}
