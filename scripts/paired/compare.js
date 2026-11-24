const fs = require("node:fs");
const path = require("node:path");
const { readManifest } = require("./manifest");

const integer = (value) => value == null ? null : BigInt(value);
const sum = (values) => !values.length || values.some((value) => value == null) ? null : values.reduce((total, value) => total + BigInt(value), 0n);
const str = (value) => value == null ? null : value.toString();

function ratio(left, right) {
  if (left == null || right == null || BigInt(right) === 0n) return null;
  const scaled = (BigInt(left) * 1000000000n + BigInt(right) / 2n) / BigInt(right);
  return Number(scaled) / 1e9;
}

function pricingInput(pricing) {
  if (!pricing) return null;
  for (const [key, chainId] of [["ethereum", 1], ["base", 8453]]) {
    const item = pricing[key];
    if (!item || item.chainId !== chainId || !/^https:\/\//.test(item.source) ||
        !Number.isFinite(Date.parse(item.observedAt)) || !Number.isSafeInteger(item.block) || item.block < 1 ||
        !/^[1-9]\d*$/.test(item.executionPriceWei)) throw new Error("Invalid mainnet pricing snapshot");
  }
  return pricing;
}

function measured(row, l2, local) {
  if (row.executionFeeWei == null) return null;
  if (!l2 || local) return integer(row.executionFeeWei);
  return sum([row.executionFeeWei, row.l1DataFeeWei, row.operatorFeeWei]);
}

function projected(row, key, pricing) {
  if (!pricing || key === "base" && !row.transactionHash) return null;
  const pricingRow = pricing[key];
  const execution = BigInt(row.gasUsed) * BigInt(pricingRow.executionPriceWei);
  if (key === "ethereum") return execution;
  const quote = pricingRow.transactionQuotes?.[row.transactionHash.toLowerCase()];
  if (!quote || quote.block !== pricingRow.block || quote.basis !== "GasPriceOracle.getL1Fee(unsignedEnvelope)" ||
      quote.unsignedBytes !== row.unsignedBytes || row.unsignedBytes == null) return null;
  return sum([execution, quote.l1DataFeeWei, quote.operatorFeeWei]);
}

function feeBasis(row) {
  const transfer = row.transfers?.find(({ kind }) => ["payout", "refund"].includes(kind));
  if (transfer) return { kind: transfer.kind, valueWei: transfer.valueWei };
  if (row.category === "premium" && ["purchasePolicyWithTerms", "payPremium", "confirmEftTransfer"].includes(row.function) &&
      BigInt(row.valueWei ?? 0) > 0n) return { kind: "premium", valueWei: row.valueWei };
  return null;
}

function timing(rows, key) {
  const values = rows.map((row) => row[key]).filter((value) => typeof value === "number" && Number.isFinite(value)).sort((a, b) => a - b);
  if (!values.length) return { n: 0, medianMs: null, rangeMs: null };
  const middle = Math.floor(values.length / 2);
  return { n: values.length, medianMs: values.length % 2 ? values[middle] : (values[middle - 1] + values[middle]) / 2,
    rangeMs: [values[0], values.at(-1)] };
}

function summarize(items) {
  const left = sum(items.map((item) => item.l1GasUsed));
  const right = sum(items.map((item) => item.l2GasUsed));
  return {
    n: items.length,
    l1GasUsed: str(left), l2GasUsed: str(right), gasRatio: ratio(left, right),
    l1MeasuredFeeWei: str(sum(items.map((item) => item.l1MeasuredFeeWei))),
    l2MeasuredFeeWei: str(sum(items.map((item) => item.l2MeasuredFeeWei))),
    l1ProjectedFeeWei: str(sum(items.map((item) => item.l1ProjectedFeeWei))),
    l2ProjectedFeeWei: str(sum(items.map((item) => item.l2ProjectedFeeWei))),
  };
}

function classifyDiscrepancy(l1, l2, evidence) {
  if (!l1?.gasUsed || !l2?.gasUsed) return null;
  const left = BigInt(l1.gasUsed), right = BigInt(l2.gasUsed);
  if (right === 0n || left * 100n <= right * 105n && left * 100n >= right * 95n) return null;
  if (evidence && ["explained by protocol pricing", "state difference"].includes(evidence.reason) &&
      typeof evidence.evidence === "string" && evidence.evidence.trim()) {
    return { reason: evidence.reason, evidence: evidence.evidence };
  }
  return { reason: "unexplained", evidence: null };
}

