import { useWallet } from "../context/useWallet";

function shortAddress(address) {
  if (!address) return "";
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export default function WalletConnectButton() {
  const {
    walletAddress,
    role,
    isConnected,
    isConnecting,
    isRestoringSession,
    error,
    connectWallet,
    logout,
  } = useWallet();

  if (isConnected) {
    return (
      <div className="wallet-box" data-connected="true">
        <span className="wallet-avatar" aria-hidden="true">
          <span className="wallet-status-dot" />
          {role?.slice(0, 1) || "W"}
        </span>
        <span className="wallet-identity">
          <span className="wallet-address" title={walletAddress}>
            {shortAddress(walletAddress)}
          </span>
          <span className="wallet-role">{role}</span>
        </span>
        <button type="button" onClick={logout}>
          Logout
        </button>
      </div>
    );
  }

  return (
    <div className="wallet-box" data-connected="false">
      <button
        type="button"
        onClick={connectWallet}
        disabled={isConnecting || isRestoringSession}
      >
        {isRestoringSession
          ? "Checking session..."
          : isConnecting
            ? "Connecting..."
            : "Connect wallet"}
      </button>
      {error ? (
        <small className="error-text" role="alert">
          {error}
        </small>
      ) : null}
    </div>
  );
}
