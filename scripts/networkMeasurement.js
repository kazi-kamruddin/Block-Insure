const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const { ethers } = require("../backEnd/node_modules/ethers");
function normalizeReceipt(receipt, transaction, item, block) {
  const actualPrice = receipt.effectiveGasPrice ?? transaction.gasPrice;
  if (actualPrice == null) throw new Error("Actual execution gas price unavailable");
  const gas = BigInt(receipt.gasUsed), price = BigInt(actualPrice);
  const l1Fee = receipt.l1Fee == null ? null : BigInt(receipt.l1Fee);
  const executionFeeWei = gas * price;
  const submitted = item.submittedAt ? Date.parse(item.submittedAt) : NaN;
  return { operation: item.operation, transactionHash: transaction.hash, successful: BigInt(receipt.status) === 1n,
    blockNumber: Number(BigInt(receipt.blockNumber)), contractAddress: receipt.contractAddress || null,
    gasUsed: gas.toString(), effectiveGasPriceWei: price.toString(), executionFeeWei: executionFeeWei.toString(),
    l1DataFeeWei: l1Fee?.toString() ?? null, executionPlusKnownDataFeeWei: l1Fee == null ? null : (executionFeeWei + l1Fee).toString(),
    blockTimestamp: new Date(Number(BigInt(block.timestamp)) * 1000).toISOString(),
    observedSubmissionToBlockMs: Number.isFinite(submitted) ? Number(BigInt(block.timestamp)) * 1000 - submitted : null,
    timingMeaning: "Optional user-recorded submission to block timestamp; not finality, server latency or RPC receipt retrieval time" };
}
async function main() {
  const args = require("./operatorArguments").parseOperatorArguments(process.argv.slice(2), {
    values: ["--manifest", "--transactions", "--output"], required: ["--manifest", "--transactions", "--output"],
  });
  const output = path.resolve(args["--output"]), csvOutput = output.replace(/\.json$/i, ".csv");
  if (!/\.json$/i.test(output) || fs.existsSync(output) || fs.existsSync(csvOutput)) throw new Error("Choose a new .json output path; existing results are preserved");
  const manifestBytes = fs.readFileSync(path.resolve(args["--manifest"])), manifest = JSON.parse(manifestBytes);
  const items = JSON.parse(fs.readFileSync(path.resolve(args["--transactions"]), "utf8"));
  if (!Array.isArray(items) || items.length < 1 || items.length > 200 || items.some((v) => !/^0x[0-9a-f]{64}$/i.test(v.transactionHash) || !/^[\w .:-]{1,80}$/.test(v.operation) || v.submittedAt && !Number.isFinite(Date.parse(v.submittedAt)))) throw new Error("Invalid bounded measurement input");
  if (!process.env.RPC_URL) throw new Error("Set the matching RPC_URL explicitly");
  const rpc = new URL(process.env.RPC_URL);
  if (Number(manifest.chainId) !== 31337 && rpc.protocol !== "https:") throw new Error("Public testnet requires HTTPS RPC");
  const transport = new ethers.FetchRequest(process.env.RPC_URL); transport.timeout = 10000;
  const provider = new ethers.JsonRpcProvider(transport);
  try {
    const network = await provider.getNetwork();
    if (![31337n, 11155111n, 84532n].includes(network.chainId) || network.chainId !== BigInt(manifest.chainId)) throw new Error("Network differs from reviewed manifest");
    const rows = [];
    for (const item of items) {
      const receipt = await provider.send("eth_getTransactionReceipt", [item.transactionHash]);
      const transaction = await provider.send("eth_getTransactionByHash", [item.transactionHash]);
      if (!receipt || !transaction || receipt.blockHash !== transaction.blockHash ||
          String(receipt.transactionHash).toLowerCase() !== item.transactionHash.toLowerCase() ||
          String(transaction.hash).toLowerCase() !== item.transactionHash.toLowerCase()) throw new Error("Receipt unavailable or inconsistent");
      const block = await provider.send("eth_getBlockByHash", [receipt.blockHash, false]);
      const canonical = await provider.send("eth_getBlockByNumber", [receipt.blockNumber, false]);
      if (!block || canonical?.hash !== receipt.blockHash) throw new Error("Receipt block is no longer canonical");
      rows.push(normalizeReceipt(receipt, transaction, item, block));
    }
    const report = { schema: "block-insure-network-measurement-v1", measuredAt: new Date().toISOString(), chainId: String(network.chainId),
      manifestSha256: crypto.createHash("sha256").update(manifestBytes).digest("hex"), deploymentModelIdentity: manifest.modelIdentityHash || null,
      rows, limitations: "Testnet observations, not mainnet price estimates. Missing L1 data fee is unknown, never zero. executionPlusKnownDataFee is not universally all-in (operator/other chain fees may apply). Rows are not an additive lifecycle; no finality assertion." };
    fs.mkdirSync(path.dirname(output), { recursive: true }); fs.writeFileSync(output, JSON.stringify(report, null, 2) + "\n", { flag: "wx" });
    const columns = Object.keys(rows[0]);
    const quote = (v) => `"${String(v ?? "").replaceAll('"', '""')}"`;
    fs.writeFileSync(csvOutput, [columns.join(","), ...rows.map((r) => columns.map((c) => quote(r[c])).join(","))].join("\n") + "\n", { flag: "wx" });
    console.log(`Recorded ${rows.length} real receipts on chain ${network.chainId}. No transactions sent.`);
  } finally { provider.destroy(); }
}
if (require.main === module) main().catch(() => { console.error("Measurement failed: check explicit input paths, RPC, chain and canonical receipts. No transaction was sent."); process.exitCode = 1; });
module.exports = { normalizeReceipt };
