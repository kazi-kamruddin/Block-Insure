import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  getMyHospitalClaimRequest,
  getMyHospitalClaimRequests,
  submitHospitalClaimVerification,
} from "../services/api";
import { formatDateTime } from "../utils/dateFormat";
import TransactionLink from "../components/TransactionLink";
import { showToast } from "../services/toast";
import "../styles/pages/HospitalDashboardPage.css";

const checkLabels = {
  invoiceFound: "Invoice exists in hospital data",
  invoiceHashMatches: "Invoice identity matches",
  amountMatches: "Claim amount matches the bill",
  incidentWithinCareDates: "Incident falls within care dates",
  treatmentMatches: "Treatment type matches",
  recordEligible: "Record and invoice are active",
};

export default function HospitalClaimRequestsPage() {
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState("");
  const [note, setNote] = useState("");
  const requestsQuery = useQuery({
    queryKey: ["hospitalClaimRequests"],
    queryFn: getMyHospitalClaimRequests,
    refetchInterval: 3000,
  });
  const detailQuery = useQuery({
    queryKey: ["hospitalClaimRequest", selectedId],
    queryFn: () => getMyHospitalClaimRequest(selectedId),
    enabled: Boolean(selectedId),
  });
  const verifyMutation = useMutation({
    mutationFn: () => submitHospitalClaimVerification(
      selectedId,
      detailQuery.data.proposedVerification.verified,
      detailQuery.data.proposedVerification.attestationHash,
      note
    ),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["hospitalClaimRequests"] });
      queryClient.invalidateQueries({ queryKey: ["hospitalClaimRequest", selectedId] });
      showToast(result.message, { title: "Hospital verification recorded" });
    },
  });
  const requests = requestsQuery.data?.requests || [];
  const detail = detailQuery.data;
  const assessment = detail?.proposedVerification;
  const verification = detail?.verification;
  const error = requestsQuery.error || detailQuery.error || verifyMutation.error;

  return (
    <section className="page-container page-hospital-dashboard">
      <div className="hospital-heading"><div>
        <span className="dashboard-eyebrow">Independent verification</span>
        <h2>Claim Verification Requests</h2>
        <p>Claims are filtered by the hospital ID assigned to this wallet. The insurer cannot create this attestation.</p>
      </div></div>
      {error ? <p className="error-text" role="alert">{error.response?.data?.message || error.message}</p> : null}

      <div className="hospital-verification-layout">
        <section className="card hospital-request-list">
          <h3>Requests</h3>
          {requestsQuery.isLoading ? <p>Loading requests...</p> : null}
          {!requestsQuery.isLoading && !requests.length ? <p>No claims currently reference this hospital.</p> : null}
          {requests.map((request) => (
            <button type="button" className={selectedId === request.claimId ? "is-selected" : ""} key={request.claimId} onClick={() => setSelectedId(request.claimId)}>
              <strong>Claim #{request.claimId}</strong>
              <span>{request.claimAmountEth} ETH · {request.claimType}</span>
              <small>{request.verification?.outcome || "PENDING HOSPITAL"}</small>
            </button>
          ))}
        </section>

        <section className="card hospital-request-detail">
          {!selectedId ? <p>Select a claim request to compare it with hospital data.</p> : null}
          {detailQuery.isLoading ? <p>Comparing claim and hospital record...</p> : null}
          {detail ? <>
            <div className="hospital-request-title"><div><span className="dashboard-eyebrow">Claim #{detail.claim.claimId}</span><h3>{assessment.outcome.replaceAll("_", " ")}</h3></div><strong className={assessment.verified ? "success-text" : "warning-text"}>{assessment.verified ? "MATCH" : "REVIEW REQUIRED"}</strong></div>
            <div className="hospital-claim-facts">
              <div><span>Claimant</span><strong>{detail.claim.claimantWallet}</strong></div>
              <div><span>Claim amount</span><strong>{detail.claim.claimAmountEth} ETH</strong></div>
              <div><span>Incident</span><strong>{formatDateTime(detail.claim.incidentDate)}</strong></div>
              <div><span>Invoice hash</span><strong>{detail.claim.invoiceHash}</strong></div>
            </div>
            <ul className="hospital-check-list">{Object.entries(assessment.checks).map(([key, passed]) => <li className={passed ? "is-passed" : "is-failed"} key={key}><span>{passed ? "✓" : "×"}</span>{checkLabels[key]}</li>)}</ul>
            {detail.matchedRecord ? <p>Matched source invoice: <strong>{detail.matchedRecord.invoiceNumber}</strong> · {detail.matchedRecord.billAmount} ETH</p> : <p className="warning-text">No invoice with this hash exists in this hospital’s records.</p>}
            {verification ? <div className="hospital-attestation-result"><p><strong>On-chain hospital attestation:</strong> {verification.outcome.replaceAll("_", " ")}</p><p><TransactionLink txHash={verification.transactionHash} /></p><small>{verification.attestationHash}</small></div> : <>
              <label>Hospital note<textarea value={note} onChange={(event) => setNote(event.target.value)} maxLength={500} placeholder="Optional internal verification note" /></label>
              <button type="button" onClick={() => verifyMutation.mutate()} disabled={verifyMutation.isPending}>{verifyMutation.isPending ? "Confirming with hospital wallet..." : "Verify against hospital record"}</button>
              <p className="muted-text">This sends a hospital-wallet transaction. Both successful matches and mismatches unblock insurer review while preserving the hospital’s finding.</p>
            </>}
          </> : null}
        </section>
      </div>
    </section>
  );
}
