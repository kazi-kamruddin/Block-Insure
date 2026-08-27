import { useState } from "react";
import { Link } from "react-router-dom";

import TransactionLink from "../components/TransactionLink";
import { createPolicyPackage } from "../services/api";
import { showToast } from "../services/toast";
import "../styles/pages/AdminCreatePolicyPackagePage.css";

const PACKAGE_PRESETS = [
  {
    label: "Health Basic",
    name: "Health Basic",
    policyType: "HEALTH",
    premiumAmountEth: "0.01",
    coverageAmountEth: "1",
    durationDays: "365",
    requiredDocumentType: "HOSPITAL_BILL",
    waitingPeriodDays: "30",
    reinstatementWaitingPeriodDays: "7",
    claimDeadlineDays: "365",
    minimumDocumentCommitments: "1",
    deductibleRateBps: "1000",
    deductibleCapEth: "0.1",
    insurerShareBps: "8000",
    maximumClaimEth: "2",
    allowedClaimTypes: "HEALTH,SURGERY",
    excludedClaimTypes: "COSMETIC",
  },
  {
    label: "Health Plus",
    name: "Health Plus",
    policyType: "HEALTH",
    premiumAmountEth: "0.02",
    coverageAmountEth: "2",
    durationDays: "365",
    requiredDocumentType: "HOSPITAL_BILL",
  },
  {
    label: "Surgery Cover",
    name: "Surgery Cover",
    policyType: "SURGERY",
    premiumAmountEth: "0.015",
    coverageAmountEth: "1.5",
    durationDays: "180",
    requiredDocumentType: "HOSPITAL_BILL",
  },
];

