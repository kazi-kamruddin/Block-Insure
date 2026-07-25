import { Navigate } from "react-router-dom";
import { useWallet } from "../context/useWallet";
import "../styles/pages/HomePage.css";

export default function HomePage() {
  const {
    isConnected,
    workspace,
    connectWallet,
    isConnecting,
    isRestoringSession,
    error,
  } = useWallet();

  if (isConnected && workspace) {
    return <Navigate to={workspace.home} replace />;
  }

  return (
    <div className="page-home">
      <section className="home-hero">
        <div className="home-hero-copy">
          <span className="home-eyebrow">Blockchain-backed claim assurance</span>
          <h1>Insurance decisions that leave an evidence trail.</h1>
          <p>
            Block-Insure combines auditable policy management, multi-oracle
            verification, explainable fraud scoring, independent review, and
            on-chain settlement in one focused workflow.
          </p>

          <div className="home-hero-actions">
            <button
              type="button"
              onClick={connectWallet}
              disabled={isConnecting || isRestoringSession}
            >
              {isRestoringSession
                ? "Checking saved session..."
                : isConnecting
                  ? "Connecting wallet..."
                  : "Connect wallet to enter"}
            </button>
            <a className="home-secondary-action" href="#how-it-works">
              Explore the workflow
            </a>
          </div>

          {error ? (
            <p className="home-connect-error" role="alert">
              {error}
            </p>
          ) : null}

          <div className="home-proof-row" aria-label="Core platform properties">
            <span>Role-isolated workspaces</span>
            <span>Tamper-evident evidence</span>
            <span>On-chain settlement</span>
          </div>
        </div>

        <div className="home-hero-visual" aria-label="Claim assurance workflow">
          <div className="home-orbit home-orbit-one" />
          <div className="home-orbit home-orbit-two" />
          <div className="home-ledger-card">
            <span className="home-ledger-kicker">Claim assurance pipeline</span>
            <div className="home-ledger-status">
              <strong>Verified lifecycle</strong>
              <span>On-chain</span>
            </div>
            <div className="home-ledger-steps">
              <div>
                <span>01</span>
                <p>Evidence committed</p>
              </div>
              <div>
                <span>02</span>
                <p>Oracle quorum reached</p>
              </div>
              <div>
                <span>03</span>
                <p>Decision reviewed</p>
              </div>
              <div>
                <span>04</span>
                <p>Settlement recorded</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="home-section" id="capabilities">
        <div className="home-section-heading">
          <span>Platform capabilities</span>
          <h2>Built around verifiable decisions, not hidden processes.</h2>
          <p>
            Each layer contributes a specific control or audit signal while the
            smart contract preserves the final lifecycle and financial record.
          </p>
        </div>

        <div className="home-feature-grid">
          <article>
            <span>01</span>
            <h3>Policy and claim lifecycle</h3>
            <p>Purchases, submissions, decisions, appeals, and closure follow controlled states.</p>
          </article>
          <article>
            <span>02</span>
            <h3>Multi-oracle verification</h3>
            <p>Independent oracle confirmations compare claims with healthcare registry records.</p>
          </article>
          <article>
            <span>03</span>
            <h3>Explainable fraud scoring</h3>
            <p>Bayesian evidence factors and anomaly checks expose the reasons behind risk scores.</p>
          </article>
          <article>
            <span>04</span>
            <h3>Evidence integrity</h3>
            <p>IPFS references, document hashes, and linked evidence records reveal inconsistencies.</p>
          </article>
          <article>
            <span>05</span>
            <h3>Independent review</h3>
            <p>Auditor votes are weighted by reputation without granting administrative authority.</p>
          </article>
          <article>
            <span>06</span>
            <h3>Transparent settlement</h3>
            <p>Deductible, co-insurance, reserve checks, and payouts are calculated on-chain.</p>
          </article>
        </div>
      </section>

      <section className="home-workflow" id="how-it-works">
        <div className="home-section-heading">
          <span>End-to-end workflow</span>
          <h2>From policy purchase to final settlement.</h2>
        </div>

        <ol className="home-workflow-list">
          <li>
            <span>01</span>
            <div>
              <h3>Submit</h3>
              <p>A policyholder purchases coverage and submits a claim with hashed evidence.</p>
            </div>
          </li>
          <li>
            <span>02</span>
            <div>
              <h3>Verify</h3>
              <p>Duplicate controls, registry checks, oracle quorum, and fraud scoring assess the claim.</p>
            </div>
          </li>
          <li>
            <span>03</span>
            <div>
              <h3>Review</h3>
              <p>Claims requiring judgment move to independent auditor review or an appeal process.</p>
            </div>
          </li>
          <li>
            <span>04</span>
            <div>
              <h3>Settle</h3>
              <p>Approved claims are paid from the contract reserve and permanently recorded.</p>
            </div>
          </li>
        </ol>
      </section>

      <section className="home-section home-roles" id="roles">
        <div className="home-section-heading">
          <span>Separated responsibilities</span>
          <h2>One identity. One workspace. Clear authority.</h2>
          <p>
            Connecting a wallet opens only the workspace assigned to that
            identity. Administrative, policyholder, and auditor responsibilities
            remain deliberately separate.
          </p>
        </div>

        <div className="home-role-grid">
          <article>
            <span>Policyholder</span>
            <h3>Manage coverage and claims</h3>
            <p>Purchase policies, submit evidence, track decisions, receive notifications, and appeal rejections.</p>
          </article>
          <article>
            <span>Administrator</span>
            <h3>Operate the insurance system</h3>
            <p>Configure packages, review claims, manage oracle workflows, monitor reserves, and settle payouts.</p>
          </article>
          <article>
            <span>Auditor</span>
            <h3>Independently examine disputes</h3>
            <p>Inspect timelines and evidence, verify document integrity, vote, and build a reputation record.</p>
          </article>
        </div>
      </section>

      <section className="home-cta">
        <div>
          <span>Enter the correct workspace automatically</span>
          <h2>Connect your assigned wallet to continue.</h2>
        </div>
        <button type="button" onClick={connectWallet} disabled={isConnecting}>
          {isConnecting ? "Connecting wallet..." : "Connect wallet"}
        </button>
      </section>
    </div>
  );
}
