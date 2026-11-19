import { Link } from "react-router-dom";
import { REQUIRED_CHAIN_ID, REQUIRED_NETWORK_NAME } from "../services/contractService";

export default function Footer() {
  const networkLabel =
    REQUIRED_CHAIN_ID === 31337
      ? "Local Hardhat network (31337)"
      : `${REQUIRED_NETWORK_NAME} (${REQUIRED_CHAIN_ID})`;

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
        <span>{networkLabel}</span>
        <span>No real patient or financial data</span>
      </div>
    </footer>
  );
}