export default function AdminCreatePolicyPackagePage() {
  const [form, setForm] = useState({
    name: "Health Plus",
    policyType: "HEALTH",
    premiumAmountEth: "0.02",
    coverageAmountEth: "2",
    durationDays: "365",
    requiredDocumentType: "HOSPITAL_BILL",
  });

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [txHash, setTxHash] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [error, setError] = useState("");

  function updateField(field, value) {
    setForm((current) => ({
      ...current,
      [field]: value,
    }));
  }

  function applyPreset(label) {
    const preset = PACKAGE_PRESETS.find((item) => item.label === label);

    if (!preset) return;

    setForm({
      name: preset.name,
      policyType: preset.policyType,
      premiumAmountEth: preset.premiumAmountEth,
      coverageAmountEth: preset.coverageAmountEth,
      durationDays: preset.durationDays,
      requiredDocumentType: preset.requiredDocumentType,
      waitingPeriodDays: "30",
      reinstatementWaitingPeriodDays: "7",
      claimDeadlineDays: "365",
      minimumDocumentCommitments: "1",
      deductibleRateBps: "1000",
      deductibleCapEth: "0.1",
      insurerShareBps: "8000",
      maximumClaimEth: preset.coverageAmountEth,
      allowedClaimTypes: preset.policyType,
      excludedClaimTypes: "COSMETIC",
    });
  }

  async function handleSubmit(event) {
    event.preventDefault();

    setError("");
    setSuccessMessage("");
    setTxHash("");

    try {
      setIsSubmitting(true);

      const result = await createPolicyPackage({
        name: form.name.trim(),
        policyType: form.policyType.trim(),
        premiumAmountEth: form.premiumAmountEth,
        coverageAmountEth: form.coverageAmountEth,
        durationDays: Number(form.durationDays),
        requiredDocumentType: form.requiredDocumentType.trim(),
        economicRules: {
          waitingPeriodDays: Number(form.waitingPeriodDays),
          reinstatementWaitingPeriodDays: Number(
            form.reinstatementWaitingPeriodDays
          ),
          claimDeadlineDays: Number(form.claimDeadlineDays),
          minimumDocumentCommitments: Number(
            form.minimumDocumentCommitments
          ),
          deductibleRateBps: Number(form.deductibleRateBps),
          deductibleCapEth: form.deductibleCapEth,
          insurerShareBps: Number(form.insurerShareBps),
          maximumClaimEth: form.maximumClaimEth,
          allowedClaimTypes: form.allowedClaimTypes
            .split(",")
            .map((value) => value.trim())
            .filter(Boolean),
          excludedClaimTypes: form.excludedClaimTypes
            .split(",")
            .map((value) => value.trim())
            .filter(Boolean),
          requiredDocumentTypes: [form.requiredDocumentType.trim()],
          settlementFormulaVersion: "BLOCK_INSURE_SETTLEMENT_V1",
        },
      });

      setTxHash(result.transactionHash || result.txHash || "");
      const message = `Policy package created successfully. Package ID: ${
        result.packageId || "-"
      }`;
      setSuccessMessage(message);
      showToast(message, { title: "Package created" });
    } catch (err) {
      console.error(err);
      const message =
        err.response?.data?.message ||
          err.response?.data?.error ||
          err.message ||
          "Could not create policy package";
      setError(message);
      showToast(message, { tone: "error", title: "Package creation failed" });
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <section className="page-container page-admin-create-policy-package">
      <h2>Create Policy Package</h2>

      <p>
        <Link to="/admin/policy-packages">Back to Policy Packages</Link>
      </p>

      {error ? <p className="error-text">{error}</p> : null}
      {successMessage ? <p className="success-text">{successMessage}</p> : null}

      {txHash ? (
        <p>
          Transaction: <TransactionLink txHash={txHash} />
        </p>
      ) : null}

      <form className="form-grid" onSubmit={handleSubmit}>
        <label>
          Quick preset
          <select defaultValue="" onChange={(event) => applyPreset(event.target.value)}>
            <option value="">Manual package</option>
            {PACKAGE_PRESETS.map((preset) => (
              <option key={preset.label} value={preset.label}>
                {preset.label}
              </option>
            ))}
          </select>
        </label>

        <label>
          Package name
          <input
            type="text"
            value={form.name}
            onChange={(event) => updateField("name", event.target.value)}
            required
          />
        </label>

        <label>
          Policy type
          <input
            type="text"
            value={form.policyType}
            onChange={(event) => updateField("policyType", event.target.value)}
            required
          />
        </label>

        <label>
          Premium amount in ETH
          <input
            type="number"
            step="0.001"
            min="0"
            value={form.premiumAmountEth}
            onChange={(event) =>
              updateField("premiumAmountEth", event.target.value)
            }
            required
          />
        </label>

        <label>
          Coverage amount in ETH
          <input
            type="number"
            step="0.001"
            min="0"
            value={form.coverageAmountEth}
            onChange={(event) =>
              updateField("coverageAmountEth", event.target.value)
            }
            required
          />
        </label>

        <label>
          Duration in days
          <input
            type="number"
            min="1"
            value={form.durationDays}
            onChange={(event) => updateField("durationDays", event.target.value)}
            required
          />
        </label>

        <label>
          Required document type
          <input
            type="text"
            value={form.requiredDocumentType}
            onChange={(event) =>
              updateField("requiredDocumentType", event.target.value)
            }
            required
          />
        </label>

        <label>
          Initial waiting period (days)
          <input type="number" min="0" value={form.waitingPeriodDays} onChange={(event) => updateField("waitingPeriodDays", event.target.value)} required />
        </label>

        <label>
          Reinstatement waiting period (days)
          <input type="number" min="0" value={form.reinstatementWaitingPeriodDays} onChange={(event) => updateField("reinstatementWaitingPeriodDays", event.target.value)} required />
        </label>

        <label>
          Claim filing deadline (days)
          <input type="number" min="1" value={form.claimDeadlineDays} onChange={(event) => updateField("claimDeadlineDays", event.target.value)} required />
        </label>

        <label>
          Minimum evidence commitments
          <input type="number" min="1" value={form.minimumDocumentCommitments} onChange={(event) => updateField("minimumDocumentCommitments", event.target.value)} required />
        </label>

        <label>
          Deductible rate (basis points)
          <input type="number" min="0" max="10000" value={form.deductibleRateBps} onChange={(event) => updateField("deductibleRateBps", event.target.value)} required />
        </label>

        <label>
          Deductible cap (ETH)
          <input type="number" min="0" step="0.001" value={form.deductibleCapEth} onChange={(event) => updateField("deductibleCapEth", event.target.value)} required />
        </label>

        <label>
          Insurer share (basis points)
          <input type="number" min="0" max="10000" value={form.insurerShareBps} onChange={(event) => updateField("insurerShareBps", event.target.value)} required />
        </label>

        <label>
          Maximum claim (ETH)
          <input type="number" min="0.001" step="0.001" value={form.maximumClaimEth} onChange={(event) => updateField("maximumClaimEth", event.target.value)} required />
        </label>

        <label>
          Allowed claim types (comma separated)
          <input type="text" value={form.allowedClaimTypes} onChange={(event) => updateField("allowedClaimTypes", event.target.value)} required />
        </label>

        <label>
          Excluded service codes (comma separated)
          <input type="text" value={form.excludedClaimTypes} onChange={(event) => updateField("excludedClaimTypes", event.target.value)} />
        </label>

        <button type="submit" disabled={isSubmitting}>
          {isSubmitting ? "Creating..." : "Create Package"}
        </button>
      </form>
    </section>
  );
}
