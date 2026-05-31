import { useState } from "react";
import { useQuery } from "@tanstack/react-query";

import PolicyCard from "../components/PolicyCard";
import TransactionLink from "../components/TransactionLink";
import { getPolicyPackages } from "../services/api";
import {
  assertCorrectNetwork,
  getConnectedWalletAddress,
  getWalletContract,
} from "../services/contractService";
import { useWallet } from "../context/useWallet";

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
    <section className="page-container">
      <h2>Buy Policy</h2>

      <button type="button" onClick={() => refetch()} disabled={isFetching}>
        {isFetching ? "Refreshing..." : "Refresh Packages"}
      </button>

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
            onBuy={handleBuy}
            isBuying={buyingPackageId === policyPackage.packageId}
          />
        ))}
      </div>
    </section>
  );
}