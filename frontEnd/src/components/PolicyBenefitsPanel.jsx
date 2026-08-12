import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ethers } from "ethers";

import { downloadPolicyTerms, getPolicyBenefits } from "../services/api";
import {
  cancelPolicy,
  parseTransactionError,
  requestPolicyBenefit,
  setPolicyBeneficiaries,
} from "../services/contractService";
import { showToast } from "../services/toast";
import "../styles/components/PolicyBenefitsPanel.css";

const EMPTY_BENEFICIARY = { account: "", sharePercent: "" };

export default function PolicyBenefitsPanel({ policy, onPolicyChanged }) {
  const [beneficiaries, setBeneficiaries] = useState([
    { ...EMPTY_BENEFICIARY },
    { ...EMPTY_BENEFICIARY },
    { ...EMPTY_BENEFICIARY },
  ]);
  const [isActing, setIsActing] = useState(false);
  const [error, setError] = useState("");

  const { data, error: loadError, refetch } = useQuery({
    queryKey: ["policyBenefits", policy.policyId],
    queryFn: () => getPolicyBenefits(policy.policyId),
    retry: false,
  });

  function updateBeneficiary(index, field, value) {
    setBeneficiaries((current) =>
      current.map((beneficiary, beneficiaryIndex) =>
        beneficiaryIndex === index ? { ...beneficiary, [field]: value } : beneficiary
      )
    );
  }

  async function handleSaveBeneficiaries(event) {
    event.preventDefault();
    setError("");
    const entries = beneficiaries
      .filter((beneficiary) => beneficiary.account.trim() || beneficiary.sharePercent !== "")
      .map((beneficiary) => ({
        account: beneficiary.account.trim(),
        sharePercent: Number(beneficiary.sharePercent),
      }));

    if (entries.length < 1 || entries.length > 3) {
      setError("Enter between one and three beneficiaries.");
      return;
    }
    if (entries.some((beneficiary) => !ethers.isAddress(beneficiary.account))) {
      setError("Every beneficiary must have a valid wallet address.");
      return;
    }
    const shareTotal = entries.reduce(
      (total, beneficiary) => total + beneficiary.sharePercent,
      0
    );
    if (Math.abs(shareTotal - 100) > 0.001) {
      setError("Beneficiary shares must total exactly 100%.");
      return;
    }

    setIsActing(true);
    try {
      const tx = await setPolicyBeneficiaries(policy.policyId, entries);
      await tx.wait();
      showToast("Beneficiaries updated on-chain.", { title: "Policy updated" });
      await refetch();
    } catch (actionError) {
      setError(parseTransactionError(actionError));
    } finally {
      setIsActing(false);
    }
  }

  async function handleBenefitRequest(benefitType, label) {
    setError("");
    setIsActing(true);
    try {
      const tx = await requestPolicyBenefit(
        policy.policyId,
        benefitType,
        ethers.ZeroHash
      );
      await tx.wait();
      showToast(`${label} request submitted for administrator review.`);
      await refetch();
    } catch (actionError) {
      setError(parseTransactionError(actionError));
    } finally {
      setIsActing(false);
    }
  }

  async function handleCancelForSurrender() {
    const confirmed = window.confirm(
      "Cancel this policy permanently? Cancellation ends claim coverage and is required before requesting surrender value."
    );
    if (!confirmed) return;

    setError("");
    setIsActing(true);
    try {
      const tx = await cancelPolicy(policy.policyId);
      await tx.wait();
      showToast("Policy cancelled. Its surrender request can now be submitted.");
      await Promise.all([refetch(), onPolicyChanged?.()]);
    } catch (actionError) {
      setError(parseTransactionError(actionError));
    } finally {
      setIsActing(false);
    }
  }

  if (loadError) {
    return (
      <details className="policy-benefits-panel">
        <summary>Additional benefits</summary>
        <p className="muted-text">
          {loadError.response?.data?.message || "Benefits module is unavailable."}
        </p>
      </details>
    );
  }

  if (!data) return <p className="muted-text">Loading benefit schedule...</p>;

  const { terms, projections, requests } = data;
  const requestByType = Object.fromEntries(
    requests.map((request) => [request.benefitType.label, request])
  );
  const statusLabel = policy.status?.label || "";
  const surrenderInstallmentsMet =
    Number(policy.installmentsPaid || 0) >= terms.minimumSurrenderInstallments;

  return (
    <details className="policy-benefits-panel">
      <summary>Beneficiaries and additional benefits</summary>
      {!terms.configured ? (
        <p>No additional benefit schedule has been published for this package.</p>
      ) : (
        <>
          <p>
            Published schedule v{terms.version} · commitment {terms.termsHash.slice(0, 12)}…
          </p>
          <div className="benefit-projection-grid">
            <div><span>Death</span><strong>{projections.death.eth} ETH</strong></div>
            <div><span>Surrender</span><strong>{projections.surrender.eth} ETH</strong></div>
            <div><span>Maturity</span><strong>{projections.maturity.eth} ETH</strong></div>
          </div>
          <p className="muted-text">
            Projections use the published schedule and current policy values; they are
            payable only after lifecycle checks and administrator approval.
          </p>
        </>
      )}

      <h4>Current beneficiaries</h4>
      {data.beneficiaries.length ? (
        <ul>
          {data.beneficiaries.map((beneficiary) => (
            <li key={beneficiary.account}>
              {beneficiary.account} — {beneficiary.sharePercent}%
            </li>
          ))}
        </ul>
      ) : (
        <p>No beneficiaries registered.</p>
      )}

      <form className="beneficiary-form" onSubmit={handleSaveBeneficiaries}>
        {beneficiaries.map((beneficiary, index) => (
          <div className="beneficiary-row" key={index}>
            <input
              aria-label={`Beneficiary ${index + 1} wallet`}
              placeholder={`Beneficiary ${index + 1} wallet`}
              value={beneficiary.account}
              onChange={(event) => updateBeneficiary(index, "account", event.target.value)}
            />
            <input
              aria-label={`Beneficiary ${index + 1} share`}
              type="number"
              min="0"
              max="100"
              step="0.01"
              placeholder="Share %"
              value={beneficiary.sharePercent}
              onChange={(event) =>
                updateBeneficiary(index, "sharePercent", event.target.value)
              }
            />
          </div>
        ))}
        <button type="submit" disabled={isActing}>Replace Beneficiaries</button>
      </form>

      <div className="action-row">
        <button type="button" onClick={() => downloadPolicyTerms(policy.policyId)}>
          Download Policy Terms
        </button>
        {terms.surrenderEnabled && !requestByType.SURRENDER &&
        surrenderInstallmentsMet &&
        ["ACTIVE", "GRACE_PERIOD", "LAPSED"].includes(statusLabel) ? (
          <button type="button" onClick={handleCancelForSurrender} disabled={isActing}>
            Cancel for Surrender
          </button>
        ) : null}
        {terms.surrenderEnabled && !requestByType.SURRENDER && statusLabel === "CANCELLED" ? (
          <button
            type="button"
            onClick={() => handleBenefitRequest(1, "Surrender")}
            disabled={isActing}
          >
            Request Surrender
          </button>
        ) : null}
        {terms.maturityEnabled && !requestByType.MATURITY && statusLabel === "EXPIRED" ? (
          <button
            type="button"
            onClick={() => handleBenefitRequest(2, "Maturity")}
            disabled={isActing}
          >
            Request Maturity
          </button>
        ) : null}
      </div>

      {terms.surrenderEnabled && !surrenderInstallmentsMet ? (
        <p className="muted-text">
          Surrender becomes available after {terms.minimumSurrenderInstallments}{" "}
          paid installments. This policy currently has {policy.installmentsPaid || 0}.
        </p>
      ) : null}

      {requests.length ? (
        <ul className="benefit-request-list">
          {requests.map((request) => (
            <li key={request.requestId}>
              {request.benefitType.label}: {request.status.label} · {request.amountEth} ETH
            </li>
          ))}
        </ul>
      ) : null}
      {error ? <p className="error-text">{error}</p> : null}
    </details>
  );
}
