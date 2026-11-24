const fs = require("node:fs");
const { ethers } = require("../../backEnd/node_modules/ethers");
const { parseOperatorArguments } = require("../operatorArguments");
const { decodeEnvelope } = require("./receipt");

function connect(url) {
  const endpoint = new URL(url);
  if (endpoint.protocol !== "https:") throw new Error("Read-only pricing requires HTTPS RPC");
  const request = new ethers.FetchRequest(endpoint.href);
  request.timeout = 10000;
  return new ethers.JsonRpcProvider(request, undefined, { batchMaxCount: 1 });
}

async function snapshot(provider, chainId, source, windowSize) {
  if ((await provider.getNetwork()).chainId !== BigInt(chainId)) throw new Error("Pricing RPC returned wrong chain");
  const block = await provider.getBlock("finalized");
  if (block?.baseFeePerGas == null) throw new Error("Pricing block has no base fee");
  const start = block.number - windowSize + 1;
  const history = await provider.send("eth_feeHistory", [
    ethers.toQuantity(windowSize), ethers.toQuantity(block.number), [],
  ]);
  if (Number(BigInt(history.oldestBlock)) !== start || history.baseFeePerGas?.length !== windowSize + 1 ||
      BigInt(history.baseFeePerGas[windowSize - 1]) !== block.baseFeePerGas) {
    throw new Error("Pricing history does not match the anchored block");
  }
  const samples = history.baseFeePerGas.slice(0, windowSize).map(BigInt);
  const sorted = [...samples].sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
  const midpoint = (sorted[Math.floor((sorted.length - 1) / 2)] + sorted[Math.floor(sorted.length / 2)]) / 2n;
  const first = await provider.getBlock(start);
  if (!first || first.baseFeePerGas !== samples[0]) throw new Error("Pricing history start does not match the anchor");
  return { chainId, source, method: "Median EIP-1559 base fee, zero priority fee",
    observedAt: new Date(block.timestamp * 1000).toISOString(), block: block.number, blockHash: block.hash,
    window: { startBlock: start, startHash: first.hash, endBlock: block.number, baseFeesWei: samples.map(String) },
    executionPriceWei: String(midpoint) };
}

async function priceCampaign({ campaign, ethereum, base, baseSepolia }) {
  const local = campaign.local === true;
  if ((!local && (campaign.chainId !== 84532 || (await baseSepolia.getNetwork()).chainId !== 84532n)) ||
      (local && (![31337, 11155111].includes(campaign.chainId) || campaign.fork?.start?.source !== "contracts/hardhat.config.js"))) {
    throw new Error("Pricing requires a Base Sepolia campaign or an explicit Hardhat rehearsal");
  }
  const [l1, l2] = await Promise.all([
    snapshot(ethereum, 1, "https://ethereum.org/developers/docs/gas/", 24),
    snapshot(base, 8453, "https://docs.base.org/specifications/transactions/network-fees", 24),
  ]);
  const feeOracle = new ethers.Contract("0x420000000000000000000000000000000000000F", [
    "function getL1Fee(bytes) view returns(uint256)", "function getOperatorFee(uint256) view returns(uint256)",
  ], base);
  const quotes = {};
  async function quote(row) {
    if (row.status !== "confirmed" || row.unsignedBytes == null) return;
    let envelope;
    if (local) {
      try { envelope = ethers.Transaction.from(row.localSignedEnvelope); } catch { return; }
    } else {
      const tx = await baseSepolia.send("eth_getTransactionByHash", [row.transactionHash]).catch(() => null);
      if (tx?.blockHash?.toLowerCase() !== row.blockHash.toLowerCase()) return;
      envelope = decodeEnvelope(tx);
    }
    if (envelope?.hash?.toLowerCase() !== row.transactionHash.toLowerCase() || envelope.chainId !== BigInt(campaign.chainId) ||
        (envelope.unsignedSerialized.length - 2) / 2 !== row.unsignedBytes) return;
    const [l1Fee, operatorFee] = await Promise.allSettled([
      feeOracle.getL1Fee(envelope.unsignedSerialized, { blockTag: l2.block }),
      feeOracle.getOperatorFee(row.gasUsed, { blockTag: l2.block }),
    ]);
    quotes[row.transactionHash.toLowerCase()] = { block: l2.block, unsignedBytes: row.unsignedBytes,
      unsignedEncodingHash: ethers.keccak256(envelope.unsignedSerialized),
      basis: "GasPriceOracle.getL1Fee(unsignedEnvelope)",
      l1DataFeeWei: l1Fee.status === "fulfilled" ? String(l1Fee.value) : null,
      operatorFeeWei: operatorFee.status === "fulfilled" ? String(operatorFee.value) : null };
  }
  for (let offset = 0; offset < campaign.rows.length; offset += 4) {
    await Promise.all(campaign.rows.slice(offset, offset + 4).map(quote));
  }
  if ((await base.getBlock(l2.block))?.hash !== l2.blockHash || (await ethereum.getBlock(l1.block))?.hash !== l1.blockHash) {
    throw new Error("A pricing reference block moved while sampling");
  }
  const [header, config] = await Promise.all([
    ethereum.send("eth_getBlockByNumber", [ethers.toQuantity(l1.block), false]), ethereum.send("eth_config", []).catch(() => null),
  ]);
  l1.gasSchedule = header?.blockAccessListHash && header?.slotNumber != null ? "Amsterdam" :
    config?.current?.forkId === "0x07c9462e" ? "Osaka/BPO2" : "Pre-Amsterdam at sampled header";
  l1.forkId = config?.current?.forkId ?? null;
  return { schema: "block-insure-mainnet-pricing/v1", manifestHash: campaign.manifestHash,
    sampledAt: new Date().toISOString(), scope: local ? "Mainnet pricing applied to local execution and local transaction encodings" : "Mainnet pricing applied to public testnet receipts",
    ...(campaign.offchainInputSource && { offchainInputSource: campaign.offchainInputSource }),
    ethereum: l1, base: { ...l2, transactionQuotes: quotes } };
}

async function main() {
  const args = parseOperatorArguments(process.argv.slice(2), {
    values: ["--base-campaign", "--output"], required: ["--base-campaign", "--output"],
  });
  if (fs.existsSync(args["--output"])) throw new Error("Pricing output already exists");
  const campaign = JSON.parse(fs.readFileSync(args["--base-campaign"], "utf8"));
  const providers = ["ETHEREUM_MAINNET_RPC_URL", "BASE_MAINNET_RPC_URL", ...(!campaign.local ? ["BASE_SEPOLIA_RPC_URL"] : [])]
    .map((key) => connect(process.env[key]));
  try {
    const [ethereum, base, baseSepolia] = providers;
    const result = await priceCampaign({ campaign, ethereum, base, baseSepolia });
    fs.writeFileSync(args["--output"], JSON.stringify(result, null, 2) + "\n", { flag: "wx" });
  } finally { providers.forEach((provider) => provider.destroy()); }
}

if (require.main === module) main().catch(() => { console.error("Mainnet pricing failed; check the selected RPCs and Base campaign privately."); process.exitCode = 1; });
module.exports = { priceCampaign, snapshot };
