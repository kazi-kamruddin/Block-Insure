import { useState } from "react";
import { useQuery } from "@tanstack/react-query";

import PolicyCard from "../components/PolicyCard";
import TransactionLink from "../components/TransactionLink";
import { getPolicyPackages, getRiskPremiumQuote } from "../services/api";
import {
  assertCorrectNetwork,
  getConnectedWalletAddress,
  getWalletContract,
} from "../services/contractService";
import { useWallet } from "../context/useWallet";
import "../styles/pages/PolicyListPage.css";

function extractPackages(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.packages)) return data.packages;
  if (Array.isArray(data?.data)) return data.data;
  return [];
}

function toWeiBigInt(value) {
  if (value === undefined || value === null) {
    throw new Error("Missing premium amount");
  }

  return BigInt(String(value));
}

export default function PolicyListPage() {
  const { isConnected, walletAddress, connectWallet } = useWallet();

  const [buyingPackageId, setBuyingPackageId] = useState(null);
  const [txHash, setTxHash] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [buyError, setBuyError] = useState("");
  const [riskProfile, setRiskProfile] = useState({
    ageBand: "30_45",
    selectedRiskLevel: "MEDIUM",
    treatmentCategory: "CONSULTATION",
    claimHistoryCount: "0",
    manualMultiplier: "",
  });

  const {
    data,
    isLoading,
    isFetching,
    error: loadError,
    refetch,
  } = useQuery({
    queryKey: ["policyPackages"],
    queryFn: getPolicyPackages,
  });

  const packages = extractPackages(data);

  const { data: quoteData } = useQuery({
    queryKey: ["riskPremiumQuotes", packages.map((item) => item.packageId).join(","), riskProfile],
    queryFn: async () => {
      const quotes = await Promise.all(
        packages.map(async (policyPackage) => {
          const quote = await getRiskPremiumQuote(policyPackage.packageId, {
            ...riskProfile,
            claimHistoryCount: Number(riskProfile.claimHistoryCount || 0),
            manualMultiplier: riskProfile.manualMultiplier
              ? Number(riskProfile.manualMultiplier)
              : null,
          });

          return [policyPackage.packageId, quote.quote];
        })
      );

      return Object.fromEntries(quotes);
    },
    enabled: packages.length > 0,
  });

  function updateRiskProfile(field, value) {
    setRiskProfile((current) => ({
      ...current,
      [field]: value,
    }));
  }

  async function handleBuy(policyPackage) {
    setBuyError("");
    setSuccessMessage("");
    setTxHash("");

    try {
      if (!isConnected) {
        await connectWallet();
      }

      await assertCorrectNetwork();

      const activeWallet = await getConnectedWalletAddress();
      const storedWallet =
        walletAddress || localStorage.getItem("blockinsure_wallet") || "";

      if (activeWallet.toLowerCase() !== storedWallet.toLowerCase()) {
        throw new Error(
          "Connected MetaMask account does not match logged-in wallet. Logout and connect again."
        );
      }

      setBuyingPackageId(policyPackage.packageId);

      const contract = await getWalletContract();

      const tx = await contract.purchasePolicy(policyPackage.packageId, {
        value: toWeiBigInt(policyPackage.premiumAmountWei),
      });

      setTxHash(tx.hash);

      await tx.wait();

      setSuccessMessage(
        `Policy purchased successfully. Package: ${policyPackage.name}`
      );
    } catch (err) {
      console.error(err);
      setBuyError(
        err.shortMessage || err.reason || err.message || "Purchase failed"
      );
    } finally {
      setBuyingPackageId(null);
    }
  }

  return (
    <section className="page-container page-policy-list">
      <h2>Buy Policy</h2>

      <button type="button" onClick={() => refetch()} disabled={isFetching}>
        {isFetching ? "Refreshing..." : "Refresh Packages"}
      </button>

      <div className="card risk-pricing-card">
        <h3>Risk-Based Premium Stub</h3>
        <p className="muted-text">
          Transparent underwriting demo. Final purchase still pays the smart-contract
          package premium until on-chain risk pricing is activated.
        </p>
        <div className="form-grid">
          <label>
            Age band
            <select
              value={riskProfile.ageBand}
              onChange={(event) => updateRiskProfile("ageBand", event.target.value)}
            >
              <option value="UNDER_30">Under 30</option>
              <option value="30_45">30-45</option>
              <option value="46_60">46-60</option>
              <option value="OVER_60">Over 60</option>
            </select>
          </label>
          <label>
            Selected risk level
            <select
              value={riskProfile.selectedRiskLevel}
              onChange={(event) =>
                updateRiskProfile("selectedRiskLevel", event.target.value)
              }
            >
              <option value="LOW">Low</option>
              <option value="MEDIUM">Medium</option>
              <option value="HIGH">High</option>
            </select>
          </label>
          <label>
            Treatment category
            <select
              value={riskProfile.treatmentCategory}
              onChange={(event) =>
                updateRiskProfile("treatmentCategory", event.target.value)
              }
            >
              <option value="CONSULTATION">Consultation</option>
              <option value="HOSPITALIZATION">Hospitalization</option>
              <option value="SURGERY">Surgery</option>
              <option value="EMERGENCY">Emergency</option>
            </select>
          </label>
          <label>
            Claim history count
            <input
              type="number"
              min="0"
              max="5"
              value={riskProfile.claimHistoryCount}
              onChange={(event) =>
                updateRiskProfile("claimHistoryCount", event.target.value)
              }
            />
          </label>
          <label>
            Manual multiplier
            <input
              type="number"
              min="0.5"
              max="3"
              step="0.05"
              value={riskProfile.manualMultiplier}
              onChange={(event) =>
                updateRiskProfile("manualMultiplier", event.target.value)
              }
              placeholder="Optional"
            />
          </label>
        </div>
      </div>

      {loadError ? (
        <p className="error-text">
          {loadError.message || "Could not load policy packages"}
        </p>
      ) : null}

      {buyError ? <p className="error-text">{buyError}</p> : null}
      {successMessage ? <p className="success-text">{successMessage}</p> : null}

      {txHash ? (
        <p>
          Transaction: <TransactionLink txHash={txHash} />
        </p>
      ) : null}

      {isLoading ? <p>Loading policy packages...</p> : null}

      {!isLoading && packages.length === 0 ? (
        <p>No active policy packages found.</p>
      ) : null}

      <div className="card-row">
        {packages.map((policyPackage) => (
          <PolicyCard
            key={policyPackage.packageId}
            policyPackage={policyPackage}
            riskQuote={quoteData?.[policyPackage.packageId]}
            onBuy={handleBuy}
            isBuying={buyingPackageId === policyPackage.packageId}
          />
        ))}
      </div>
    </section>
  );
}
