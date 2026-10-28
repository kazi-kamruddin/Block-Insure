import { useMemo, useState } from "react";
import { formatEther } from "ethers";
import { useQuery } from "@tanstack/react-query";

import ClaimSubmissionRecoveryPanel from "../components/ClaimSubmissionRecoveryPanel";
import { finishClaimAttempt, rememberClaimAttempt } from "../services/claimEvidenceSubmission";
import TransactionLink from "../components/TransactionLink";
import {
  authorizeClaimSubmission,
  attachDocumentToClaim,
  getMyPolicies,
  getClaimSubmissionAttempt,
  getNetworkHospitals,
  previewPurchasedPolicyEligibility,
  previewInvoiceEligibility,
  resetMyClaimSubmissionLimit,
  uploadClaimDocument,
} from "../services/api";

import EvidenceField from "../components/EvidenceField";
import IpfsLink from "../components/IpfsLink";
import PolicyEligibilityResult from "../components/PolicyEligibilityResult";
import PolicyTermsPanel from "../components/PolicyTermsPanel";

import {
  assertCorrectNetwork,
  getConnectedWalletAddress,
  hashInvoiceNumber,
  parseTransactionError,
} from "../services/contractService";
import { useWallet } from "../context/useWallet";
import {
  encryptEvidenceFile,
  storeEvidenceKey,
} from "../services/evidenceEncryption";
import "../styles/pages/SubmitClaimPage.css";
import { showToast } from "../services/toast";
import { formatDateOnly, formatDateTime } from "../utils/dateFormat";

const VALID_MOCK_HOSPITAL_PRESETS = [
  {
    label: "Valid HOSP-001 / HOSPITALIZATION / 0.1 ETH",
    hospitalId: "HOSP-001",
    treatmentType: "HOSPITALIZATION",
    invoiceNumber: "INV-HOSP-001-001",
    claimAmount: "0.1",
  },
  {
    label: "Valid HOSP-002 / SURGERY / 0.2 ETH",
    hospitalId: "HOSP-002",
    treatmentType: "SURGERY",
    invoiceNumber: "INV-HOSP-002-001",
    claimAmount: "0.2",
  },
  {
    label: "Valid HOSP-003 / HOSPITALIZATION / 0.15 ETH",
    hospitalId: "HOSP-003",
    treatmentType: "HOSPITALIZATION",
    invoiceNumber: "INV-HOSP-003-001",
    claimAmount: "0.15",
  },
  {
    label: "Valid HOSP-004 / SURGERY / 0.3 ETH",
    hospitalId: "HOSP-004",
    treatmentType: "SURGERY",
    invoiceNumber: "INV-HOSP-004-001",
    claimAmount: "0.3",
  },
  {
    label: "Valid HOSP-005 / EMERGENCY / 0.25 ETH",
    hospitalId: "HOSP-005",
    treatmentType: "EMERGENCY",
    invoiceNumber: "INV-HOSP-005-001",
    claimAmount: "0.25",
  },
];

function extractPolicies(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.policies)) return data.policies;
  if (Array.isArray(data?.data)) return data.data;
  return [];
}

function getUploadedHash(uploadResponse) {
  return (
    uploadResponse.sha256Hash ||
    uploadResponse.hash ||
    uploadResponse.documentHash ||
    uploadResponse.file?.sha256Hash ||
    uploadResponse.document?.sha256Hash ||
    uploadResponse.data?.sha256Hash ||
    ""
  );
}

function getUploadedCid(uploadResponse) {
  return (
    uploadResponse.ipfsCID ||
    uploadResponse.cid ||
    uploadResponse.documentCID ||
    uploadResponse.file?.ipfsCID ||
    uploadResponse.document?.ipfsCID ||
    uploadResponse.data?.ipfsCID ||
    ""
  );
}

function getUploadedDocumentId(uploadResponse) {
  return (
    uploadResponse.id ||
    uploadResponse.documentId ||
    uploadResponse.file?.id ||
    uploadResponse.document?.id ||
    uploadResponse.data?.id ||
    ""
  );
}

function dateTimeLocalToUnixSeconds(dateTimeValue) {
  return Math.floor(new Date(dateTimeValue).getTime() / 1000);
}

