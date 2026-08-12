import PolicyTermsPanel from "./PolicyTermsPanel";

export default function PolicyCard({ policyPackage, onBuy, isBuying, riskQuote }) {
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

      <button
        type="button"
        onClick={() => onBuy(policyPackage)}
        disabled={isBuying}
      >
        {isBuying ? "Buying..." : "Buy Policy"}
      </button>
    </div>
  );
}
