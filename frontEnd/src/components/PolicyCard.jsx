import { useState } from "react";
import { formatEther, id } from "ethers";
import { Link } from "react-router-dom";

import PolicyTermsPanel from "./PolicyTermsPanel";
import PaymentScheduleNotice from "./PaymentScheduleNotice";
import { getPublicPolicyDocumentUrl } from "../services/api";

export default function PolicyCard({ policyPackage, onBuy, isBuying, riskQuote }) {
  const [termsAccepted, setTermsAccepted] = useState(false);
  const terms = policyPackage.policyTerms;
  const gross = BigInt(terms?.maximumClaimWei || 0);
  const service = terms?.coveredClaimTypes?.[0];
  const serviceLimit = service && terms?.serviceSublimitsWei?.[id(service)];
  const eligible = serviceLimit && BigInt(serviceLimit) < gross ? BigInt(serviceLimit) : gross;
  const rateDeductible = eligible * BigInt(terms?.deductibleRateBps || 0) / 10000n;
  const cap = BigInt(terms?.deductibleCapWei || 0);
  const deductible = rateDeductible < cap ? rateDeductible : cap;
  const liability = (eligible - deductible) * BigInt(terms?.coinsuranceBps || 0) / 10000n;
  const document = policyPackage.policyDocument;

  return (
    <div className="card">
      <h3>{policyPackage.name}</h3>

      <dl className="detail-kv-grid">
        <div>
          <dt>Type</dt>
          <dd>{policyPackage.policyType}</dd>
        </div>
        <div>
          <dt>Premium</dt>
          <dd>{policyPackage.premiumAmountEth} ETH</dd>
        </div>
        <div>
          <dt>Coverage</dt>
          <dd>{policyPackage.coverageAmountEth} ETH</dd>
        </div>
        <div>
          <dt>Duration</dt>
          <dd>{policyPackage.durationDays} days</dd>
        </div>
        <div>
          <dt>Required document</dt>
          <dd>{policyPackage.requiredDocumentType}</dd>
        </div>
      </dl>

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
      {terms?.authoritative && gross > 0n && <details>
        <summary>Worked reimbursement example</summary>
        <p>For a bill of {formatEther(gross)} test ETH{serviceLimit ? ` for ${service}, the eligible amount is ${formatEther(eligible)} test ETH` : ""}, the deductible is {formatEther(deductible)}.
          The insurer pays {terms.coinsuranceBps / 100}% of the balance, or {formatEther(liability)} test ETH,
          assuming sufficient remaining policy coverage.</p>
        <p>Paid installments establish covered dates. Treatment outside a paid interval or during the waiting period is ineligible.</p>
      </details>}
      <PolicyTermsPanel terms={policyPackage.policyTerms} />
      <div className="policy-document-actions">
        <Link to={`/policies/${policyPackage.packageId}`} target="_blank" rel="noopener noreferrer">
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
      <p className="muted-text">
        Purchasing opens MetaMask to confirm the base premium of {policyPackage.premiumAmountEth} ETH on-chain.
      </p>
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
