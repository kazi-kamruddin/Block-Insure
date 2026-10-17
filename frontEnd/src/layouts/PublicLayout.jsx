import { Link, Outlet } from "react-router-dom";
import Footer from "../components/Footer";
import ThemeToggle from "../components/ThemeToggle";
import WalletConnectButton from "../components/WalletConnectButton";
import { useWallet } from "../context/useWallet";

export default function PublicLayout() {
  const { isConnected, workspace } = useWallet();

  return (
    <div className="app-shell relative isolate overflow-x-clip">
      <a className="skip-link" href="#main-content">
        Skip to main content
      </a>
      <div className="network-ribbon" aria-label="Local protocol status">
        <span className="network-ribbon-dot" aria-hidden="true" />
        <span>Local protocol</span>
        <span className="network-ribbon-divider" aria-hidden="true" />
        <span>Hardhat 31337</span>
        <span className="network-ribbon-divider" aria-hidden="true" />
        <span>Encrypted evidence</span>
      </div>
      <nav className="navbar" aria-label="Primary navigation">
        <Link className="brand group" to="/" aria-label="Block-Insure home">
          <span className="brand-mark" aria-hidden="true">
            <svg viewBox="0 0 24 24" role="img">
              <path d="M12 2.4 20 5.7v5.8c0 5.2-3.4 8.6-8 10.1-4.6-1.5-8-4.9-8-10.1V5.7L12 2.4Z" />
              <path d="M9 8.2h4.1a2.3 2.3 0 0 1 0 4.6H9V8.2Zm0 4.6h4.8a2.4 2.4 0 1 1 0 4.8H9v-4.8Z" />
            </svg>
          </span>
          <span className="brand-copy">
            <strong>Block-Insure</strong>
            <small>Verifiable insurance operations</small>
          </span>
        </Link>

        <div className="nav-links" aria-label="Product navigation">
          <Link to="/policies">Policies</Link>
          {isConnected && workspace ? (
            <span className="portal-context">{workspace.label}</span>
          ) : (
            <>
              <a href="/#capabilities">Capabilities</a>
              <a href="/#how-it-works">How it works</a>
              <a href="/#roles">Roles</a>
            </>
          )}
        </div>

        <div className="nav-actions">
          <ThemeToggle />
          <WalletConnectButton />
        </div>
      </nav>

      <main className="app-main relative z-1" id="main-content" tabIndex="-1">
        <Outlet />
      </main>

      <Footer />
    </div>
  );
}
