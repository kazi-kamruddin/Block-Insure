import { getEtherscanTxUrl } from "../services/contractService";
import CopyableText from "./CopyableText";

export default function TransactionLink({ txHash }) {
  if (!txHash) {
    return <span>-</span>;
  }

  const url = getEtherscanTxUrl(txHash);
  const isLocal = url === "#";

  return (
    <span className="transaction-link">
      <CopyableText value={txHash} label="Copy tx" short />

      {!isLocal ? (
        <>
          {" "}
          <a href={url} target="_blank" rel="noreferrer">
            View
          </a>
        </>
      ) : (
        <span className="muted-text"> local tx</span>
      )}
    </span>
  );
}