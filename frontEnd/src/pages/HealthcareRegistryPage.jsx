import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";

import {
  getHealthcareRegistryMerkleRoot,
  getHealthcareRegistryMerkleProof,
  getHealthcareRegistryRecords,
  getHealthcareOnChainRegistryMerkleRoot,
  pushRegistryMerkleRoot,
} from "../services/api";
import { useWallet } from "../context/useWallet";
import "../styles/pages/HealthcareRegistryPage.css";

const DEFAULT_FILTERS = {
  q: "",
  treatmentType: "",
  recordStatus: "",
  fraudLabel: "",
  licenseStatus: "",
};

function extractRecords(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.records)) return data.records;
  if (Array.isArray(data?.data)) return data.data;
  return [];
}

function formatDate(value) {
  if (!value) return "-";
  return new Date(value).toLocaleDateString();
}

function formatPercent(part, total) {
  if (!total) return "0%";
  return `${Math.round((part / total) * 100)}%`;
}

function getSummaryRows(items = [], labelKey, valueKey = "count") {
  return items
    .map((item) => ({
      label: item[labelKey] || item._id || "Unknown",
      value: Number(item[valueKey] || 0),
    }))
    .filter((item) => item.value > 0);
}

function DistributionBars({ title, rows, total }) {
  if (!rows.length) return null;

  return (
    <div className="registry-distribution-card card">
      <h3>{title}</h3>
      <div className="registry-distribution-bars">
        {rows.map((row) => (
          <div className="registry-distribution-row" key={row.label}>
            <span>{row.label}</span>
            <div>
              <b style={{ width: `${total ? (row.value / total) * 100 : 0}%` }} />
            </div>
            <strong>{row.value}</strong>
          </div>
        ))}
      </div>
    </div>
  );
}

function cleanFilters(filters) {
  return Object.fromEntries(
    Object.entries(filters).filter(([, value]) => value !== "")
  );
}

function formatTimestamp(timestamp) {
  const isoValue = timestamp?.iso;

  if (!isoValue) {
    return "-";
  }

  return new Date(isoValue).toLocaleString();
}

