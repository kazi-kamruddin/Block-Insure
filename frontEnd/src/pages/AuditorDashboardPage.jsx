import { Link } from "react-router-dom";
import "../styles/pages/AuditorDashboardPage.css";

export default function AuditorDashboardPage() {
  return (
    <section className="page-container page-auditor-dashboard">
      <div className="dashboard-heading">
        <div>
          <span className="dashboard-eyebrow">Independent assurance workspace</span>
          <h2>Claim audit and evidence review</h2>
          <p>
            Examine claim histories, validate committed evidence, and contribute
            reputation-weighted judgments without administrative authority.
          </p>
        </div>
        <span className="dashboard-context-pill">Independent review</span>
      </div>

      <div className="card-row auditor-workspace-grid">
        <div className="card">
          <span className="dashboard-card-index">01</span>
          <h3>Claim Timeline Audit</h3>
          <p>
            Inspect blockchain events for submitted claims, oracle requests,
            oracle results, manual review, approval, rejection, and settlement.
          </p>
          <Link to="/auditor/claims">Open Claim Lookup</Link>
        </div>

        <div className="card">
          <span className="dashboard-card-index">02</span>
          <h3>Document Integrity</h3>
          <p>
            Recompute an uploaded document hash and compare it with the
            immutable commitment stored with the claim.
          </p>
          <Link to="/auditor/verify-document">Verify Document</Link>
        </div>

        <div className="card">
          <span className="dashboard-card-index">03</span>
          <h3>Weighted Voting</h3>
          <p>
            Review disputed claims, cast an auditor vote, and inspect reputation
            scores that weight governance consensus.
          </p>
          <Link to="/auditor/reputation">View Reputation</Link>
        </div>
      </div>

      <div className="card dashboard-guidance-card auditor-principle-card">
        <div>
          <span className="dashboard-eyebrow">Review principle</span>
          <h3>Decisions should follow the evidence trail.</h3>
          <p>
            Compare the claim timeline, oracle confirmations, registry record,
            and document commitment before submitting an independent vote.
          </p>
        </div>
        <Link to="/auditor/healthcare-registry">Inspect Registry</Link>
      </div>
    </section>
  );
}
