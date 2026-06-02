import { Link } from "react-router-dom";

export default function Footer() {
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
          <Link to="/user/dashboard">User</Link>
          <Link to="/admin/dashboard">Admin</Link>
          <Link to="/auditor/dashboard">Auditor</Link>
        </nav>
      </div>
    </footer>
  );
}
