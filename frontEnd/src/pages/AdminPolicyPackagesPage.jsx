import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import TransactionLink from "../components/TransactionLink";
import {
  deactivatePolicyPackage,
  getAdminPolicyPackages,
  reactivatePolicyPackage,
  updatePolicyPackage,
} from "../services/api";

function extractPackages(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.packages)) return data.packages;
  if (Array.isArray(data?.data)) return data.data;
  return [];
}

function buildEditForm(policyPackage) {
  return {
    name: policyPackage.name || "",
    policyType: policyPackage.policyType || "",
    premiumAmountEth: policyPackage.premiumAmountEth || "",
    coverageAmountEth: policyPackage.coverageAmountEth || "",
    durationDays: policyPackage.durationDays || "",
    requiredDocumentType: policyPackage.requiredDocumentType || "",
  };
}

export default function AdminPolicyPackagesPage() {
  const [editingPackageId, setEditingPackageId] = useState("");
  const [editForm, setEditForm] = useState(null);
  const [actionError, setActionError] = useState("");
  const [actionMessage, setActionMessage] = useState("");
  const [actionTxHash, setActionTxHash] = useState("");
  const [actingPackageId, setActingPackageId] = useState("");

  const {
    data,
    isLoading,
    isFetching,
    error,
    refetch,
  } = useQuery({
    queryKey: ["adminPolicyPackages"],
    queryFn: getAdminPolicyPackages,
  });

  const packages = extractPackages(data);

  function startEditing(policyPackage) {
    setActionError("");
    setActionMessage("");
    setActionTxHash("");
    setEditingPackageId(policyPackage.packageId);
    setEditForm(buildEditForm(policyPackage));
  }

  function cancelEditing() {
    setEditingPackageId("");
    setEditForm(null);
  }

  function updateEditField(field, value) {
    setEditForm((current) => ({
      ...current,
      [field]: value,
    }));
  }

  async function runPackageAction(packageId, actionFn, successText) {
    setActionError("");
    setActionMessage("");
    setActionTxHash("");

    try {
      setActingPackageId(packageId);

      const result = await actionFn();

      setActionTxHash(result.transactionHash || result.txHash || "");
      setActionMessage(successText);
      cancelEditing();
      await refetch();
    } catch (err) {
      console.error(err);
      setActionError(
        err.response?.data?.message ||
          err.response?.data?.error ||
          err.message ||
          "Package action failed"
      );
    } finally {
      setActingPackageId("");
    }
  }

  function handleEditSubmit(event, packageId) {
    event.preventDefault();

    runPackageAction(
      packageId,
      () =>
        updatePolicyPackage(packageId, {
          name: editForm.name.trim(),
          policyType: editForm.policyType.trim(),
          premiumAmountEth: editForm.premiumAmountEth,
          coverageAmountEth: editForm.coverageAmountEth,
          durationDays: Number(editForm.durationDays),
          requiredDocumentType: editForm.requiredDocumentType.trim(),
        }),
      "Policy package updated successfully."
    );
  }

  return (
    <section className="page-container">
      <h2>Admin Policy Packages</h2>

      <div className="action-row">
        <Link to="/admin/policy-packages/new">Create New Package</Link>

        <button type="button" onClick={() => refetch()} disabled={isFetching}>
          {isFetching ? "Refreshing..." : "Refresh Packages"}
        </button>
      </div>

      {error ? (
        <p className="error-text">
          {error.message || "Could not load policy packages"}
        </p>
      ) : null}

      {actionError ? <p className="error-text">{actionError}</p> : null}
      {actionMessage ? <p className="success-text">{actionMessage}</p> : null}

      {actionTxHash ? (
        <p>
          Action transaction: <TransactionLink txHash={actionTxHash} />
        </p>
      ) : null}

      {isLoading ? <p>Loading policy packages...</p> : null}

      {!isLoading && packages.length === 0 ? (
        <p>No policy packages found.</p>
      ) : null}

      <div className="card-row">
        {packages.map((policyPackage) => (
          <div className="card" key={policyPackage.packageId}>
            <h3>{policyPackage.name}</h3>

            <p>Package ID: {policyPackage.packageId}</p>
            <p>Type: {policyPackage.policyType}</p>
            <p>Premium: {policyPackage.premiumAmountEth} ETH</p>
            <p>Coverage: {policyPackage.coverageAmountEth} ETH</p>
            <p>Duration: {policyPackage.durationDays} days</p>
            <p>Required document: {policyPackage.requiredDocumentType}</p>
            <p>Active: {String(policyPackage.isActive ?? true)}</p>

            <div className="action-row">
              <button
                type="button"
                onClick={() => startEditing(policyPackage)}
                disabled={Boolean(actingPackageId)}
              >
                Edit
              </button>

              {policyPackage.isActive ? (
                <button
                  type="button"
                  onClick={() =>
                    runPackageAction(
                      policyPackage.packageId,
                      () => deactivatePolicyPackage(policyPackage.packageId),
                      "Policy package deactivated successfully."
                    )
                  }
                  disabled={actingPackageId === policyPackage.packageId}
                >
                  {actingPackageId === policyPackage.packageId
                    ? "Updating..."
                    : "Deactivate"}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() =>
                    runPackageAction(
                      policyPackage.packageId,
                      () => reactivatePolicyPackage(policyPackage.packageId),
                      "Policy package reactivated successfully."
                    )
                  }
                  disabled={actingPackageId === policyPackage.packageId}
                >
                  {actingPackageId === policyPackage.packageId
                    ? "Updating..."
                    : "Reactivate"}
                </button>
              )}
            </div>

            {editingPackageId === policyPackage.packageId && editForm ? (
              <form
                className="form-grid"
                onSubmit={(event) =>
                  handleEditSubmit(event, policyPackage.packageId)
                }
              >
                <label>
                  Package name
                  <input
                    type="text"
                    value={editForm.name}
                    onChange={(event) => updateEditField("name", event.target.value)}
                    required
                  />
                </label>

                <label>
                  Policy type
                  <input
                    type="text"
                    value={editForm.policyType}
                    onChange={(event) =>
                      updateEditField("policyType", event.target.value)
                    }
                    required
                  />
                </label>

                <label>
                  Premium amount in ETH
                  <input
                    type="number"
                    step="0.001"
                    min="0"
                    value={editForm.premiumAmountEth}
                    onChange={(event) =>
                      updateEditField("premiumAmountEth", event.target.value)
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
                    value={editForm.coverageAmountEth}
                    onChange={(event) =>
                      updateEditField("coverageAmountEth", event.target.value)
                    }
                    required
                  />
                </label>

                <label>
                  Duration in days
                  <input
                    type="number"
                    min="1"
                    value={editForm.durationDays}
                    onChange={(event) =>
                      updateEditField("durationDays", event.target.value)
                    }
                    required
                  />
                </label>

                <label>
                  Required document type
                  <input
                    type="text"
                    value={editForm.requiredDocumentType}
                    onChange={(event) =>
                      updateEditField("requiredDocumentType", event.target.value)
                    }
                    required
                  />
                </label>

                <div className="action-row">
                  <button
                    type="submit"
                    disabled={actingPackageId === policyPackage.packageId}
                  >
                    {actingPackageId === policyPackage.packageId
                      ? "Saving..."
                      : "Save Changes"}
                  </button>

                  <button type="button" onClick={cancelEditing}>
                    Cancel
                  </button>
                </div>
              </form>
            ) : null}
          </div>
        ))}
      </div>
    </section>
  );
}
