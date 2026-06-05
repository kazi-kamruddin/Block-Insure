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

        <div className="footer-assurance" aria-label="Platform assurances">
          <span>Role-isolated access</span>
          <span>Auditable workflows</span>
          <span>On-chain settlement</span>
        </div>
      </div>
    </footer>
  );
}
