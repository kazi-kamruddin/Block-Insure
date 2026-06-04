import { Link, Outlet } from "react-router-dom";
import Footer from "../components/Footer";
import WalletConnectButton from "../components/WalletConnectButton";
import { useWallet } from "../context/useWallet";

export default function PublicLayout() {
  const { isConnected, workspace } = useWallet();

  return (
    <div className="app-shell">
      <nav className="navbar">
        <Link className="brand" to="/">
          <span className="brand-mark">B</span>
          <span>Block-Insure</span>
        </Link>

        <div className="nav-links" aria-label="Primary navigation">
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

      <main className="app-main">
        <Outlet />
      </main>

      <Footer />
    </div>
  );
}
