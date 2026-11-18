import { useState } from "react";
import { formatEther } from "ethers";
import { Link } from "react-router-dom";

import PolicyTermsPanel from "./PolicyTermsPanel";
import PaymentScheduleNotice from "./PaymentScheduleNotice";
import { getPublicPolicyDocumentUrl } from "../services/api";

export default function PolicyCard({ policyPackage, onBuy, isBuying, riskQuote }) {
  const [termsAccepted, setTermsAccepted] = useState(false);
  const terms = policyPackage.policyTerms;
  const gross = BigInt(terms?.maximumClaimWei || 0);
  const rateDeductible = gross * BigInt(terms?.deductibleRateBps || 0) / 10000n;
  const cap = BigInt(terms?.deductibleCapWei || 0);
  const deductible = rateDeductible < cap ? rateDeductible : cap;
  const liability = (gross - deductible) * BigInt(terms?.coinsuranceBps || 0) / 10000n;
  const document = policyPackage.policyDocument;

  return (
    <div className="card">
      <h3>{policyPackage.name}</h3>

      <p>Type: {policyPackage.policyType}</p>
      <p>Premium: {policyPackage.premiumAmountEth} ETH</p>
      <PaymentScheduleNotice schedule={policyPackage.policyTerms?.paymentSchedule} />
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
      {terms?.authoritative && gross > 0n && <details>
        <summary>Worked reimbursement example</summary>
        <p>For an eligible bill of {formatEther(gross)} test ETH, the deductible is {formatEther(deductible)}.
          The insurer pays {terms.coinsuranceBps / 100}% of the balance, or {formatEther(liability)} test ETH,
          assuming sufficient remaining policy coverage.</p>
        <p>Paid installments establish covered dates. Treatment outside a paid interval or during the waiting period is ineligible.</p>
      </details>}
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
