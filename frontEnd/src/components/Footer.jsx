import { Link } from "react-router-dom";

export default function Footer() {
  return (
    <footer className="site-footer">
      <div className="footer-inner">
        <div className="footer-product">
          <Link className="footer-brand" to="/" aria-label="Block-Insure home">
            <span className="footer-brand-mark" aria-hidden="true">B</span>
            Block-Insure
          </Link>
          <p className="footer-copy">
            Accountable insurance workflows spanning policyholders, providers,
            banks, Oracles, Auditors, and on-chain settlement.
          </p>
        </div>

        <div className="footer-assurance" aria-label="Platform assurances">
          <span><i aria-hidden="true" />Role-isolated access</span>
          <span><i aria-hidden="true" />Auditable workflows</span>
          <span><i aria-hidden="true" />On-chain settlement</span>
        </div>
      </div>
      <div className="footer-meta">
        <span>Thesis research prototype</span>
        <span>Local development network</span>
        <span>No real patient or financial data</span>
      </div>
    </footer>
  );
}