function rowMap(campaign, manifestHash) {
  if (!Array.isArray(campaign.rows)) throw new Error("Invalid campaign rows");
  const rows = new Map();
  const hashes = new Set();
  for (const row of campaign.rows) {
    if (row.manifestHash !== manifestHash || Number(row.chainId) !== Number(campaign.chainId) ||
        rows.has(row.operationId) || !/^0x[a-f\d]{64}$/i.test(row.transactionHash) ||
        hashes.has(row.transactionHash.toLowerCase())) throw new Error("Duplicated or out-of-scope receipt");
    rows.set(row.operationId, row);
    hashes.add(row.transactionHash.toLowerCase());
  }
  return rows;
}

function compare(manifest, manifestHash, l1, l2, options = {}) {
  if (l1.manifestHash !== manifestHash || l2.manifestHash !== manifestHash || l1.local !== l2.local ||
      l1.sourceCommit !== l2.sourceCommit || l1.sourceDeltaSha256 !== l2.sourceDeltaSha256 || l1.configurationHash !== l2.configurationHash ||
      l1.chainId === l2.chainId || (!l1.local && (Number(l1.chainId) !== 11155111 || Number(l2.chainId) !== 84532))) {
    throw new Error("Campaign sources, modes, chains or configurations differ");
  }
  const pricing = pricingInput(options.pricing);
  if (pricing?.manifestHash && pricing.manifestHash !== manifestHash) throw new Error("Pricing snapshot is bound to a different manifest");
  const paired = [], excluded = [];
  const left = rowMap(l1, manifestHash), right = rowMap(l2, manifestHash);
  const sourceRows = { l1: [], l2: [] };
  for (const step of manifest.operations.filter((op) => op.kind === "transaction")) {
    const a = left.get(step.id), b = right.get(step.id);
    left.delete(step.id);
    right.delete(step.id);
    const discrepancy = classifyDiscrepancy(a, b, options.explanations?.[step.id]);
    let reason;
    if (!a || !b) reason = "missing counterpart";
    else if (a.status !== "confirmed" || b.status !== "confirmed") reason = "unsuccessful transaction";
    else if (a.signerRole !== step.role || b.signerRole !== step.role || a.function !== step.method || b.function !== step.method ||
      a.category !== step.category || b.category !== step.category || !a.operationFingerprint ||
      a.operationFingerprint !== b.operationFingerprint || a.valueWei !== b.valueWei ||
      (a.request?.modelIdentity ?? null) !== (b.request?.modelIdentity ?? null) ||
      (a.request?.registryVersion ?? null) !== (b.request?.registryVersion ?? null) ||
      (a.request?.registryRoot ?? null) !== (b.request?.registryRoot ?? null)) reason = "different operation, signer, value or pinned request context";
    if (reason) {
      excluded.push({ operationId: step.id, reason, discrepancy, l1: a ?? null, l2: b ?? null });
      continue;
    }
    const basisA = feeBasis(a), basisB = feeBasis(b);
    if (JSON.stringify(basisA) !== JSON.stringify(basisB)) {
      excluded.push({ operationId: step.id, reason: "different value moved", discrepancy, l1: a, l2: b });
      continue;
    }
    const fees = [measured(a, false, l1.local), measured(b, true, l2.local),
      projected(a, "ethereum", pricing), projected(b, "base", pricing)];
    const gasRatio = ratio(a.gasUsed, b.gasUsed);
    paired.push({
      operationId: step.id, category: step.category, component: step.target, function: step.method, signerRole: step.role,
      l1GasUsed: a.gasUsed, l2GasUsed: b.gasUsed, gasRatio,
      l1MeasuredFeeWei: str(fees[0]), l2MeasuredFeeWei: str(fees[1]),
      l1ProjectedFeeWei: str(fees[2]), l2ProjectedFeeWei: str(fees[3]),
      valueKind: basisA?.kind ?? null, valueWei: basisA?.valueWei ?? null,
      l1MeasuredFeeShare: ratio(fees[0], basisA?.valueWei), l2MeasuredFeeShare: ratio(fees[1], basisA?.valueWei),
      l1ProjectedFeeShare: ratio(fees[2], basisA?.valueWei), l2ProjectedFeeShare: ratio(fees[3], basisA?.valueWei),
      l2ExecutionFeeWei: b.executionFeeWei, l2L1DataFeeWei: b.l1DataFeeWei, l2OperatorFeeWei: b.operatorFeeWei,
      discrepancy,
    });
    if (step.category !== "bootstrap") { sourceRows.l1.push(a); sourceRows.l2.push(b); }
  }
  for (const [operationId, row] of left) excluded.push({ operationId, reason: "outside manifest", l1: row, l2: null });
  for (const [operationId, row] of right) excluded.push({ operationId, reason: "outside manifest", l1: null, l2: row });
  const workflows = paired.filter((item) => item.category !== "bootstrap");
  const bootstrap = paired.filter((item) => item.category === "bootstrap");
  return {
    schema: "block-insure-paired-comparison/v1", manifestHash, sourceCommit: l1.sourceCommit,
    sourceDeltaSha256: l1.sourceDeltaSha256 ?? null, local: l1.local,
    fork: { l1: l1.fork ?? null, l2: l2.fork ?? null },
    pricing, paired, excluded,
    complete: excluded.length === 0 && paired.length === manifest.operations.filter((step) => step.kind === "transaction").length,
    workflowTotals: summarize(workflows),
    deploymentTotals: summarize(bootstrap),
    deploymentContracts: Object.fromEntries(bootstrap.filter((item) => item.function === "constructor")
      .map((item) => [item.component, summarize([item])])),
    categories: Object.fromEntries([...new Set(workflows.map((item) => item.category))].map((name) =>
      [name, summarize(workflows.filter((item) => item.category === name))])),
    latency: Object.fromEntries(Object.entries(sourceRows).map(([key, rows]) => [key, {
      firstReceipt: timing(rows, "submissionToFirstReceiptMs"), finalizedUpperBound: timing(rows, "observedFinalityUpperMs"),
    }])),
    limitations: [
      "Ratios include matched successful operations only. Measured testnet fees describe the sampled testnets.",
      "Base mainnet projections require a pinned fee-oracle quote for each transaction’s canonical unsigned encoding. Missing fees stay unknown.",
      "Receipt gas may include chain-specific state accounting. A discrepancy above 5% requires evidence.",
      "Nested contract creations charged in the parent's receipt cannot be split into separate receipt fees.",
      "Latency uses polling observations on both chains. Finality is the first observation of a canonical finalized head.",
    ],
  };
}