export default function HealthcareRegistryPage() {
  const { role } = useWallet();
  const [draftFilters, setDraftFilters] = useState(DEFAULT_FILTERS);
  const [activeFilters, setActiveFilters] = useState(DEFAULT_FILTERS);
  const [proofInvoiceHash, setProofInvoiceHash] = useState("");
  const [submittedProofInvoiceHash, setSubmittedProofInvoiceHash] = useState("");

  const queryParams = useMemo(
    () => ({
      ...cleanFilters(activeFilters),
      limit: 100,
    }),
    [activeFilters]
  );

  const {
    data,
    isLoading,
    isFetching,
    error,
    refetch,
  } = useQuery({
    queryKey: ["healthcareRegistry", queryParams],
    queryFn: () => getHealthcareRegistryRecords(queryParams),
  });

  const {
    data: merkleData,
    isLoading: merkleLoading,
    refetch: refetchMerkle,
  } = useQuery({
    queryKey: ["healthcareRegistryMerkleRoot"],
    queryFn: getHealthcareRegistryMerkleRoot,
  });

  const {
    data: onChainMerkleData,
    isLoading: onChainMerkleLoading,
    error: onChainMerkleError,
    refetch: refetchOnChainMerkle,
  } = useQuery({
    queryKey: ["onChainRegistryMerkleRoot"],
    queryFn: getHealthcareOnChainRegistryMerkleRoot,
    enabled: role === "ADMIN" || role === "AUDITOR",
  });

  const {
    data: proofData,
    isLoading: proofLoading,
    error: proofError,
  } = useQuery({
    queryKey: ["healthcareMerkleProof", submittedProofInvoiceHash],
    queryFn: () =>
      getHealthcareRegistryMerkleProof(submittedProofInvoiceHash),
    enabled: Boolean(submittedProofInvoiceHash),
  });

  const pushMerkleMutation = useMutation({
    mutationFn: pushRegistryMerkleRoot,
    onSuccess: () => {
      refetchOnChainMerkle();
      refetchMerkle();
    },
  });

  const records = extractRecords(data);
  const summary = data?.summary || {};
  const merkleRoot = merkleData?.merkleRoot;
  const registrySnapshot = onChainMerkleData?.registrySnapshot;
  const merkleProof = proofData?.merkleProof || null;
  const localRoot = merkleRoot?.rootHash || "";
  const onChainRoot = registrySnapshot?.root || "";
  const rootsMatch =
    Boolean(localRoot && onChainRoot) &&
    localRoot.toLowerCase() === onChainRoot.toLowerCase();
  const total = summary.total || 0;
  const compositionRows = [
    { label: "Legitimate", value: summary.legitimate || 0 },
    { label: "Fraud labeled", value: summary.fraudulent || 0 },
  ].filter((row) => row.value > 0);
  const statusRows = Object.entries(summary.statusCounts || {}).map(
    ([label, value]) => ({
      label: label.toUpperCase(),
      value,
    })
  );
  const fraudRows = getSummaryRows(summary.fraudBreakdown, "fraudLabel");

  function updateFilter(field, value) {
    setDraftFilters((current) => ({
      ...current,
      [field]: value,
    }));
  }

  function handleSubmit(event) {
    event.preventDefault();
    setActiveFilters(draftFilters);
  }

  function handleReset() {
    setDraftFilters(DEFAULT_FILTERS);
    setActiveFilters(DEFAULT_FILTERS);
  }

  function handleProofSubmit(event) {
    event.preventDefault();
    setSubmittedProofInvoiceHash(proofInvoiceHash.trim());
  }

  return (
    <section className="page-container page-healthcare-registry">
      <h2>Synthetic External Registry</h2>
      <p>
        Browse the synthetic hospital, invoice, patient, and treatment records
        used as the mock external oracle verification source.
      </p>

      <div className="registry-hero card">
        <div>
          <span className="registry-eyebrow">Current access</span>
          <h3>{role === "ADMIN" ? "Admin registry view" : "Auditor registry view"}</h3>
          <p>
            These records simulate inaccessible real-world hospital and national
            health databases for thesis evaluation and oracle verification.
            A production deployment would replace this mock service with a
            hospital API or signed data feed while keeping only hashes and
            Merkle roots on-chain.
          </p>
        </div>
      </div>

      {role === "ADMIN" ? (
        <div className="registry-chain-card">
          <div className="registry-chain-main">
            <span className="registry-eyebrow">On-Chain Registry Commitment</span>
            <strong>
              {onChainMerkleLoading
                ? "Loading root..."
                : registrySnapshot?.root || "-"}
            </strong>
            <span
              className={`registry-chain-status ${
                registrySnapshot?.committed ? "is-committed" : "is-empty"
              }`}
            >
              {registrySnapshot?.committed
                ? "Committed to Blockchain"
                : "Not Yet Committed"}
            </span>
          </div>
          <div>
            <span>Block Number</span>
            <strong>{registrySnapshot?.blockNumber || "-"}</strong>
          </div>
          <div>
            <span>Timestamp</span>
            <strong>{formatTimestamp(registrySnapshot?.timestamp)}</strong>
          </div>
          <div className="registry-chain-actions">
            <button
              type="button"
              onClick={() => pushMerkleMutation.mutate()}
              disabled={pushMerkleMutation.isPending}
            >
              {pushMerkleMutation.isPending
                ? "Pushing..."
                : "Push Current Root On-Chain"}
            </button>
          </div>
          {onChainMerkleError || pushMerkleMutation.error ? (
            <p className="registry-chain-message error-text">
              {onChainMerkleError?.response?.data?.message ||
                pushMerkleMutation.error?.response?.data?.message ||
                onChainMerkleError?.message ||
                pushMerkleMutation.error?.message ||
                "Could not update on-chain registry commitment"}
            </p>
          ) : null}
          {pushMerkleMutation.data?.transactionHash ? (
            <p className="registry-chain-message">
              Root pushed in transaction {pushMerkleMutation.data.transactionHash}
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="registry-metrics">
        <div className="card">
          <span>Total Records</span>
          <strong>{isLoading ? "..." : total}</strong>
        </div>
        <div className="card">
          <span>Legitimate</span>
          <strong>{isLoading ? "..." : summary.legitimate || 0}</strong>
          <small>{formatPercent(summary.legitimate || 0, total)}</small>
        </div>
        <div className="card">
          <span>Fraud Labeled</span>
          <strong>{isLoading ? "..." : summary.fraudulent || 0}</strong>
          <small>{formatPercent(summary.fraudulent || 0, total)}</small>
        </div>
        <div className="card">
          <span>Blacklisted Licenses</span>
          <strong>{isLoading ? "..." : summary.licenseCounts?.blacklisted || 0}</strong>
        </div>
      </div>

      <div className="registry-insight-grid">
        <DistributionBars
          title="Dataset composition"
          rows={compositionRows}
          total={total}
        />
        <DistributionBars
          title="Record status mix"
          rows={statusRows}
          total={total}
        />
        <DistributionBars
          title="Fraud scenario labels"
          rows={fraudRows}
          total={total}
        />
      </div>

      <form className="registry-filter-bar" onSubmit={handleSubmit}>
        <label>
          Search
          <input
            type="search"
            value={draftFilters.q}
            onChange={(event) => updateFilter("q", event.target.value)}
            placeholder="Hospital, invoice, district..."
          />
        </label>

        <label>
          Treatment
          <select
            value={draftFilters.treatmentType}
            onChange={(event) => updateFilter("treatmentType", event.target.value)}
          >
            <option value="">All treatments</option>
            <option value="HOSPITALIZATION">Hospitalization</option>
            <option value="SURGERY">Surgery</option>
            <option value="EMERGENCY">Emergency</option>
            <option value="DIAGNOSTIC">Diagnostic</option>
            <option value="MATERNITY">Maternity</option>
          </select>
        </label>

        <label>
          Record status
          <select
            value={draftFilters.recordStatus}
            onChange={(event) => updateFilter("recordStatus", event.target.value)}
          >
            <option value="">All statuses</option>
            <option value="VALID">Valid</option>
            <option value="INVALID">Invalid</option>
            <option value="USED">Used</option>
            <option value="CANCELLED">Cancelled</option>
          </select>
        </label>

        <label>
          Fraud label
          <select
            value={draftFilters.fraudLabel}
            onChange={(event) => updateFilter("fraudLabel", event.target.value)}
          >
            <option value="">All labels</option>
            <option value="LEGITIMATE">Legitimate</option>
            <option value="USED_INVOICE">Used invoice</option>
            <option value="CANCELLED_RECORD">Cancelled record</option>
            <option value="INFLATED_AMOUNT">Inflated amount</option>
            <option value="BLACKLISTED_HOSPITAL">Blacklisted hospital</option>
            <option value="DATE_MISMATCH">Date mismatch</option>
            <option value="SUSPICIOUS_PATTERN">Suspicious pattern</option>
          </select>
        </label>

        <label>
          License
          <select
            value={draftFilters.licenseStatus}
            onChange={(event) => updateFilter("licenseStatus", event.target.value)}
          >
            <option value="">All licenses</option>
            <option value="ACTIVE">Active</option>
            <option value="SUSPENDED">Suspended</option>
            <option value="BLACKLISTED">Blacklisted</option>
          </select>
        </label>

        <div className="registry-filter-actions">
          <button type="submit" disabled={isFetching}>
            {isFetching ? "Filtering..." : "Apply Filters"}
          </button>
          <button type="button" onClick={handleReset}>
            Reset
          </button>
          <button type="button" onClick={() => refetch()} disabled={isFetching}>
            Refresh
          </button>
          <button
            type="button"
            onClick={() => refetchMerkle()}
            disabled={merkleLoading}
          >
            Root
          </button>
        </div>
      </form>

      <div className="registry-merkle-card">
        <div>
          <span className="registry-eyebrow">Merkle registry commitment</span>
          <strong>{merkleLoading ? "Loading root..." : merkleRoot?.rootHash || "-"}</strong>
        </div>
        <div>
          <span>Leaves</span>
          <strong>{merkleRoot?.leafCount ?? "-"}</strong>
        </div>
        <div>
          <span>Depth</span>
          <strong>{merkleRoot?.treeDepth ?? "-"}</strong>
        </div>
        <div>
          <span>Hash</span>
          <strong>{merkleRoot?.hashAlgorithm || "SHA-256"}</strong>
        </div>
      </div>

      <div className="registry-chain-card">
        <div className="registry-chain-main">
          <span className="registry-eyebrow">Merkle Proof Verification</span>
          <strong>{rootsMatch ? "Roots Match" : "Root Check Pending/Mismatch"}</strong>
          <span className={`registry-chain-status ${rootsMatch ? "is-committed" : "is-empty"}`}>
            {rootsMatch ? "Local root matches on-chain root" : "Compare local and on-chain roots"}
          </span>
        </div>
        <div>
          <span>On-chain root</span>
          <strong>{onChainRoot || "-"}</strong>
        </div>
        <div>
          <span>Local root</span>
          <strong>{localRoot || "-"}</strong>
        </div>

        <form className="registry-filter-bar" onSubmit={handleProofSubmit}>
          <label>
            Invoice hash
            <input
              type="text"
              value={proofInvoiceHash}
              onChange={(event) => setProofInvoiceHash(event.target.value)}
              placeholder="0x..."
            />
          </label>
          <button type="submit" disabled={proofLoading || !proofInvoiceHash.trim()}>
            {proofLoading ? "Checking..." : "Verify Proof"}
          </button>
        </form>

        {proofError ? (
          <p className="error-text">
            {proofError.response?.data?.message || proofError.message || "Proof lookup failed"}
          </p>
        ) : null}

        {merkleProof ? (
          <div className="registry-commitment-grid">
            <div>
              <span>Invoice identifier</span>
              <strong>{merkleProof.invoiceNumber || merkleProof.invoiceHash || "-"}</strong>
            </div>
            <div>
              <span>Leaf hash</span>
              <strong>{merkleProof.leafHash || "-"}</strong>
            </div>
            <div>
              <span>Proof verification</span>
              <strong>{merkleProof.verified ? "Valid" : "Not verified"}</strong>
            </div>
            <div>
              <span>Proof path</span>
              <strong>{merkleProof.proofLength ?? merkleProof.proof?.length ?? 0} nodes</strong>
            </div>
            <div>
              <span>Safe summary</span>
              <strong>
                {[
                  merkleProof.safeRegistrySummary?.hospitalId,
                  merkleProof.safeRegistrySummary?.treatmentType,
                  merkleProof.safeRegistrySummary?.recordStatus,
                ]
                  .filter(Boolean)
                  .join(" / ") || "-"}
              </strong>
            </div>
            <div>
              <span>Proof path hashes</span>
              <strong>
                {(merkleProof.proof || [])
                  .map((step) => `${step.position}:${step.siblingHash}`)
                  .join(" | ") || "-"}
              </strong>
            </div>
          </div>
        ) : null}
      </div>

      {error ? (
        <p className="error-text">
          {error.response?.data?.message ||
            error.message ||
            "Could not load registry records"}
        </p>
      ) : null}

      {isLoading ? <p>Loading synthetic healthcare registry...</p> : null}

      {!isLoading && records.length === 0 ? (
        <p>No registry records matched the selected filters.</p>
      ) : null}

      {records.length > 0 ? (
        <div className="registry-table-wrap">
          <table className="registry-table">
            <thead>
              <tr>
                <th>Hospital</th>
                <th>Area</th>
                <th>Treatment</th>
                <th>Invoice</th>
                <th>Bill</th>
                <th>Dates</th>
                <th>Status</th>
                <th>Fraud Label</th>
              </tr>
            </thead>
            <tbody>
              {records.map((record) => (
                <tr key={record._id || record.invoiceHash}>
                  <td>
                    <strong>{record.hospitalId}</strong>
                    <span>{record.hospitalName}</span>
                    <small>{record.licenseStatus}</small>
                  </td>
                  <td>
                    {record.district}
                    <span>{record.division}</span>
                  </td>
                  <td>
                    {record.treatmentType}
                    <span>{record.diagnosisCode}</span>
                  </td>
                  <td>
                    {record.invoiceNumber}
                    <span className="registry-hash">{record.invoiceHash}</span>
                  </td>
                  <td>
                    {record.billAmount} ETH
                    <span>
                      Expected {record.expectedBillMin}-{record.expectedBillMax}
                    </span>
                  </td>
                  <td>
                    {formatDate(record.admissionDate)}
                    <span>to {formatDate(record.dischargeDate)}</span>
                  </td>
                  <td>
                    <span className={`registry-pill status-${record.recordStatus?.toLowerCase()}`}>
                      {record.recordStatus}
                    </span>
                    <small>{record.invoiceStatus}</small>
                  </td>
                  <td>
                    <span
                      className={`registry-pill fraud-${record.fraudLabel?.toLowerCase()}`}
                    >
                      {record.fraudLabel}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}
