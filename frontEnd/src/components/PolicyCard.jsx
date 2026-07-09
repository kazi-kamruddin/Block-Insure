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
          <p className="muted-text">Demo quote only; purchase uses the on-chain package premium.</p>
        </div>
      ) : null}
      <p>Coverage: {policyPackage.coverageAmountEth} ETH</p>
      <p>Duration: {policyPackage.durationDays} days</p>
      <p>Required document: {policyPackage.requiredDocumentType}</p>

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
