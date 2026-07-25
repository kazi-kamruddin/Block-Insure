import { useState } from "react";

import CopyableText from "./CopyableText";
import {
  downloadDecryptedEvidence,
  hasLocalEvidenceKey,
} from "../services/evidenceEncryption";

const DEFAULT_GATEWAY =
  import.meta.env.VITE_IPFS_GATEWAY || "https://gateway.pinata.cloud/ipfs/";

function buildIpfsUrl(cid) {
  if (!cid) return "#";

  const cleanCid = String(cid).replace("ipfs://", "");
  const gateway = DEFAULT_GATEWAY.endsWith("/")
    ? DEFAULT_GATEWAY
    : `${DEFAULT_GATEWAY}/`;

  return `${gateway}${cleanCid}`;
}

export default function IpfsLink({ cid }) {
  const [decryptError, setDecryptError] = useState("");

  if (!cid) {
    return <span>-</span>;
  }

  return (
    <span className="ipfs-link">
      <CopyableText value={cid} label="Copy CID" short />
      {" "}
      <a href={buildIpfsUrl(cid)} target="_blank" rel="noreferrer">
        Open encrypted IPFS payload
      </a>
      {hasLocalEvidenceKey(cid) ? (
        <>
          {" "}
          <button
            type="button"
            onClick={async () => {
              setDecryptError("");

              try {
                await downloadDecryptedEvidence(cid, DEFAULT_GATEWAY);
              } catch (error) {
                setDecryptError(error.message);
              }
            }}
          >
            Download decrypted
          </button>
        </>
      ) : null}
      {decryptError ? <span className="error-text"> {decryptError}</span> : null}
    </span>
  );
}
