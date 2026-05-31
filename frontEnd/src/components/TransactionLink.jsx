import { getEtherscanTxUrl } from "../services/contractService";

export default function TransactionLink({ txHash }) {
  if (!txHash) return <span>-</span>;

  const url = getEtherscanTxUrl(txHash);

  if (url === "#") {
    return <code>{txHash}</code>;
  }

  return (
    <a href={url} target="_blank" rel="noreferrer">
      {txHash.slice(0, 10)}...{txHash.slice(-8)}
    </a>
  );
}