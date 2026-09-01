import { useState } from "react";
import { Link } from "react-router-dom";

import PolicyTermsPanel from "./PolicyTermsPanel";
import { getPublicPolicyDocumentUrl } from "../services/api";

export default function PolicyCard({ policyPackage, onBuy, isBuying, riskQuote }) {
  const [termsAccepted, setTermsAccepted] = useState(false);
  const document = policyPackage.policyDocument;

  return (
    <div className="card">
      <h3>{policyPackage.name}</h3>

      <p>Type: {policyPackage.policyType}</p>
      <p>Premium: {policyPackage.premiumAmountEth} ETH</p>
      {riskQuote ? (
        <div className="risk-premium-summary">
          <p>Risk multiplier: {riskQuote.multiplier}x</p>
          <p>Risk-adjusted quote: {riskQuote.finalPremiumEth} ETH</p>
          <p className="muted-text">
            Calculation: {riskQuote.basePremiumEth || policyPackage.premiumAmountEth} ETH
            {" × "}{riskQuote.multiplier} = {riskQuote.finalPremiumEth} ETH.
          </p>
          <strong className="warning-text">
            Simulation only. MetaMask will charge the on-chain base premium of{" "}
            {policyPackage.premiumAmountEth} ETH.
          </strong>
        </div>
      ) : null}
      <p>Coverage: {policyPackage.coverageAmountEth} ETH</p>
      <p>Duration: {policyPackage.durationDays} days</p>
      <p>Required document: {policyPackage.requiredDocumentType}</p>
      <PolicyTermsPanel terms={policyPackage.policyTerms} />
      <div className="policy-document-actions">
        <Link to={`/policies/${policyPackage.packageId}`} target="_blank">
          Read Full Policy
        </Link>
        <a
          href={getPublicPolicyDocumentUrl(policyPackage.packageId, {
            download: true,
          })}
        >
          Download Terms
        </a>
      </div>
      <label className="policy-acceptance-control">
        <input
          type="checkbox"
          checked={termsAccepted}
          onChange={(event) => setTermsAccepted(event.target.checked)}
          disabled={!document || isBuying}
        />
        <span>
          I have read and agree to policy terms v{document?.documentVersion || "-"}.
        </span>
      </label>
      {document ? (
        <small className="policy-document-hash">
          Document commitment: {document.documentHash.slice(0, 14)}…
        </small>
      ) : null}
      <button
        type="button"
        onClick={() => onBuy(policyPackage)}
        disabled={isBuying || !termsAccepted || !document}
      >
        {isBuying ? "Buying..." : "Buy Policy"}
      </button>
    </div>
  );
}
