import { useCallback, useEffect, useMemo, useState } from "react";
import {
  assertCorrectNetwork,
  getBrowserProvider,
  parseTransactionError,
  REQUIRED_CHAIN_ID,
} from "../services/contractService";
import {
  clearStoredSession,
  getCurrentUser,
  getWalletNonce,
  loginWithWallet,
  logoutSession,
} from "../services/api";
import { WalletContext } from "./walletContextObject";

const ROLE_WORKSPACES = {
  USER: {
    home: "/user/dashboard",
    label: "Policyholder workspace",
  },
  ADMIN: {
    home: "/admin/dashboard",
    label: "Administration workspace",
  },
  AUDITOR: {
    home: "/auditor/dashboard",
    label: "Auditor workspace",
  },
};

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
  const [isRestoringSession, setIsRestoringSession] = useState(
    Boolean(
      localStorage.getItem("blockinsure_wallet") &&
        localStorage.getItem("blockinsure_jwt")
    )
  );
  const [error, setError] = useState("");

  const role = user?.role || "GUEST";
  const workspace = ROLE_WORKSPACES[role] || null;
  const isConnected = Boolean(walletAddress && jwt && !isRestoringSession);

  const clearSessionState = useCallback((message = "") => {
    clearStoredSession();
    setWalletAddress("");
    setJwt("");
    setUser(null);
    setError(message);
    setIsRestoringSession(false);
  }, []);

  const connectWallet = useCallback(async () => {
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

      await assertCorrectNetwork();
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
      setIsRestoringSession(false);

      return returnedUser;
    } catch (err) {
      console.error(err);
      setError(parseTransactionError(err));
      return null;
    } finally {
      setIsConnecting(false);
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      if (localStorage.getItem("blockinsure_jwt")) {
        await logoutSession();
      }
    } catch (logoutError) {
      console.warn("Backend logout failed:", logoutError.message);
    }

    clearSessionState();
  }, [clearSessionState]);

  useEffect(() => {
    let cancelled = false;

    async function restoreSession() {
      if (!walletAddress || !jwt) {
        setIsRestoringSession(false);
        return;
      }

      try {
        if (!window.ethereum) {
          throw new Error("MetaMask is unavailable. Connect your wallet again.");
        }

        const accounts = await window.ethereum.request({ method: "eth_accounts" });
        const activeWallet = normalizeAddress(accounts?.[0]);

        if (!activeWallet || activeWallet !== normalizeAddress(walletAddress)) {
          throw new Error(
            "The active MetaMask account changed. Connect the intended role wallet again."
          );
        }

        await assertCorrectNetwork();
        const response = await getCurrentUser();
        const refreshedUser = response.user || response.data?.user;

        if (!refreshedUser) {
          throw new Error("Your saved session could not be restored.");
        }

        if (!cancelled) {
          localStorage.setItem("blockinsure_user", JSON.stringify(refreshedUser));
          setUser(refreshedUser);
          setIsRestoringSession(false);
        }
      } catch (restoreError) {
        if (!cancelled) {
          clearSessionState(parseTransactionError(restoreError));
        }
      }
    }

    restoreSession();

    return () => {
      cancelled = true;
    };
  }, [clearSessionState, jwt, walletAddress]);

  useEffect(() => {
    function handleExpiredSession(event) {
      clearSessionState(
        event.detail || "Your session expired. Connect your wallet again."
      );
    }

    window.addEventListener("blockinsure:session-expired", handleExpiredSession);

    return () => {
      window.removeEventListener(
        "blockinsure:session-expired",
        handleExpiredSession
      );
    };
  }, [clearSessionState]);

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

    function handleChainChanged(chainId) {
      if (Number(chainId) !== REQUIRED_CHAIN_ID) {
        clearSessionState(
          `MetaMask switched networks. Select Hardhat Localhost (chain ID ${REQUIRED_CHAIN_ID}) and connect again.`
        );
      }
    }

    window.ethereum.on("accountsChanged", handleAccountsChanged);
    window.ethereum.on("chainChanged", handleChainChanged);

    return () => {
      window.ethereum.removeListener("accountsChanged", handleAccountsChanged);
      window.ethereum.removeListener("chainChanged", handleChainChanged);
    };
  }, [clearSessionState, logout, walletAddress]);

  const value = useMemo(
    () => ({
      walletAddress,
      jwt,
      user,
      role,
      workspace,
      isConnected,
      isConnecting,
      isRestoringSession,
      error,
      connectWallet,
      logout,
    }),
    [
      walletAddress,
      jwt,
      user,
      role,
      workspace,
      isConnected,
      isConnecting,
      isRestoringSession,
      error,
      connectWallet,
      logout,
    ]
  );

  return (
    <WalletContext.Provider value={value}>{children}</WalletContext.Provider>
  );
}
