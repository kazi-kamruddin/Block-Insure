import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import TransactionLink from "../components/TransactionLink";
import {
  abandonClaimSubmission,
  authorizeClaimSubmission,
  attachDocumentToClaim,
  getMyPolicies,
  reconcileClaimSubmission,
  recordClaimSubmissionTransaction,
  resetMyClaimSubmissionLimit,
  uploadClaimDocument,
} from "../services/api";

import EvidenceField from "../components/EvidenceField";
import IpfsLink from "../components/IpfsLink";

import {
  assertCorrectNetwork,
  getConnectedWalletAddress,
  getWalletContract,
  hashInvoiceNumber,
  parseTransactionError,
  parseEth,
  toBytes32FromBackendSha256,
} from "../services/contractService";
import { useWallet } from "../context/useWallet";
import {
  encryptEvidenceFile,
  storeEvidenceKey,
} from "../services/evidenceEncryption";
import { getClaimIdsByWallet } from "../utils/contractQueries";
import "../styles/pages/SubmitClaimPage.css";
import { showToast } from "../services/toast";

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

function extractClaimIdFromReceipt(contract, receipt) {
  for (const log of receipt.logs || []) {
    try {
      const parsedLog = contract.interface.parseLog(log);

      if (parsedLog?.name === "ClaimSubmitted") {
        return parsedLog.args.claimId.toString();
      }
    } catch {
      // Ignore logs from other contracts.
    }
  }

  return "";
}

async function resolveSubmittedClaimId(contract, receipt, walletAddress) {
  const eventClaimId = extractClaimIdFromReceipt(contract, receipt);

  if (eventClaimId) return eventClaimId;

  const claimIds = await getClaimIdsByWallet(contract, walletAddress);
  const latestClaimId = claimIds[claimIds.length - 1];

  return latestClaimId ? latestClaimId.toString() : "";
}

function dateTimeLocalToUnixSeconds(dateTimeValue) {
  return Math.floor(new Date(dateTimeValue).getTime() / 1000);
}

