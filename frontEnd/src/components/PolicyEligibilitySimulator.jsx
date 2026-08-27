import { useState } from "react";
import { useQuery } from "@tanstack/react-query";

import {
  getRealisticPolicyScenarios,
  simulateHistoricalPolicyEligibility,
} from "../services/api";
import PolicyEligibilityResult from "./PolicyEligibilityResult";

function toLocalDateTime(unixSeconds) {
  const date = new Date(Number(unixSeconds) * 1000);
  const offset = date.getTimezoneOffset() * 60 * 1000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

export default function PolicyEligibilitySimulator({ packages }) {
  const [packageId, setPackageId] = useState("");
  const [scenarioId, setScenarioId] = useState("");
  const [form, setForm] = useState({
    policyStartDate: "",
    policyEndDate: "",
    incidentDate: "",
    claimType: "HOSPITALIZATION",
    claimAmountEth: "0.10",
    preExistingCondition: false,
    disclosedAtPurchase: false,
  });
  const [evaluation, setEvaluation] = useState(null);
  const [error, setError] = useState("");
  const [isSimulating, setIsSimulating] = useState(false);

  const { data: scenarioData } = useQuery({
    queryKey: ["realisticPolicyScenarios"],
    queryFn: getRealisticPolicyScenarios,
  });
  const scenarios = scenarioData?.scenarios || [];
  const activePackageId = packageId || packages[0]?.packageId || "";

  function updateForm(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
    setEvaluation(null);
  }

  function applyScenario(nextScenarioId) {
    setScenarioId(nextScenarioId);
    const scenario = scenarios.find((item) => item.scenarioId === nextScenarioId);
    if (!scenario) return;

    const matchingPackage = packages.find(
      (item) => item.policyTerms?.ruleSetId === scenario.ruleSetId
    );
    if (matchingPackage) setPackageId(matchingPackage.packageId);

    setForm({
      policyStartDate: toLocalDateTime(scenario.simulationInput.policyStartDate),
      policyEndDate: toLocalDateTime(scenario.simulationInput.policyEndDate),
      incidentDate: toLocalDateTime(scenario.simulationInput.incidentDate),
      claimType: scenario.simulationInput.claimType,
      claimAmountEth: scenario.input.claimAmountEth,
      preExistingCondition: scenario.simulationInput.preExistingCondition,
      disclosedAtPurchase: scenario.simulationInput.disclosedAtPurchase,
    });
    setEvaluation(null);
  }

  async function handleSimulate(event) {
    event.preventDefault();
    setError("");
    setIsSimulating(true);

    try {
      const result = await simulateHistoricalPolicyEligibility(activePackageId, form);
      setEvaluation(result.evaluation);
    } catch (simulationError) {
      setError(
        simulationError.response?.data?.message ||
          simulationError.message ||
          "Could not simulate policy eligibility"
      );
    } finally {
      setIsSimulating(false);
    }
  }

  return (
    <section className="card policy-simulator-card">
      <h3>Historical Policy Scenario Simulator</h3>
      <p className="muted-text">
        Enter an earlier purchase date or load an anonymized synthetic case. This preview
        does not alter blockchain records or approve a real claim.
      </p>
      <form className="form-grid" onSubmit={handleSimulate}>
        <label>
          Synthetic case
          <select value={scenarioId} onChange={(event) => applyScenario(event.target.value)}>
            <option value="">Manual scenario</option>
            {scenarios.map((scenario) => (
              <option key={scenario.scenarioId} value={scenario.scenarioId}>
                {scenario.title}
              </option>
            ))}
          </select>
        </label>
        <label>
          Policy package
          <select value={activePackageId} onChange={(event) => setPackageId(event.target.value)} required>
            {packages.map((policyPackage) => (
              <option key={policyPackage.packageId} value={policyPackage.packageId}>
                {policyPackage.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Historical purchase date
          <input type="datetime-local" value={form.policyStartDate} onChange={(event) => updateForm("policyStartDate", event.target.value)} required />
        </label>
        <label>
          Policy end date
          <input type="datetime-local" value={form.policyEndDate} onChange={(event) => updateForm("policyEndDate", event.target.value)} required />
        </label>
        <label>
          Incident date
          <input type="datetime-local" value={form.incidentDate} onChange={(event) => updateForm("incidentDate", event.target.value)} required />
        </label>
        <label>
          Claim type
          <input value={form.claimType} onChange={(event) => updateForm("claimType", event.target.value)} required />
        </label>
        <label>
          Claim amount in ETH
          <input type="number" min="0" step="0.001" value={form.claimAmountEth} onChange={(event) => updateForm("claimAmountEth", event.target.value)} required />
        </label>
        <label className="checkbox-label">
          <input type="checkbox" checked={form.preExistingCondition} onChange={(event) => updateForm("preExistingCondition", event.target.checked)} />
          Scenario involves a pre-existing condition
        </label>
        {form.preExistingCondition ? (
          <label className="checkbox-label">
            <input type="checkbox" checked={form.disclosedAtPurchase} onChange={(event) => updateForm("disclosedAtPurchase", event.target.checked)} />
            Condition was disclosed at purchase
          </label>
        ) : null}
        <button type="submit" disabled={isSimulating || !activePackageId}>
          {isSimulating ? "Simulating..." : "Evaluate Scenario"}
        </button>
      </form>
      {error ? <p className="error-text">{error}</p> : null}
      <PolicyEligibilityResult evaluation={evaluation} title="Scenario outcome" />
    </section>
  );
}