export default function SubmitClaimPage() {
  const { isConnected, walletAddress, connectWallet } = useWallet();

  const [policyId, setPolicyId] = useState("");
  const [claimAmount, setClaimAmount] = useState("0.1");
  const [incidentDateTime, setIncidentDateTime] = useState("");
  const [claimType, setClaimType] = useState("HOSPITALIZATION");
  const [hospitalId, setHospitalId] = useState("HOSP-001");
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [file, setFile] = useState(null);
  const [supportingFiles, setSupportingFiles] = useState([]);
  const [resumeAttempt, setResumeAttempt] = useState(null);
  const [recoveryRevision, setRecoveryRevision] = useState(0);
  const [uploadStep, setUploadStep] = useState("");

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [uploadInfo, setUploadInfo] = useState(null);
  const [pendingEvidenceLink, setPendingEvidenceLink] = useState(null);
  const [evidenceLinkError, setEvidenceLinkError] = useState("");
  const [isLinkingEvidence, setIsLinkingEvidence] = useState(false);
  const [txHash, setTxHash] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [error, setError] = useState("");
  const [submissionLimit, setSubmissionLimit] = useState(null);
  const preExistingCondition = false;
  const disclosedAtPurchase = false;

  const {
    data: policiesData,
    isLoading: policiesLoading,
    error: policiesError,
    refetch: refetchPolicies,
  } = useQuery({
    queryKey: ["myPolicies", walletAddress],
    queryFn: () => getMyPolicies(),
    enabled: isConnected,
  });

  const policies = extractPolicies(policiesData);
  const { data: hospitalNetworkData } = useQuery({
    queryKey: ["contractedHospitalNetwork"],
    queryFn: getNetworkHospitals,
    staleTime: 60_000,
  });
  const networkHospitals = hospitalNetworkData?.hospitals || [];

  const activePolicies = useMemo(
    () => policies.filter((policy) => !["PENDING_PAYMENT", "RENEWED"].includes(policy.status?.label)),
    [policies]
  );

  const selectedPolicy = activePolicies.find(
    (policy) => String(policy.policyId) === String(policyId)
  );

  const invoiceEligibility = useQuery({
    queryKey: ["invoiceEligibility", walletAddress, hospitalId, invoiceNumber.trim()],
    queryFn: () => previewInvoiceEligibility(hospitalId, undefined, invoiceNumber.trim()),
    enabled: false,
    retry: false,
  });

  const { data: eligibilityData, error: eligibilityError } = useQuery({
    queryKey: [
      "policyEligibilityPreview",
      policyId,
      incidentDateTime,
      claimType,
      claimAmount,
      preExistingCondition,
      disclosedAtPurchase,
    ],
    queryFn: () =>
      previewPurchasedPolicyEligibility(policyId, {
        incidentDate: dateTimeLocalToUnixSeconds(incidentDateTime),
        claimType,
        claimAmountEth: claimAmount,
        preExistingCondition,
        disclosedAtPurchase,
      }),
    enabled: Boolean(
      selectedPolicy &&
        incidentDateTime &&
        claimType.trim() &&
        Number(claimAmount) > 0
    ),
    retry: false,
  });

  function handlePolicyChange(nextPolicyId) {
    setPolicyId(nextPolicyId);
    setIncidentDateTime("");
  }

  function applyMockPreset(presetLabel) {
    const preset = VALID_MOCK_HOSPITAL_PRESETS.find(
      (item) => item.label === presetLabel
    );

    if (!preset) return;

    setHospitalId(preset.hospitalId);
    setClaimType(preset.treatmentType);
    setInvoiceNumber(preset.invoiceNumber);
    setClaimAmount(preset.claimAmount);
  }

  async function linkEvidenceToClaim(link) {
    if (!link?.documentId || !link?.claimId) return;

    setEvidenceLinkError("");
    setIsLinkingEvidence(true);

    try {
      await attachDocumentToClaim(link.documentId, link.claimId, link.attemptId);
      setPendingEvidenceLink(null);
      setSuccessMessage(
        `Claim #${link.claimId} submitted and its evidence metadata was linked.`
      );
      showToast(`Claim #${link.claimId} submitted successfully.`, {
        title: "Claim confirmed",
      });
    } catch (linkError) {
      console.error(linkError);
      setEvidenceLinkError(
        `Claim #${link.claimId} is confirmed on-chain, but its off-chain evidence metadata could not be linked. Retry the link when the backend is available.`
      );
    } finally {
      setIsLinkingEvidence(false);
    }
  }

  async function handleSubmit(event) {
    event.preventDefault();

    setError("");
    setSubmissionLimit(null);
    setSuccessMessage("");
    setTxHash("");
    setUploadInfo(null);
    setPendingEvidenceLink(null);
    setEvidenceLinkError("");

    let activeAttemptId = "";
    let submittedTransactionHash = "";

    try {
      if (!isConnected) {
        await connectWallet();
      }

      await assertCorrectNetwork();

      if (!policyId) {
        throw new Error("Select a policy first");
      }

      if (!selectedPolicy) {
        throw new Error("Selected policy was not found");
      }

      if (!file && !resumeAttempt?.documentId) {
        throw new Error("Upload a claim document first");
      }

      if (!invoiceNumber.trim()) {
        throw new Error("Invoice number is required");
      }

      if (!incidentDateTime) {
        throw new Error("Incident date/time is required");
      }

      const activeWallet = await getConnectedWalletAddress();
      const storedWallet =
        walletAddress || localStorage.getItem("blockinsure_wallet") || "";

      if (activeWallet.toLowerCase() !== storedWallet.toLowerCase()) {
        throw new Error(
          "Connected MetaMask account does not match logged-in wallet. Logout and connect again."
        );
      }

      const selectedIncidentSeconds = dateTimeLocalToUnixSeconds(incidentDateTime);

      if (!Number.isFinite(selectedIncidentSeconds)) {
        throw new Error("Incident date/time is invalid");
      }
      const policyStartSeconds = Number(selectedPolicy.startDate || 0);
      const policyEndSeconds = Number(selectedPolicy.endDate || 0);

      const incidentSeconds = selectedIncidentSeconds;

      if (policyStartSeconds && incidentSeconds < policyStartSeconds) {
        throw new Error(
          "Incident date/time is before the policy coverage start time."
        );
      }

      if (policyEndSeconds && incidentSeconds > policyEndSeconds) {
        throw new Error("Incident date/time is after the policy end time.");
      }

      setIsSubmitting(true);

      const invoiceLookup = await previewInvoiceEligibility(hospitalId, undefined, invoiceNumber.trim());
      const invoiceHash = invoiceLookup.invoiceHash || hashInvoiceNumber(invoiceNumber.trim(), hospitalId);
      const selectedFiles = [file, ...supportingFiles];
      if (selectedFiles.length > 5 || selectedFiles.filter(Boolean).some((item) => item.size > 8 * 1024 * 1024 || !["application/pdf", "image/jpeg", "image/png"].includes(item.type)) ||
          selectedFiles.filter(Boolean).reduce((sum, item) => sum + item.size, 0) > 20 * 1024 * 1024) throw new Error("Use one invoice plus up to four supporting PDF/JPEG/PNG files, at most 8 MiB each and 20 MiB total.");
      const authorization = resumeAttempt ? { attemptId: resumeAttempt._id } : await authorizeClaimSubmission(policyId, {
        incidentDate: incidentSeconds,
        claimType,
        claimAmountEth: claimAmount,
        hospitalId,
        invoiceHash,
        invoiceNumber: invoiceNumber.trim(),
        evidenceCount: selectedFiles.length,
        preExistingCondition,
        disclosedAtPurchase,
      });
      const attemptId = authorization?.attemptId || authorization?.data?.attemptId || "";
      activeAttemptId = attemptId;
      rememberClaimAttempt(attemptId);
      const stored = await getClaimSubmissionAttempt(attemptId);
      const existing = stored.files;
      let uploadResponse;
      for (let slot = 0; slot < stored.attempt.expectedEvidenceCount; slot++) {
        setUploadStep(`Preparing encrypted evidence ${slot + 1} of ${stored.attempt.expectedEvidenceCount}`);
        const prior = existing.find((item) => item.uploadSlot === slot);
        if (prior) { if (slot === 0) uploadResponse = { document: { id: prior._id, sha256Hash: prior.sha256Hash, ipfsCID: prior.ipfsCID } }; continue; }
        const selectedFile = selectedFiles[slot];
        if (!selectedFile) throw new Error(`Select the missing evidence file in slot ${slot + 1}. Uploaded files remain preserved.`);
        const type = slot === 0 ? "HOSPITAL_BILL" : "SUPPORTING_DOCUMENT";
        const encryptedEvidence = await encryptEvidenceFile(selectedFile, { claimId: `attempt:${attemptId}`, claimVersion: 1, uploader: activeWallet, evidenceType: type, fileSlot: slot });
        const result = await uploadClaimDocument({ file: encryptedEvidence.encryptedFile, documentType: type, attemptId,
          encryption: { enabled: true, algorithm: encryptedEvidence.algorithm, originalMimeType: encryptedEvidence.originalMimeType,
            originalName: encryptedEvidence.originalName, keyCapsule: encryptedEvidence.keyCapsule, associatedData: encryptedEvidence.associatedData,
            encryptionIdentityVersion: encryptedEvidence.encryptionIdentityVersion } });
        storeEvidenceKey(result.document.ipfsCID, encryptedEvidence);
        if (slot === 0) uploadResponse = result;
      }
      const sha256Hash = getUploadedHash(uploadResponse);
      const ipfsCID = getUploadedCid(uploadResponse);
      const documentId = getUploadedDocumentId(uploadResponse);

      if (!sha256Hash || !ipfsCID || !documentId) {
        throw new Error(
          "Backend upload did not return document metadata needed to submit and link the claim"
        );
      }

      setUploadInfo({
        documentId,
        sha256Hash,
        ipfsCID,
        encryption: {
          enabled: true,
          status: "AES-256-GCM; encrypted before upload.",
          keyStorage:
            "Your dedicated private encryption key remains in this browser; the backend receives only a transformable encrypted key capsule.",
        },
      });

      const result = await finishClaimAttempt(attemptId);
      const claimId = result.attempt?.claimId;
      if (!claimId || result.pending) throw new Error("Submission is still pending. Recover the existing operation below.");
      setTxHash(result.attempt.transactionHash || "");
      setResumeAttempt(null);
      setPendingEvidenceLink(null);
      await refetchPolicies();
      setSuccessMessage(`Claim #${claimId} submitted and its encrypted evidence was reconciled successfully.`);
      showToast(`Claim #${claimId} and its encrypted evidence were confirmed.`, { title: "Claim submitted" });
    } catch (err) {
      console.error(err);

      // Preserve partial uploads and unresolved wallet outcomes for recovery.
      if (activeAttemptId) rememberClaimAttempt(activeAttemptId, submittedTransactionHash);
      const message = parseTransactionError(err);
      if (err.response?.status === 429) {
        setSubmissionLimit(err.response.data || null);
      }
      setError(message);
      showToast(message, { tone: "error", title: "Claim submission failed" });
    } finally {
      setIsSubmitting(false);
      setUploadStep("");
      setRecoveryRevision((value) => value + 1);
    }
  }

  async function handleDevelopmentLimitReset() {
    try {
      const result = await resetMyClaimSubmissionLimit();
      setSubmissionLimit(null);
      setError("");
      showToast(
        `${result.removedAttempts || 0} local submission record(s) cleared.`,
        { title: "Testing limit reset" }
      );
    } catch (resetError) {
      const message = parseTransactionError(resetError);
      showToast(message, { tone: "error", title: "Reset failed" });
    }
  }

  return (
    <section className="page-container page-submit-claim">
      <h2>Submit Claim</h2>

      <button type="button" onClick={() => refetchPolicies()}>
        Refresh Policies
      </button>

      {policiesError ? (
        <p className="error-text">
          {policiesError.message || "Could not load policies"}
        </p>
      ) : null}

      {error ? (
        <div className="form-feedback error-text" role="alert">
          <p>{error}</p>
          {submissionLimit?.resetAt ? (
            <p>
              This testing allowance resets at{" "}
              {new Date(submissionLimit.resetAt).toLocaleString()}.
            </p>
          ) : null}
          {submissionLimit?.devResetAvailable ? (
            <button type="button" onClick={handleDevelopmentLimitReset}>
              Reset My Local Testing Limit
            </button>
          ) : null}
        </div>
      ) : null}
      {successMessage ? <p className="success-text">{successMessage}</p> : null}
      {evidenceLinkError ? <p className="error-text">{evidenceLinkError}</p> : null}

      {txHash ? (
        <p>
          Transaction: <TransactionLink txHash={txHash} />
        </p>
      ) : null}

      {uploadInfo ? (
        <div className="card">
          <h3>Uploaded Document</h3>
          <EvidenceField label="SHA-256" value={uploadInfo.sha256Hash} />
          <p>
            <strong>IPFS CID:</strong> <IpfsLink cid={uploadInfo.ipfsCID} documentId={uploadInfo.documentId} recoverable sha256Hash={uploadInfo.sha256Hash} />
          </p>
          <p>
            <strong>Encryption:</strong> {uploadInfo.encryption.status}
          </p>
          <p className="muted-text">{uploadInfo.encryption.keyStorage}</p>
        </div>
      ) : null}

      {pendingEvidenceLink ? (
        <div className="card">
          <h3>Evidence Link Pending</h3>
          <p>
            Claim #{pendingEvidenceLink.claimId} is already confirmed on-chain.
            The remaining step only links supporting metadata in the backend.
          </p>
          <button
            type="button"
            onClick={() => linkEvidenceToClaim(pendingEvidenceLink)}
            disabled={isLinkingEvidence}
          >
            {isLinkingEvidence ? "Linking Evidence..." : "Retry Evidence Link"}
          </button>
        </div>
      ) : null}

      {policiesLoading ? <p>Loading your policies...</p> : null}

      {!policiesLoading && activePolicies.length === 0 ? (
        <p>No active policies found. Buy a policy first.</p>
      ) : null}

      {selectedPolicy ? (
        <div className="card">
          <h3>Selected Policy Timing</h3>
          <div className="policy-date-summary">
            <div><span>Coverage begins</span><strong>{formatDateOnly(selectedPolicy.startDate)}</strong></div>
            <div><span>Coverage ends</span><strong>{formatDateOnly(selectedPolicy.endDate)}</strong></div>
            <div><span>Selected incident</span><strong>{incidentDateTime ? formatDateTime(incidentDateTime) : "Not selected"}</strong></div>
          </div>
          <PolicyTermsPanel terms={selectedPolicy.policyTerms} />
          {eligibilityError ? (
            <p className="warning-text">
              Eligibility preview is temporarily unavailable; the existing claim
              submission flow is still available.
            </p>
          ) : null}
          <PolicyEligibilityResult evaluation={eligibilityData?.evaluation} />
        </div>
      ) : null}

      <ClaimSubmissionRecoveryPanel revision={recoveryRevision} onCompleted={async (result) => { setSuccessMessage(`Claim #${result.attempt.claimId} submitted and its encrypted evidence was reconciled successfully.`); await refetchPolicies(); }} onResume={(attempt) => {
        setResumeAttempt(attempt); setPolicyId(attempt.policyId); setClaimAmount(formatEther(attempt.submittedFacts.claimAmountWei));
        setClaimType(attempt.submittedFacts.claimType); setHospitalId(attempt.submittedFacts.hospitalId); setInvoiceNumber(attempt.submittedFacts.invoiceNumber);
        const date = new Date(Number(attempt.submittedFacts.incidentDate) * 1000); date.setMinutes(date.getMinutes() - date.getTimezoneOffset()); setIncidentDateTime(date.toISOString().slice(0, 19));
        setFile(null); setSupportingFiles(Array(Math.max(0, attempt.expectedEvidenceCount - 1)).fill(null)); setError("");
      }} />
      {resumeAttempt && <p role="status">Resuming the saved authorization for policy #{resumeAttempt.policyId}. Uploaded slots remain unchanged. Reselect missing files below.</p>}
      {uploadStep && <p role="status">{uploadStep}</p>}
      <form className="form-grid" onSubmit={handleSubmit}>
        <label>
          Policy
          <select
            aria-label="Policy"
            disabled={Boolean(resumeAttempt)}
            value={policyId}
            onChange={(event) => handlePolicyChange(event.target.value)}
            required
          >
            <option value="">Select policy</option>
            {activePolicies.map((policy) => (
              <option key={policy.policyId} value={policy.policyId}>
                {policy.packageName || `Policy #${policy.policyId}`} — Policy #
                {policy.policyId} · Coverage{" "}
                {policy.coverageAmountEth || policy.coverageAmount} ETH
              </option>
            ))}
          </select>
        </label>

        <label>
          Test data preset
          <select
            aria-label="Test data preset"
            disabled={Boolean(resumeAttempt)}
            defaultValue=""
            onChange={(event) => applyMockPreset(event.target.value)}
          >
            <option value="">Manual / random invoice</option>
            {VALID_MOCK_HOSPITAL_PRESETS.map((preset) => (
              <option key={preset.label} value={preset.label}>
                {preset.label}
              </option>
            ))}
          </select>
          <small>
            Presets fill a record that exists in the local healthcare registry.
            Manual values are accepted, but the oracle will fail them when they
            do not match a registered hospital invoice.
          </small>
        </label>

        <label>
          Claim amount in ETH
          <input
            type="number"
            step="0.001"
            min="0"
            value={claimAmount}
            disabled={Boolean(resumeAttempt)} onChange={(event) => setClaimAmount(event.target.value)}
            required
          />
        </label>

        <label>
          Incident date and time
          <input
            aria-label="Incident date/time"
            type="datetime-local"
            step="60"
            value={incidentDateTime}
            disabled={Boolean(resumeAttempt)} onChange={(event) => setIncidentDateTime(event.target.value)}
            required
          />
          <small>
            Enter when the incident actually occurred. This value is never
            replaced with the policy purchase time. Dates are shown in your local
            timezone.
          </small>
        </label>

        <label>
          Claim type
          <input
            type="text"
            value={claimType}
            disabled={Boolean(resumeAttempt)} onChange={(event) => setClaimType(event.target.value)}
            required
          />
        </label>

        <label>
          Hospital ID
          <select
            aria-label="Hospital ID"
            value={hospitalId}
            disabled={Boolean(resumeAttempt)} onChange={(event) => setHospitalId(event.target.value)}
            required
          >
            <option value="">Select a contracted hospital</option>
            {networkHospitals.map((hospital) => (
              <option key={hospital.hospitalId} value={hospital.hospitalId}>
                {hospital.hospitalId} — {hospital.name}
              </option>
            ))}
          </select>
          <small>Only hospitals contracted with the insurer are claim eligible.</small>
        </label>

        <label>
          Invoice number
          <input
            type="text"
            value={invoiceNumber}
            disabled={Boolean(resumeAttempt)} onChange={(event) => setInvoiceNumber(event.target.value)}
            placeholder="Example: INV-HOSP-001-001"
            required
          />
        </label>

        <label>
          Claim document
          <input
            type="file"
            accept=".pdf,.jpg,.jpeg,.png"
            onChange={(event) => setFile(event.target.files?.[0] || null)}
            required={!resumeAttempt?.documentId}
          />
        </label>
        {!resumeAttempt && <label>Supporting evidence (optional)<input type="file" multiple accept=".pdf,.jpg,.jpeg,.png" onChange={(event) => setSupportingFiles(Array.from(event.target.files || []))} /></label>}
        <p>One primary invoice plus up to four optional PDFs/images. Maximum 8 MiB per file and 20 MiB total. Supporting images inform human review; XGBoost scores structured billing data.</p>
        {resumeAttempt && supportingFiles.map((item, index) => <label key={index}>Supporting file slot {index + 2}<input type="file" accept=".pdf,.jpg,.jpeg,.png" onChange={(event) => setSupportingFiles((values) => values.map((value, slot) => slot === index ? event.target.files?.[0] || null : value))} /></label>)}
        {!resumeAttempt && supportingFiles.length > 0 && <ul>{supportingFiles.map((item, index) => <li key={index}>{item.name}</li>)}</ul>}

        <section aria-label="Invoice readiness" className="rounded-lg border border-[var(--border)] p-3">
          <p>Dataset examples are not automatically authorized patient invoices. Check wallet binding before uploading evidence.</p>
          <button type="button" disabled={!isConnected || !hospitalId || !invoiceNumber.trim() || invoiceEligibility.isFetching}
            onClick={() => invoiceEligibility.refetch()}>Check invoice readiness</button>
          {invoiceEligibility.data && <p role="status">{invoiceEligibility.data.message}{invoiceEligibility.data.boundToCurrentWallet && !invoiceEligibility.data.registryUsable ? " The record is not currently valid for automatic verification." : ""}</p>}
          {invoiceEligibility.error && <p role="alert">Invoice readiness could not be checked. No submission was created.</p>}
        </section>

        <p className="muted-text">Pre-existing-condition underwriting is outside this prototype scope. Eligibility uses your issued policy rules and paid coverage intervals.</p>

        <div className="card">
          <h3>Document Privacy</h3>
          <p>
            Client-side encryption: enabled
          </p>
          <p className="muted-text">
            Evidence is encrypted with AES-256-GCM and claim-bound authenticated
            metadata before upload. Its AES key is protected by a dedicated
            browser key and can be proxy-transformed only for an assigned auditor;
            the backend cannot decrypt it.
          </p>
        </div>

        <button
          type="submit"
          disabled={isSubmitting || isLinkingEvidence || activePolicies.length === 0}
        >
          {isSubmitting ? "Submitting..." : "Submit Claim"}
        </button>
      </form>
    </section>
  );
}
