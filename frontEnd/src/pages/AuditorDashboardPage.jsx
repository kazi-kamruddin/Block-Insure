import { Link } from "react-router-dom";
import { useWallet } from "../context/useWallet";

export default function AuditorDashboardPage() {
  const { walletAddress, role } = useWallet();

  return (
    <section className="page-container">
      <h2>Auditor Dashboard</h2>

      <div className="card">
        <p>Wallet: {walletAddress}</p>
        <p>Role: {role}</p>
      </div>

      <div className="card-row">
        <div className="card">
          <h3>Claim Timeline Audit</h3>
          <p>
            Inspect blockchain events for submitted claims, oracle requests,
            oracle results, manual review, approval, rejection, and settlement.
          </p>
          <Link to="/auditor/claims">Open Claim Lookup</Link>
        </div>

        <div className="card">
          <h3>Defense Demo Tip</h3>
          <p>
            Use Claim ID 1 or Claim ID 2 after running the full user/admin flow.
            The timeline page should show the lifecycle in chronological order.
          </p>
        </div>
      </div>
    </section>
  );
}