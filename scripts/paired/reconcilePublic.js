const fs = require("node:fs");
const path = require("node:path");
const { ethers } = require("../../backEnd/node_modules/ethers");
const { digest } = require("./manifest");
const { providerFor } = require("./runner");

async function reconcile({ provider, plan, campaign, funding }) {
  if (!campaign.complete || campaign.local || campaign.chainId !== plan.chainId) throw new Error("Reconciliation requires a finished public campaign");
  const anchors = Object.entries({ ...plan.actors, ...campaign.componentAddresses });
  const endNumber = Math.max(...campaign.rows.map(({ blockNumber }) => blockNumber));
  const last = await provider.getBlock(endNumber);
  if (!last || last.hash !== campaign.rows.at(-1).blockHash) throw new Error("The last campaign receipt is no longer canonical");
  const accounts = new Map(await Promise.all(anchors.map(async ([name, address]) => {
    const [start, end] = await Promise.all([provider.getBalance(address, plan.preflightBlock), provider.getBalance(address, endNumber)]);
    return [address.toLowerCase(), { name, address, start, end, fees: 0n, inflows: 0n, outflows: 0n }];
  })));
  if (accounts.size !== anchors.length) throw new Error("Campaign has overlapping reconciliation addresses");
  const byHash = new Set();
  const fundingRows = funding.map((row) => ({ ...row, transactionHash: row.hash,
    transfers: [{ from: row.from, to: row.to, valueWei: row.valueWei }] }));
  for (const row of [...campaign.rows, ...fundingRows]) {
    if (byHash.has(row.transactionHash)) throw new Error("Duplicate transaction in wallet reconciliation");
    byHash.add(row.transactionHash);
    const components = campaign.chainId === 84532 ? [row.executionFeeWei, row.l1DataFeeWei, row.operatorFeeWei] : [row.executionFeeWei];
    if (components.some((component) => component == null)) throw new Error("Wallet reconciliation requires all actual fee components");
    const payer = accounts.get(row.from.toLowerCase());
    if (!payer) throw new Error("Receipt signer is outside the campaign balance sheet");
    payer.fees += components.reduce((fee, component) => fee + BigInt(component), 0n);
    for (const transfer of row.transfers ?? []) {
      const from = accounts.get(transfer.from.toLowerCase()), to = accounts.get(transfer.to.toLowerCase());
      if (!from || !to) throw new Error("Transfer escapes the campaign balance sheet");
      const value = BigInt(transfer.valueWei);
      from.outflows += value;
      to.inflows += value;
    }
  }
  const wallets = [...accounts.values()].map((row) => ({ ...row, residue: row.end - (row.start + row.inflows - row.outflows - row.fees) }));
  const admin = wallets.find(({ name }) => name === "admin");
  const adminOutflow = admin.fees + admin.outflows;
  const peakFloorVerified = admin.inflows === 0n && admin.end >= BigInt(plan.retainedAdminWei);
  return { schema: "block-insure-paired-public-reconciliation/v1", chainId: campaign.chainId,
    offchainInputSource: campaign.offchainInputSource, sourceCommit: campaign.sourceCommit, campaignPlanHash: campaign.planHash,
    startBlock: plan.preflightBlock, startingAdminWei: admin.start, retainedAdminWei: BigInt(plan.retainedAdminWei),
    ceilingWei: BigInt(plan.spendingCeilingWei), endBlock: endNumber, endBlockHash: last.hash, transactions: byHash.size,
    adminOutflowWei: adminOutflow, endingAdminWei: admin.end, floorVerified: peakFloorVerified,
    feesWei: wallets.reduce((total, row) => total + row.fees, 0n),
    reconciled: wallets.every(({ residue }) => residue === 0n) && peakFloorVerified && adminOutflow <= BigInt(plan.maxAdminOutflowWei), wallets };
}

if (require.main === module) (async () => {
  const opts = require("../operatorArguments").parseOperatorArguments(process.argv.slice(2), { values: ["--directory"], required: ["--directory"] });
  const directory = path.resolve(opts["--directory"]);
  const load = (name) => fs.readFileSync(path.join(directory, name));
  const bytes = load("run-plan.json");
  const plan = JSON.parse(bytes);
  const campaign = JSON.parse(load("campaign.json"));
  if (digest(bytes) !== campaign.planHash) throw new Error("Wallet reconciliation plan differs from the measured plan");
  const provider = providerFor(plan.chainId === 84532 ? "https://sepolia.base.org" : "https://sepolia.gateway.tenderly.co", plan.chainId, false);
  try {
    const report = await reconcile({ provider, plan, campaign, funding: JSON.parse(load("funding-receipts.json")) });
    fs.writeFileSync(path.join(directory, "reconciliation.json"), JSON.stringify(report, (_, item) => typeof item === "bigint" ? String(item) : item, 2) + "\n", { flag: "wx" });
    console.log(JSON.stringify({ chainId: plan.chainId, reconciled: report.reconciled, floorVerified: report.floorVerified }));
    if (!report.reconciled) process.exitCode = 1;
  } finally { provider.destroy(); }
})().catch((error) => {
  console.error("Public wallet reconciliation stopped: " + String(error.code ?? error.message).replace(/https?:\/\/\S+|0x[a-f0-9]{64,}/gi, "[private]"));
  process.exitCode = 1;
});

module.exports = { reconcile };
