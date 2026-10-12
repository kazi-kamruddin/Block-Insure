import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import {
  getRealisticPolicyScenarios,
  simulateHistoricalPolicyEligibility,
} from "../services/api";
import PolicyEligibilityResult from "./PolicyEligibilityResult";

function toDateInput(unixSeconds) {
  return new Date(Number(unixSeconds) * 1000).toISOString().slice(0, 10);
}

function addDays(dateValue, days) {
  if (!dateValue) return "";
  const date = new Date(`${dateValue}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return "";
  date.setUTCDate(date.getUTCDate() + Number(days || 0));
  return date.toISOString().slice(0, 10);
}

function todayInput() {
  return new Date().toISOString().slice(0, 10);
}

export default function PolicyEligibilitySimulator({ packages }) {
  const [packageId, setPackageId] = useState("");
  const [scenarioId, setScenarioId] = useState("");
  const [form, setForm] = useState({
    policyStartDate: todayInput(),
    incidentDate: todayInput(),
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
  const activePackage = packages.find(
    (item) => String(item.packageId) === String(activePackageId)
  );
  const policyEndDate = useMemo(
    () => addDays(form.policyStartDate, activePackage?.durationDays || 0),
    [activePackage?.durationDays, form.policyStartDate]
  );

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
      policyStartDate: toDateInput(scenario.simulationInput.policyStartDate),
      incidentDate: toDateInput(scenario.simulationInput.incidentDate),
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
      const result = await simulateHistoricalPolicyEligibility(activePackageId, {
        ...form,
        policyEndDate,
      });
      setEvaluation(result.evaluation);
    } catch (simulationError) {
      setError(
        simulationError.response?.data?.message ||
          simulationError.message ||
          "Could not estimate policy coverage"
      );
    } finally {
      setIsSimulating(false);
    }
  }

  return (
    <section className="card policy-simulator-card">
      <h3>Coverage Date Estimator</h3>
      <p className="muted-text">
        Choose a policy start date and incident date to preview waiting-period and
        coverage rules. This estimate does not alter records or approve a claim.
      </p>
      <form className="form-grid" onSubmit={handleSimulate}>
        <label>
          Policy package
          <select
            value={activePackageId}
            onChange={(event) => setPackageId(event.target.value)}
            required
          >
            {packages.map((policyPackage) => (
              <option key={policyPackage.packageId} value={policyPackage.packageId}>
                {policyPackage.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Policy start date
          <input
            type="date"
            value={form.policyStartDate}
            onChange={(event) => updateForm("policyStartDate", event.target.value)}
            required
          />
        </label>
        <label>
          Incident date
          <input
            type="date"
            value={form.incidentDate}
            onChange={(event) => updateForm("incidentDate", event.target.value)}
            required
          />
        </label>
        <p className="simulator-derived-date">
          Coverage end date: <strong>{policyEndDate}</strong>
        </p>
        <label>
          Claim type
          <select
            value={form.claimType}
            onChange={(event) => updateForm("claimType", event.target.value)}
          >
            <option value="HOSPITALIZATION">Hospitalization</option>
            <option value="SURGERY">Surgery</option>
            <option value="EMERGENCY">Emergency</option>
            <option value="CONSULTATION">Consultation</option>
            <option value="CRITICAL_ILLNESS">Critical illness</option>
            <option value="COSMETIC">Cosmetic treatment</option>
          </select>
        </label>
        <label>
          Claim amount in ETH
          <input
            type="number"
            min="0"
            step="0.001"
            value={form.claimAmountEth}
            onChange={(event) => updateForm("claimAmountEth", event.target.value)}
            required
          />
        </label>

        <details className="research-tools-panel simulator-advanced-options">
          <summary>Demonstration and disclosure options</summary>
          <label>
            Synthetic demonstration case
            <select
              aria-label="Synthetic demonstration case"
              value={scenarioId}
              onChange={(event) => applyScenario(event.target.value)}
            >
              <option value="">No preset</option>
              {scenarios.map((scenario) => (
                <option key={scenario.scenarioId} value={scenario.scenarioId}>
                  {scenario.title}
                </option>
              ))}
            </select>
          </label>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={form.preExistingCondition}
              onChange={(event) =>
                updateForm("preExistingCondition", event.target.checked)
              }
            />
            Scenario involves a pre-existing condition
          </label>
          {form.preExistingCondition ? (
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={form.disclosedAtPurchase}
                onChange={(event) =>
                  updateForm("disclosedAtPurchase", event.target.checked)
                }
              />
              Condition was disclosed at purchase
            </label>
          ) : null}
        </details>

        <button type="submit" disabled={isSimulating || !activePackageId}>
          {isSimulating ? "Estimating..." : "Estimate Coverage"}
        </button>
      </form>
      {error ? <p className="error-text">{error}</p> : null}
      <PolicyEligibilityResult evaluation={evaluation} title="Estimated outcome" />
    </section>
  );
}
