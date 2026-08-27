import { Link, Outlet } from "react-router-dom";
import Footer from "../components/Footer";
import WalletConnectButton from "../components/WalletConnectButton";
import { useWallet } from "../context/useWallet";

export default function PublicLayout() {
  const { isConnected, workspace } = useWallet();

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        Skip to main content
      </a>
      <nav className="navbar" aria-label="Primary navigation">
        <Link className="brand" to="/">
          <span className="brand-mark">B</span>
          <span>Block-Insure</span>
        </Link>

        <div className="nav-links">
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

        <WalletConnectButton />
      </nav>

      <main className="app-main" id="main-content" tabIndex="-1">
        <Outlet />
      </main>

      <Footer />
    </div>
  );
}
