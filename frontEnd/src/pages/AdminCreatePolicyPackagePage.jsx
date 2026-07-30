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

        <button type="submit" disabled={isSubmitting}>
          {isSubmitting ? "Creating..." : "Create Package"}
        </button>
      </form>
    </section>
  );
}
