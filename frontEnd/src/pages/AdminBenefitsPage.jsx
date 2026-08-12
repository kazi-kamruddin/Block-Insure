import { useState } from "react";
import { useQuery } from "@tanstack/react-query";

import {
  approveBenefitRequest,
  getAdminPolicyPackages,
  getBenefitRequests,
  publishBenefitTerms,
  rejectBenefitRequest,
  settleBenefitRequest,
} from "../services/api";
import TransactionLink from "../components/TransactionLink";
import { showToast } from "../services/toast";
import "../styles/pages/AdminBenefitsPage.css";

const DEFAULT_TERMS = {
  packageId: "",
  version: "1",
  deathBenefitEnabled: true,
  deathBenefitPercent: "100",
  surrenderEnabled: true,
  surrenderValuePercent: "50",
  minimumSurrenderInstallments: "6",
  maturityEnabled: false,
  maturityBonusPercent: "0",
};

export default function AdminBenefitsPage() {
  const [terms, setTerms] = useState(DEFAULT_TERMS);
  const [actingId, setActingId] = useState("");
  const [error, setError] = useState("");
  const [transactionHash, setTransactionHash] = useState("");

  const { data: requestsData, refetch: refetchRequests } = useQuery({
    queryKey: ["adminBenefitRequests"],
    queryFn: getBenefitRequests,
  });
  const { data: packageData } = useQuery({
    queryKey: ["adminPolicyPackagesForBenefits"],
    queryFn: () => getAdminPolicyPackages({ limit: 100 }),
  });
  const requests = requestsData?.requests || [];
  const packages = packageData?.packages || [];

  function updateTerms(field, value) {
    setTerms((current) => ({ ...current, [field]: value }));
  }

  async function handlePublish(event) {
    event.preventDefault();
    setError("");
    setTransactionHash("");
    setActingId("terms");
    try {
      const result = await publishBenefitTerms(terms.packageId, {
        ...terms,
        version: Number(terms.version),
        deathBenefitPercent: Number(terms.deathBenefitPercent),
        surrenderValuePercent: Number(terms.surrenderValuePercent),
        minimumSurrenderInstallments: Number(terms.minimumSurrenderInstallments),
        maturityBonusPercent: Number(terms.maturityBonusPercent),
      });
      setTransactionHash(result.transactionHash);
      showToast("A new benefit schedule version was published on-chain.");
    } catch (publishError) {
      setError(publishError.response?.data?.message || publishError.message);
    } finally {
      setActingId("");
    }
  }

  async function runRequestAction(request, action) {
    setError("");
    setTransactionHash("");
    setActingId(request.requestId);
    try {
      let result;
      if (action === "approve") {
        result = await approveBenefitRequest(request.requestId);
      } else if (action === "settle") {
        result = await settleBenefitRequest(request.requestId);
      } else {
        const reason = window.prompt("Enter a concise rejection reason:");
        if (!reason?.trim()) return;
        result = await rejectBenefitRequest(request.requestId, reason.trim());
      }
      setTransactionHash(result.transactionHash);
      showToast(`Benefit request ${action} action confirmed.`);
      await refetchRequests();
    } catch (actionError) {
      setError(actionError.response?.data?.message || actionError.message);
    } finally {
      setActingId("");
    }
  }

  return (
    <section className="page-container page-admin-benefits">
      <h2>Policy Benefits Administration</h2>
      <p className="muted-text">
        Publish immutable rule versions and review death, surrender, and maturity
        requests. Publishing requires a version greater than the current on-chain version.
      </p>

      <form className="card form-grid" onSubmit={handlePublish}>
        <h3>Publish Benefit Schedule</h3>
        <label>
          Policy package
          <select value={terms.packageId} onChange={(event) => updateTerms("packageId", event.target.value)} required>
            <option value="">Select package</option>
            {packages.map((policyPackage) => (
              <option key={policyPackage.packageId} value={policyPackage.packageId}>
                {policyPackage.name} (#{policyPackage.packageId})
              </option>
            ))}
          </select>
        </label>
        <label>
          New version
          <input type="number" min="1" value={terms.version} onChange={(event) => updateTerms("version", event.target.value)} required />
        </label>
        <label className="checkbox-label">
          <input type="checkbox" checked={terms.deathBenefitEnabled} onChange={(event) => updateTerms("deathBenefitEnabled", event.target.checked)} />
          Enable death benefit
        </label>
        <label>
          Death benefit (% of coverage)
          <input type="number" min="0" max="100" value={terms.deathBenefitPercent} onChange={(event) => updateTerms("deathBenefitPercent", event.target.value)} required />
        </label>
        <label className="checkbox-label">
          <input type="checkbox" checked={terms.surrenderEnabled} onChange={(event) => updateTerms("surrenderEnabled", event.target.checked)} />
          Enable surrender value
        </label>
        <label>
          Surrender value (% of premiums)
          <input type="number" min="0" max="100" value={terms.surrenderValuePercent} onChange={(event) => updateTerms("surrenderValuePercent", event.target.value)} required />
        </label>
        <label>
          Minimum paid installments
          <input type="number" min="0" value={terms.minimumSurrenderInstallments} onChange={(event) => updateTerms("minimumSurrenderInstallments", event.target.value)} required />
        </label>
        <label className="checkbox-label">
          <input type="checkbox" checked={terms.maturityEnabled} onChange={(event) => updateTerms("maturityEnabled", event.target.checked)} />
          Enable maturity benefit
        </label>
        <label>
          Maturity bonus (% of premiums)
          <input type="number" min="0" max="100" value={terms.maturityBonusPercent} onChange={(event) => updateTerms("maturityBonusPercent", event.target.value)} required />
        </label>
        <button type="submit" disabled={actingId === "terms"}>
          {actingId === "terms" ? "Publishing..." : "Publish New Version"}
        </button>
      </form>

      {error ? <p className="error-text">{error}</p> : null}
      {transactionHash ? <p>Transaction: <TransactionLink txHash={transactionHash} /></p> : null}

      <h3>Benefit Requests</h3>
      <div className="card-row">
        {requests.map((request) => (
          <article className="card" key={request.requestId}>
            <h4>{request.benefitType.label} request #{request.requestId}</h4>
            <p>Policy #{request.policyId}</p>
            <p>Requester: {request.requester}</p>
            <p>Amount: {request.amountEth} ETH</p>
            <p>Status: <strong>{request.status.label}</strong></p>
            <p>Terms version: {request.termsVersion}</p>
            {request.benefitType.label === "DEATH" ? (
              <p>Evidence hash: {request.evidenceHash}</p>
            ) : null}
            <div className="action-row">
              {request.status.label === "REQUESTED" ? (
                <>
                  <button type="button" onClick={() => runRequestAction(request, "approve")} disabled={actingId === request.requestId}>Approve</button>
                  <button type="button" onClick={() => runRequestAction(request, "reject")} disabled={actingId === request.requestId}>Reject</button>
                </>
              ) : null}
              {request.status.label === "APPROVED" ? (
                <button type="button" onClick={() => runRequestAction(request, "settle")} disabled={actingId === request.requestId}>Settle Benefit</button>
              ) : null}
            </div>
          </article>
        ))}
      </div>
      {requests.length === 0 ? <p>No benefit requests found.</p> : null}
    </section>
  );
}