function writeComparison(report, output) {
  fs.mkdirSync(output);
  const columns = ["recordType", "operationId", "category", "component", "function", "signerRole", "l1GasUsed", "l2GasUsed", "gasRatio", "l1MeasuredFeeWei",
    "l2MeasuredFeeWei", "l2ExecutionFeeWei", "l2L1DataFeeWei", "l2OperatorFeeWei", "l1ProjectedFeeWei", "l2ProjectedFeeWei",
    "valueKind", "valueWei", "l1MeasuredFeeShare", "l2MeasuredFeeShare", "l1ProjectedFeeShare", "l2ProjectedFeeShare",
    "l1ExecutionFork", "l2ExecutionFork", "l1PricingEips", "l2PricingEips", "reason", "gasDiscrepancy", "evidence"];
  const display = (value) => value ?? "unknown";
  const csv = (value) => '"' + String(value ?? "").replaceAll('"', '""') + '"';
  const summaries = [
    ["Workflow total", report.workflowTotals], ["Bootstrap total", report.deploymentTotals],
    ...Object.entries(report.categories).map(([name, row]) => ["Workflow " + name, row]),
    ...Object.entries(report.deploymentContracts).map(([name, row]) => ["Create " + name, row]),
  ];
  const [l1Fork, l2Fork] = [report.fork.l1?.start, report.fork.l2?.start];
  const forkFields = {
    l1ExecutionFork: l1Fork?.executionFork, l2ExecutionFork: l2Fork?.executionFork,
    l1PricingEips: l1Fork?.pricingEips?.join(", "), l2PricingEips: l2Fork?.pricingEips?.join(", "),
  };
  const forkLines = [
    "L1 execution fork " + display(forkFields.l1ExecutionFork) + ", pricing EIPs " + display(forkFields.l1PricingEips),
    "L2 execution fork " + display(forkFields.l2ExecutionFork) + ", pricing EIPs " + display(forkFields.l2PricingEips),
  ];
  const records = [
    ...report.paired.map((row) => ({ ...row, recordType: "paired", gasDiscrepancy: row.discrepancy?.reason, evidence: row.discrepancy?.evidence })),
    ...report.excluded.map((row) => ({ operationId: row.operationId, recordType: "excluded", reason: row.reason,
      gasDiscrepancy: row.discrepancy?.reason, evidence: row.discrepancy?.evidence })),
    ...summaries.map(([name, row]) => ({ ...row, operationId: name, recordType: "summary" })),
  ];
  const csvRows = [columns.join(","), ...records.map((row) => {
    const record = { ...row, ...forkFields };
    return columns.map((key) => csv(record[key])).join(",");
  })];
  const heading = ["Operation", "L1 gas", "L2 gas", "L1/L2", "L1 measured (wei)", "L2 measured (wei)", "L1 projected (wei)", "L2 projected (wei)"];
  const asCells = (id, row) => [id, row.l1GasUsed, row.l2GasUsed, row.gasRatio,
    row.l1MeasuredFeeWei, row.l2MeasuredFeeWei, row.l1ProjectedFeeWei, row.l2ProjectedFeeWei].map(display);
  const rows = report.paired.map((row) => asCells(row.operationId, row));
  const aggregates = summaries.map(([name, row]) => asCells(name, row));
  const pricing = report.pricing ? Object.entries({ Ethereum: report.pricing.ethereum, Base: report.pricing.base }).map(([name, model]) =>
    name + (model.window ? " blocks " + model.window.startBlock + "–" + model.window.endBlock : " block " + model.block) +
    " ending on " + model.observedAt + " uses " + model.executionPriceWei + " wei per gas. " + (model.method ?? "") + " " + model.source) :
    ["No mainnet pricing snapshot was supplied."];
  const mdTable = (head, body) => ["| " + head.join(" | ") + " |", "| " + head.map(() => "---").join(" | ") + " |",
    ...body.map((row) => "| " + row.join(" | ") + " |"), ""];
  const exclusions = report.excluded.map((row) => row.operationId + " (" + row.reason + ")");
  const discrepancies = [...report.paired, ...report.excluded].flatMap((row) => row.discrepancy ? [row.operationId + " " + row.discrepancy.reason +
    (row.discrepancy.evidence ? " (" + row.discrepancy.evidence + ")" : "")] : []);
  const latency = Object.entries(report.latency).flatMap(([chain, stats]) => Object.entries(stats).map(([type, sample]) =>
    [chain, type, sample.n, display(sample.medianMs), sample.rangeMs?.join(" to ") ?? "unknown"]));
  const md = ["# Paired V6 measurements", "", "Manifest " + report.manifestHash, "",
    report.complete ? "Coverage includes every manifest transaction." : "Partial comparison. Review the excluded operations.", "", ...(report.local ? ["Local Hardhat rehearsal.", ""] : []),
    ...forkLines.map((line) => "- " + line),
    "",
    ...mdTable(heading, aggregates), ...mdTable(heading, rows), "## Latency in milliseconds", "",
    ...mdTable(["Chain", "Observation", "Sample count", "Median", "Range"], latency), "## Pricing references", "",
    ...pricing.map((line) => "- " + line), "", "## Excluded operations", "",
    ...(exclusions.length ? exclusions.map((line) => "- " + line) : ["None."]), "",
    "## Gas discrepancies above 5%", "", ...(discrepancies.length ? discrepancies.map((line) => "- " + line) : ["None."]), "",
    "## Limitations", "", ...report.limitations.map((line) => "- " + line)];
  const escaped = (item) => String(item).replace(/[&%$#_{}]/g, (key) => "\\" + key);
  const texTable = (body) => ["\\begin{tabular}{lrrrrrrr}", "\\hline",
    ...[heading, ...body].map((row) => row.map(escaped).join(" & ") + " \\\\"), "\\hline", "\\end{tabular}"];
  const latex = [...texTable(aggregates), "", ...texTable(rows), "",
    ...[...forkLines, ...pricing, ...exclusions, ...discrepancies, ...report.limitations].map((line) => "% " + line.replace(/[\r\n]/g, " "))];
  for (const [name, body] of Object.entries({ "comparison.json": JSON.stringify(report, null, 2), "comparison.csv": csvRows.join("\n"),
    "comparison.md": md.join("\n"), "comparison.tex": latex.join("\n") })) fs.writeFileSync(path.join(output, name), body + "\n", { flag: "wx" });
}

function main() {
  const arg = require("../operatorArguments").parseOperatorArguments(process.argv.slice(2), {
    values: ["--manifest", "--l1", "--l2", "--pricing", "--explanations", "--output"], required: ["--manifest", "--l1", "--l2", "--output"],
  });
  const { manifest, manifestHash } = readManifest(arg["--manifest"]);
  const read = (file) => file && JSON.parse(fs.readFileSync(file));
  writeComparison(compare(manifest, manifestHash, read(arg["--l1"]), read(arg["--l2"]),
    { pricing: read(arg["--pricing"]), explanations: read(arg["--explanations"]) }), arg["--output"]);
}

if (require.main === module) {
  try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { classifyDiscrepancy, compare, measured, projected, ratio, timing, writeComparison };

