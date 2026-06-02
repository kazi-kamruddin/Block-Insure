import CopyableText from "./CopyableText";

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
  if (!cid) {
    return <span>-</span>;
  }

  return (
    <span className="ipfs-link">
      <CopyableText value={cid} label="Copy CID" short />
      {" "}
      <a href={buildIpfsUrl(cid)} target="_blank" rel="noreferrer">
        Open IPFS
      </a>
    </span>
  );
}