const fs = require("node:fs"), path = require("node:path");
const { ethers } = require("../backEnd/node_modules/ethers");
const { normalizeReceipt } = require("./networkMeasurement");
async function main() {
  const [manifestPath, outputDirectory] = process.argv.slice(2);
  const url = new URL(process.env.RPC_URL);
  if (!["localhost", "127.0.0.1"].includes(url.hostname)) throw new Error("Capture requires a disposable loopback chain");
  const manifest = JSON.parse(fs.readFileSync(manifestPath));
  const provider = new ethers.JsonRpcProvider(url.toString());
  try {
    if ((await provider.getNetwork()).chainId !== 31337n || Number(manifest.chainId) !== 31337) throw new Error("Capture requires local chain 31337");
    const latest = await provider.getBlockNumber();
    if (latest > 2000) throw new Error("Capture exceeds the reviewed block bound");
    const interfaces = Object.entries(manifest.components).map(([name, address]) => ({ name, address: address.toLowerCase(),
      interface: new ethers.Interface(require(`../contracts/artifacts/contracts/${name}.sol/${name}.json`).abi) }));
    const rows = [];
    for (let height = 1; height <= latest; height++) {
      const block = await provider.getBlock(height, true);
      for (const hash of block.transactions) {
        const transaction = await provider.getTransaction(hash), receipt = await provider.getTransactionReceipt(hash);
        if (!receipt || receipt.blockHash !== block.hash) throw new Error("Noncanonical receipt during capture");
        const target = interfaces.find((item) => item.address === (transaction.to || receipt.contractAddress || "").toLowerCase());
        if (!target) continue;
        let operation = `${target.name}.receive`;
        if (!transaction.to) operation = `deploy.${target.name}`;
        else { try { operation = `${target.name}.${target.interface.parseTransaction(transaction).name}`; } catch { /* plain funding */ } }
        rows.push(normalizeReceipt(receipt, transaction, { operation }, block));
      }
    }
    const contracts = {};
    for (const item of interfaces) { const code = await provider.getCode(item.address); contracts[item.name] = { address: item.address, runtimeBytes: (code.length - 2) / 2, codeHash: ethers.keccak256(code) }; }
    const output = { schema: "block-insure-release-gas-v1", measuredAt: new Date().toISOString(), chainId: "31337", contracts, rows,
      limitations: ["Local Hardhat automining with the repository compiler/hardfork; not public-network latency or fee estimates.",
        "Manager deployment includes internally created modules; deployment rows must not be summed as independent module costs.",
        "Repeated rows are scenario observations, not independent random samples; no submission/finality timing is inferred."] };
    fs.writeFileSync(path.join(outputDirectory, "chain-measurements.json"), JSON.stringify(output, null, 2) + "\n", { flag: "wx" });
    console.log(`Captured ${rows.length} canonical local operation receipts and ${interfaces.length} code identities.`);
  } finally { provider.destroy(); }
}
main().catch(() => { console.error("Local release receipt capture failed; no transaction was sent."); process.exitCode = 1; });
