import { useEffect, useMemo, useState } from "react";
import { getBrowserProvider } from "../services/contractService";
import {
  clearStoredSession,
  getWalletNonce,
  loginWithWallet,
  logoutSession,
} from "../services/api";
import { WalletContext } from "./walletContextObject";

function normalizeAddress(address) {
  return address ? address.toLowerCase() : "";
}

function getSignableMessage(nonceData) {
  return (
    nonceData.message ||
    nonceData.signMessage ||
    nonceData.loginMessage ||
    nonceData.nonce ||
    ""
  );
}

function getToken(loginData) {
  return loginData.token || loginData.jwt || loginData.accessToken || "";
}

export function WalletProvider({ children }) {
  const [walletAddress, setWalletAddress] = useState(
    localStorage.getItem("blockinsure_wallet") || ""
  );

  const [jwt, setJwt] = useState(localStorage.getItem("blockinsure_jwt") || "");

  const [user, setUser] = useState(() => {
    const storedUser = localStorage.getItem("blockinsure_user");

    try {
      return storedUser ? JSON.parse(storedUser) : null;
    } catch {
      return null;
    }
  });

  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState("");

  const role = user?.role || "GUEST";
  const isConnected = Boolean(walletAddress && jwt);

  async function connectWallet() {
    setError("");
    setIsConnecting(true);

    try {
      if (!window.ethereum) {
        throw new Error("MetaMask is not installed");
      }

      const accounts = await window.ethereum.request({
        method: "eth_requestAccounts",
      });

      const selectedWallet = accounts?.[0];

      if (!selectedWallet) {
        throw new Error("No wallet account selected");
      }

      const provider = await getBrowserProvider();
      const signer = await provider.getSigner();

      const nonceData = await getWalletNonce(selectedWallet);
      const message = getSignableMessage(nonceData);

      if (!message) {
        console.log("Nonce response:", nonceData);
        throw new Error("Backend did not return a signable login message");
      }

      const signature = await signer.signMessage(message);
      const loginData = await loginWithWallet(selectedWallet, signature);

      const token = getToken(loginData);

      if (!token) {
        console.log("Login response:", loginData);
        throw new Error("Backend did not return a JWT token");
      }

      const returnedUser = loginData.user || {
        walletAddress: selectedWallet,
        role: "USER",
      };

      const normalizedWallet = normalizeAddress(selectedWallet);

      localStorage.setItem("blockinsure_jwt", token);
      localStorage.setItem("blockinsure_wallet", normalizedWallet);
      localStorage.setItem("blockinsure_user", JSON.stringify(returnedUser));

      setJwt(token);
      setWalletAddress(normalizedWallet);
      setUser(returnedUser);

      return returnedUser;
    } catch (err) {
      console.error(err);
      setError(err.message || "Wallet connection failed");
      throw err;
    } finally {
      setIsConnecting(false);
    }
  }

  async function logout() {
    try {
      if (localStorage.getItem("blockinsure_jwt")) {
        await logoutSession();
      }
    } catch (logoutError) {
      console.warn("Backend logout failed:", logoutError.message);
    }

    clearStoredSession();
    setWalletAddress("");
    setJwt("");
    setUser(null);
    setError("");
  }

  useEffect(() => {
    if (!window.ethereum) return undefined;

    function handleAccountsChanged(accounts) {
      const nextAccount = accounts?.[0];

      if (!nextAccount) {
        logout();
        return;
      }

      const normalized = normalizeAddress(nextAccount);

      if (walletAddress && normalized !== walletAddress) {
        logout();
      }
    }

    window.ethereum.on("accountsChanged", handleAccountsChanged);

    return () => {
      window.ethereum.removeListener("accountsChanged", handleAccountsChanged);
    };
  }, [walletAddress]);

  const value = useMemo(
    () => ({
      walletAddress,
      jwt,
      user,
      role,
      isConnected,
      isConnecting,
      error,
      connectWallet,
      logout,
    }),
    [walletAddress, jwt, user, role, isConnected, isConnecting, error]
  );

  return (
    <WalletContext.Provider value={value}>{children}</WalletContext.Provider>
  );
}
