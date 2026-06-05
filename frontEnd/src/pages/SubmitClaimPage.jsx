import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import TransactionLink from "../components/TransactionLink";
import {
  authorizeClaimSubmission,
  attachDocumentToClaim,
  getMyPolicies,
  uploadClaimDocument,
} from "../services/api";

import EvidenceField from "../components/EvidenceField";
import IpfsLink from "../components/IpfsLink";

import {
  assertCorrectNetwork,
  getConnectedWalletAddress,
  getWalletContract,
  hashInvoiceNumber,
  parseEth,
  toBytes32FromBackendSha256,
} from "../services/contractService";
import { useWallet } from "../context/useWallet";
import "../styles/pages/SubmitClaimPage.css";

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

function unixSecondsToDateTimeLocal(unixSeconds) {
  if (!unixSeconds) return "";

  const date = new Date(Number(unixSeconds) * 1000);
  const timezoneOffsetMs = date.getTimezoneOffset() * 60 * 1000;
  const localDate = new Date(date.getTime() - timezoneOffsetMs);

  return localDate.toISOString().slice(0, 16);
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
  const [txHash, setTxHash] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [error, setError] = useState("");

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

    const nextPolicy = activePolicies.find(
      (policy) => String(policy.policyId) === String(nextPolicyId)
    );

    if (nextPolicy?.startDate) {
      setIncidentDateTime(unixSecondsToDateTimeLocal(nextPolicy.startDate));
    }
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

  async function handleSubmit(event) {
    event.preventDefault();

    setError("");
    setSuccessMessage("");
    setTxHash("");
    setUploadInfo(null);

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
      const policyStartSeconds = Number(selectedPolicy.startDate || 0);
      const policyEndSeconds = Number(selectedPolicy.endDate || 0);

      let incidentSeconds = selectedIncidentSeconds;

      if (policyStartSeconds && incidentSeconds < policyStartSeconds) {
        incidentSeconds = policyStartSeconds;
      }

      if (policyEndSeconds && incidentSeconds > policyEndSeconds) {
        throw new Error("Incident date/time is after the policy end time.");
      }

      setIsSubmitting(true);

      await authorizeClaimSubmission(policyId);

      const uploadResponse = await uploadClaimDocument({
        file,
        documentType: "HOSPITAL_BILL",
        claimId: "pending",
      });

      const sha256Hash = getUploadedHash(uploadResponse);
      const ipfsCID = getUploadedCid(uploadResponse);
      const documentId = getUploadedDocumentId(uploadResponse);

      if (!sha256Hash || !ipfsCID) {
        console.log("Upload response:", uploadResponse);
        throw new Error("Backend upload did not return sha256Hash and ipfsCID");
      }

      setUploadInfo({
        documentId,
        sha256Hash,
        ipfsCID,
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

      const receipt = await tx.wait();
      const claimId = extractClaimIdFromReceipt(contract, receipt);

      if (documentId && claimId) {
        await attachDocumentToClaim(documentId, claimId);
      }

      setSuccessMessage(
        claimId
          ? `Claim submitted successfully. Claim ID: ${claimId}`
          : "Claim submitted successfully."
      );
    } catch (err) {
      console.error(err);
      setError(
        err.shortMessage || err.reason || err.message || "Claim submission failed"
      );
    } finally {
      setIsSubmitting(false);
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

      {error ? <p className="error-text">{error}</p> : null}
      {successMessage ? <p className="success-text">{successMessage}</p> : null}

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
                Policy #{policy.policyId} — Coverage{" "}
                {policy.coverageAmountEth || policy.coverageAmount} ETH
              </option>
            ))}
          </select>
        </label>

        <label>
          Mock hospital preset for verified oracle test
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
            value={incidentDateTime}
            onChange={(event) => setIncidentDateTime(event.target.value)}
            required
          />
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

        <button type="submit" disabled={isSubmitting || activePolicies.length === 0}>
          {isSubmitting ? "Submitting..." : "Submit Claim"}
        </button>
      </form>
    </section>
  );
}
