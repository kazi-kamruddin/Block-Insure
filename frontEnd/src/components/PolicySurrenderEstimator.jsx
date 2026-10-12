import { useMemo, useState } from "react";
import { ethers } from "ethers";

function dateInputFromUnix(unixSeconds) {
  const value = Number(unixSeconds || 0);
  return value ? new Date(value * 1000).toISOString().slice(0, 10) : "";
}

function calculateProjection(policy, terms, targetDate) {
  if (!targetDate) return null;

  const target = Math.floor(new Date(`${targetDate}T23:59:59Z`).getTime() / 1000);
  const end = Number(policy.endDate || 0);
  const interval = Number(policy.premiumInterval || 0);
  let nextDue = Number(policy.nextPremiumDueDate || 0);
  let additionalInstallments = 0;

  if (!target || target > end || interval <= 0) return { valid: false };

  for (
    let guard = 0;
    nextDue && nextDue <= target && nextDue <= end && guard < 600;
    guard += 1
  ) {
    additionalInstallments += 1;
    nextDue += interval;
  }

  const currentInstallments = Number(policy.installmentsPaid || 0);
  const projectedInstallments = currentInstallments + additionalInstallments;
  const totalPaidWei = BigInt(
    policy.totalPremiumPaidWei || policy.premiumPaidWei || 0
  );
  const premiumWei = BigInt(policy.premiumAmountWei || 0);
  const projectedPaidWei = totalPaidWei + premiumWei * BigInt(additionalInstallments);
  const estimatedWei =
    (projectedPaidWei * BigInt(terms.surrenderValueBps || 0)) / 10000n;

  return {
    valid: true,
    projectedInstallments,
    projectedPaidEth: ethers.formatEther(projectedPaidWei),
    estimatedEth: ethers.formatEther(estimatedWei),
    eligible:
      terms.surrenderEnabled &&
      projectedInstallments >= Number(terms.minimumSurrenderInstallments || 0),
  };
}

export default function PolicySurrenderEstimator({ policy, terms }) {
  const [targetDate, setTargetDate] = useState("");
  const projection = useMemo(
    () => calculateProjection(policy, terms, targetDate),
    [policy, targetDate, terms]
  );
  const today = new Date().toISOString().slice(0, 10);
  const policyEnd = dateInputFromUnix(policy.endDate);

  return (
    <section className="surrender-estimator">
      <h4>Surrender Value Estimator</h4>
      <p className="muted-text">
        Select a future date to estimate value under the published benefit rules.
        Estimating does not cancel or change this policy.
      </p>
      <label>
        Proposed surrender date
        <input
          type="date"
          min={today}
          max={policyEnd}
          value={targetDate}
          onChange={(event) => setTargetDate(event.target.value)}
        />
      </label>

      {projection && !projection.valid ? (
        <p className="error-text">Choose a date on or before the policy end date.</p>
      ) : null}
      {projection?.valid ? (
        <div className="surrender-estimate-result" aria-live="polite">
          <div><span>Projected installments</span><strong>{projection.projectedInstallments}</strong></div>
          <div><span>Projected premiums</span><strong>{projection.projectedPaidEth} ETH</strong></div>
          <div><span>Estimated surrender value</span><strong>{projection.estimatedEth} ETH</strong></div>
          <div><span>Eligibility</span><strong>{projection.eligible ? "Estimated eligible" : "Minimum installments not met"}</strong></div>
        </div>
      ) : null}
      <small>
        Uses schedule v{terms.version}, a {terms.surrenderValuePercent}% surrender
        rate, and a minimum of {terms.minimumSurrenderInstallments} installments.
      </small>
    </section>
  );
}
