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
    error,
    connectWallet,
    logout,
  } = useWallet();

  if (isConnected) {
    return (
      <div className="wallet-box">
        <span className="wallet-address">{shortAddress(walletAddress)}</span>
        <span className="wallet-role">{role}</span>
        <button type="button" onClick={logout}>
          Logout
        </button>
      </div>
    );
  }

  return (
    <div className="wallet-box">
      <button type="button" onClick={connectWallet} disabled={isConnecting}>
        {isConnecting ? "Connecting..." : "Connect Wallet"}
      </button>
      {error ? <small className="error-text">{error}</small> : null}
    </div>
  );
}
