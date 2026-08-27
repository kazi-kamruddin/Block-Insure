import { useState } from "react";
import { ethers } from "ethers";

import { downloadPolicyTerms, getPolicyBenefits } from "../services/api";
import {
  parseTransactionError,
  requestPolicyBenefit,
  withdrawPolicyBenefit,
} from "../services/contractService";
import { showToast } from "../services/toast";
import "../styles/pages/BenefitClaimPage.css";

export default function BenefitClaimPage() {
  const [policyId, setPolicyId] = useState("");
  const [evidenceReference, setEvidenceReference] = useState("");
  const [snapshot, setSnapshot] = useState(null);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleLookup(event) {
    event.preventDefault();
    setError("");
    setSnapshot(null);
    setIsLoading(true);
    try {
      setSnapshot(await getPolicyBenefits(policyId));
    } catch (lookupError) {
      setError(
        lookupError.response?.data?.message ||
          lookupError.message ||
          "Policy benefits could not be loaded"
      );
    } finally {
      setIsLoading(false);
    }
  }

  async function handleDeathBenefitRequest() {
    if (!evidenceReference.trim()) {
      setError("Enter the death-certificate or evidence reference first.");
      return;
    }
    setError("");
    setIsSubmitting(true);
    try {
      const evidenceHash = ethers.keccak256(
        ethers.toUtf8Bytes(evidenceReference.trim())
      );
      const tx = await requestPolicyBenefit(policyId, 0, evidenceHash);
      await tx.wait();
      showToast("Death-benefit request submitted for administrator review.");
      setSnapshot(await getPolicyBenefits(policyId));
    } catch (requestError) {
      setError(parseTransactionError(requestError));
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleWithdraw() {
    setError("");
    setIsSubmitting(true);
    try {
      const tx = await withdrawPolicyBenefit();
      await tx.wait();
      showToast("Allocated benefit withdrawn successfully.");
      setSnapshot(await getPolicyBenefits(policyId));
    } catch (withdrawError) {
      setError(parseTransactionError(withdrawError));
    } finally {
      setIsSubmitting(false);
    }
  }

  const deathRequest = snapshot?.requests?.find(
    (request) => request.benefitType.label === "DEATH"
  );

  return (
    <section className="page-container page-benefit-claim">
      <h2>Beneficiary Benefit Request</h2>
      <p className="muted-text">
        Registered beneficiaries can inspect a policy's death-benefit schedule and
        submit a hashed evidence reference. Administrators must verify the original
        evidence before approval.
      </p>
      <form className="form-grid card" onSubmit={handleLookup}>
        <label>
          Policy ID
          <input
            type="number"
            min="1"
            value={policyId}
            onChange={(event) => setPolicyId(event.target.value)}
            required
          />
        </label>
        <button type="submit" disabled={isLoading}>
          {isLoading ? "Checking..." : "Check Beneficiary Access"}
        </button>
      </form>

      {snapshot ? (
        <div className="card">
          <h3>{snapshot.policy.packageName}</h3>
          <p>Policy #{snapshot.policy.policyId}</p>
          <p>Projected death benefit: {snapshot.projections.death.eth} ETH</p>
          <p>Accepted terms version: {snapshot.acceptedTermsVersion}</p>
          {BigInt(snapshot.claimable?.wei || "0") > 0n ? (
            <button type="button" onClick={handleWithdraw} disabled={isSubmitting}>
              Withdraw {snapshot.claimable.eth} ETH Benefit
            </button>
          ) : null}
          {deathRequest ? (
            <p>
              Existing request: <strong>{deathRequest.status.label}</strong> ·{" "}
              {deathRequest.amountEth} ETH
            </p>
          ) : (
            <>
              <label>
                Death evidence reference
                <input
                  value={evidenceReference}
                  onChange={(event) => setEvidenceReference(event.target.value)}
                  placeholder="Death certificate reference or secure evidence ID"
                />
              </label>
              <small>
                Only its cryptographic hash is written on-chain. Do not enter private
                medical details here.
              </small>
              <div className="action-row">
                <button
                  type="button"
                  onClick={handleDeathBenefitRequest}
                  disabled={isSubmitting || !snapshot.terms.deathBenefitEnabled}
                >
                  {isSubmitting ? "Submitting..." : "Request Death Benefit"}
                </button>
                <button type="button" onClick={() => downloadPolicyTerms(policyId)}>
                  Download Terms
                </button>
              </div>
            </>
          )}
        </div>
      ) : null}
      {error ? <p className="error-text">{error}</p> : null}
    </section>
  );
}
