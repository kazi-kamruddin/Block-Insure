export default function PolicyCard({ policyPackage, onBuy, isBuying }) {
  return (
    <div className="card">
      <h3>{policyPackage.name}</h3>

      <p>Type: {policyPackage.policyType}</p>
      <p>Premium: {policyPackage.premiumAmountEth} ETH</p>
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