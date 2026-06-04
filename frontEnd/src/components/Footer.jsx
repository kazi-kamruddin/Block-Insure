import { Link } from "react-router-dom";
import { useWallet } from "../context/useWallet";

export default function Footer() {
  const { isConnected, workspace } = useWallet();

  return (
    <footer className="site-footer">
      <div className="footer-inner">
        <div>
          <Link className="footer-brand" to="/">
            Block-Insure
          </Link>
          <p className="footer-copy">
            Transparent policy, claim, oracle, and audit workflows on-chain.
          </p>
        </div>

        <nav className="footer-links" aria-label="Footer navigation">
          {isConnected && workspace ? (
            <Link to={workspace.home}>{workspace.label}</Link>
          ) : (
            <>
              <a href="/#capabilities">Capabilities</a>
              <a href="/#how-it-works">Workflow</a>
              <a href="/#roles">Roles</a>
            </>
          )}
        </nav>
      </div>
    </footer>
  );
}