function formatUnixDate(unixSeconds) {
  if (!unixSeconds) return "-";
  return new Date(Number(unixSeconds) * 1000).toLocaleString();
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

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [uploadInfo, setUploadInfo] = useState(null);
  const [pendingEvidenceLink, setPendingEvidenceLink] = useState(null);
  const [evidenceLinkError, setEvidenceLinkError] = useState("");
  const [isLinkingEvidence, setIsLinkingEvidence] = useState(false);
  const [txHash, setTxHash] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [error, setError] = useState("");
  const [submissionLimit, setSubmissionLimit] = useState(null);

  const {
    data: policiesData,
    isLoading: policiesLoading,
    error: policiesError,
    refetch: refetchPolicies,
  } = useQuery({
    queryKey: ["myPolicies", walletAddress],
    queryFn: getMyPolicies,
    enabled: isConnected,
  });

  const policies = extractPolicies(policiesData);

  const activePolicies = useMemo(
    () => policies.filter((policy) => policy.isActive !== false),
    [policies]
  );

  const selectedPolicy = activePolicies.find(
    (policy) => String(policy.policyId) === String(policyId)
  );

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

      if (!file) {
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

      const authorization = await authorizeClaimSubmission(policyId);
      const attemptId = authorization?.attemptId || authorization?.data?.attemptId || "";
      activeAttemptId = attemptId;
      const encryptedEvidence = await encryptEvidenceFile(file);

      const uploadResponse = await uploadClaimDocument({
        file: encryptedEvidence.encryptedFile,
        documentType: "HOSPITAL_BILL",
        attemptId,
          encryption: {
            enabled: true,
            algorithm: encryptedEvidence.algorithm,
            originalMimeType: encryptedEvidence.originalMimeType,
            originalName: encryptedEvidence.originalName,
            wrappedEvidenceKey: encryptedEvidence.wrappedEvidenceKey,
            keyId: encryptedEvidence.keyId,
          },
      });

      const sha256Hash = getUploadedHash(uploadResponse);
      const ipfsCID = getUploadedCid(uploadResponse);
      const documentId = getUploadedDocumentId(uploadResponse);

      if (!sha256Hash || !ipfsCID || !documentId) {
        console.log("Upload response:", uploadResponse);
        throw new Error(
          "Backend upload did not return document metadata needed to submit and link the claim"
        );
      }

      storeEvidenceKey(ipfsCID, encryptedEvidence);

      setUploadInfo({
        documentId,
        sha256Hash,
        ipfsCID,
        encryption: {
          enabled: true,
          status: `${encryptedEvidence.algorithm}; encrypted before upload.`,
          keyStorage:
            "The decryption key is stored only in this browser. It is never sent to the backend, IPFS, or blockchain.",
        },
      });

      const documentHashBytes32 = toBytes32FromBackendSha256(sha256Hash);
      const invoiceHash = hashInvoiceNumber(invoiceNumber.trim());

      const contract = await getWalletContract();

      const tx = await contract.submitClaim(
        BigInt(policyId),
        parseEth(claimAmount),
        BigInt(incidentSeconds),
        claimType,
        hospitalId,
        invoiceHash,
        documentHashBytes32,
        ipfsCID
      );

      setTxHash(tx.hash);
      submittedTransactionHash = tx.hash;
      const pendingClaimKey = "block-insure:pending-claim-submissions";
      const pendingClaims = JSON.parse(
        localStorage.getItem(pendingClaimKey) || "[]"
      );
      localStorage.setItem(
        pendingClaimKey,
        JSON.stringify([
          ...pendingClaims.filter((item) => item.attemptId !== attemptId),
          { attemptId, transactionHash: tx.hash },
        ])
      );
      await recordClaimSubmissionTransaction(attemptId, tx.hash);

      const receipt = await tx.wait();
      const claimId = await resolveSubmittedClaimId(contract, receipt, activeWallet);

      if (!claimId) {
        setSuccessMessage(
          "Claim transaction was confirmed, but its ID could not be resolved. Refresh My Claims before retrying any evidence link."
        );
        return;
      }

      const evidenceLink = { documentId, claimId, attemptId };
      setPendingEvidenceLink(evidenceLink);
      setSuccessMessage(`Claim #${claimId} submitted on-chain. Linking evidence metadata...`);
      await refetchPolicies();
      await reconcileClaimSubmission(attemptId);
      localStorage.setItem(
        pendingClaimKey,
        JSON.stringify(
          JSON.parse(localStorage.getItem(pendingClaimKey) || "[]").filter(
            (item) => item.attemptId !== attemptId
          )
        )
      );
      setPendingEvidenceLink(null);
      setSuccessMessage(
        `Claim #${claimId} submitted and its encrypted evidence was reconciled successfully.`
      );
      showToast(`Claim #${claimId} and its encrypted evidence were confirmed.`, {
        title: "Claim submitted",
      });
    } catch (err) {
      console.error(err);

      if (activeAttemptId && !submittedTransactionHash) {
        try {
          await abandonClaimSubmission(
            activeAttemptId,
            "Submission stopped before a blockchain transaction was sent"
          );
        } catch (cleanupError) {
          console.error("Could not clean up unused evidence:", cleanupError);
        }
      }

      const message = parseTransactionError(err);
      if (err.response?.status === 429) {
        setSubmissionLimit(err.response.data || null);
      }
      setError(message);
      showToast(message, { tone: "error", title: "Claim submission failed" });
    } finally {
      setIsSubmitting(false);
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
            <strong>IPFS CID:</strong> <IpfsLink cid={uploadInfo.ipfsCID} />
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
          <p>Start: {formatUnixDate(selectedPolicy.startDate)}</p>
          <p>End: {formatUnixDate(selectedPolicy.endDate)}</p>
        </div>
      ) : null}

      <form className="form-grid" onSubmit={handleSubmit}>
        <label>
          Policy
          <select
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
            onChange={(event) => setClaimAmount(event.target.value)}
            required
          />
        </label>

        <label>
          Incident date/time
          <input
            type="datetime-local"
            step="60"
            value={incidentDateTime}
            onChange={(event) => setIncidentDateTime(event.target.value)}
            required
          />
          <small>
            Enter when the incident actually occurred. This value is never
            replaced with the policy purchase time.
          </small>
        </label>

        <label>
          Claim type
          <input
            type="text"
            value={claimType}
            onChange={(event) => setClaimType(event.target.value)}
            required
          />
        </label>

        <label>
          Hospital ID
          <input
            type="text"
            value={hospitalId}
            onChange={(event) => setHospitalId(event.target.value)}
            required
          />
        </label>

        <label>
          Invoice number
          <input
            type="text"
            value={invoiceNumber}
            onChange={(event) => setInvoiceNumber(event.target.value)}
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
            required
          />
        </label>

        <div className="card">
          <h3>Document Privacy</h3>
          <p>
            Client-side encryption: enabled
          </p>
          <p className="muted-text">
            Evidence is encrypted with AES-256-GCM before upload. Its AES key is
            wrapped with the application RSA public key, so the policyholder and
            authorized admins or auditors can recover it after signing in from
            another browser. Neither the plaintext file nor AES key is written
            on-chain.
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
