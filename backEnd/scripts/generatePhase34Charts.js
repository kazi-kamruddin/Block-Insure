const fs = require("node:fs");
const path = require("node:path");

const RESULTS_DIR = path.join(__dirname, "..", "evaluation-results");
const OUTPUT_DIR = path.join(RESULTS_DIR, "evaluation-charts");

const escapeXml = (value) => String(value)
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;");

const COLORS = ["#2563eb", "#16a34a", "#f97316", "#dc2626"];

const lineChart = ({ title, xLabel, yLabel, series, yMaximum, yFormatter }) => {
  const width = 1000;
  const height = 650;
  const plot = { x: 105, y: 90, width: 800, height: 450 };
  const allPoints = series.flatMap((item) => item.points);
  const maxX = Math.max(...allPoints.map((point) => point.x), 1);
  const maxY = yMaximum || Math.max(...allPoints.map((point) => point.y), 1);
  const lines = series.map((item, index) => {
    const points = item.points.map((point) =>
      `${plot.x + (point.x / maxX) * plot.width},${plot.y + plot.height - (point.y / maxY) * plot.height}`
    ).join(" ");
    return `<polyline fill="none" stroke="${COLORS[index % COLORS.length]}" stroke-width="4" points="${points}"/>`;
  }).join("\n");
  const legends = series.map((item, index) =>
    `<g transform="translate(${120 + index * 205},590)"><rect width="18" height="18" fill="${COLORS[index % COLORS.length]}"/><text x="26" y="15">${escapeXml(item.label)}</text></g>`
  ).join("\n");
  const yTicks = Array.from({ length: 6 }, (_, index) => {
    const value = maxY * index / 5;
    const y = plot.y + plot.height - plot.height * index / 5;
    return `<line x1="${plot.x}" y1="${y}" x2="${plot.x + plot.width}" y2="${y}" stroke="#e2e8f0"/><text x="94" y="${y + 5}" text-anchor="end">${escapeXml(yFormatter(value))}</text>`;
  }).join("\n");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
<rect width="100%" height="100%" fill="#f8fafc"/><text x="50" y="45" font-family="Arial" font-size="28" font-weight="700">${escapeXml(title)}</text>
<g font-family="Arial" font-size="14" fill="#334155">${yTicks}<line x1="${plot.x}" y1="${plot.y}" x2="${plot.x}" y2="${plot.y + plot.height}" stroke="#64748b" stroke-width="2"/><line x1="${plot.x}" y1="${plot.y + plot.height}" x2="${plot.x + plot.width}" y2="${plot.y + plot.height}" stroke="#64748b" stroke-width="2"/>${lines}<text x="${plot.x + plot.width / 2}" y="570" text-anchor="middle">${escapeXml(xLabel)}</text><text transform="translate(28 ${plot.y + plot.height / 2}) rotate(-90)" text-anchor="middle">${escapeXml(yLabel)}</text>${legends}</g></svg>`;
};

const barChart = ({ title, groups, yLabel }) => {
  const width = 1000;
  const height = 650;
  const plot = { x: 100, y: 90, width: 820, height: 450 };
  const maxY = Math.max(...groups.flatMap((group) => group.values.map((value) => value.value)), 1);
  const groupWidth = plot.width / groups.length;
  const bars = groups.map((group, groupIndex) => {
    const barWidth = Math.min(70, groupWidth / (group.values.length + 1));
    const values = group.values.map((value, valueIndex) => {
      const barHeight = (value.value / maxY) * plot.height;
      const x = plot.x + groupIndex * groupWidth + 28 + valueIndex * (barWidth + 15);
      const y = plot.y + plot.height - barHeight;
      return `<rect x="${x}" y="${y}" width="${barWidth}" height="${barHeight}" fill="${COLORS[valueIndex]}"/><text x="${x + barWidth / 2}" y="${y - 8}" text-anchor="middle">${value.value.toFixed(2)}</text>`;
    }).join("\n");
    return `${values}<text x="${plot.x + groupIndex * groupWidth + groupWidth / 2}" y="570" text-anchor="middle">${escapeXml(group.label)}</text>`;
  }).join("\n");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="#f8fafc"/><text x="50" y="45" font-family="Arial" font-size="28" font-weight="700">${escapeXml(title)}</text><g font-family="Arial" font-size="14" fill="#334155"><line x1="${plot.x}" y1="${plot.y}" x2="${plot.x}" y2="${plot.y + plot.height}" stroke="#64748b" stroke-width="2"/><line x1="${plot.x}" y1="${plot.y + plot.height}" x2="${plot.x + plot.width}" y2="${plot.y + plot.height}" stroke="#64748b" stroke-width="2"/>${bars}<text transform="translate(28 ${plot.y + plot.height / 2}) rotate(-90)" text-anchor="middle">${escapeXml(yLabel)}</text><g transform="translate(330,610)"><rect width="16" height="16" fill="${COLORS[0]}"/><text x="24" y="14">Encrypt p95</text><rect x="160" width="16" height="16" fill="${COLORS[1]}"/><text x="184" y="14">Decrypt p95</text></g></g></svg>`;
};

const run = () => {
  const reserve = JSON.parse(fs.readFileSync(path.join(RESULTS_DIR, "phase3-reserve-evaluation.json"), "utf8"));
  const evidence = JSON.parse(fs.readFileSync(path.join(RESULTS_DIR, "phase4-evidence-evaluation.json"), "utf8"));
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const reserveSeries = reserve.chartData.map((scenario) => ({
    label: scenario.key.replaceAll("_", " "),
    points: scenario.points.map((point) => ({ x: point.capitalRatio, y: point.shortfallProbability })),
  }));
  fs.writeFileSync(path.join(OUTPUT_DIR, "reserve_shortfall_frontier.svg"), lineChart({
    title: "Reserve capital versus shortfall probability",
    xLabel: "Capital as share of aggregate exposure",
    yLabel: "Probability of FUNDING_REQUIRED proxy",
    series: reserveSeries,
    yMaximum: 1,
    yFormatter: (value) => `${Math.round(value * 100)}%`,
  }));
  fs.writeFileSync(path.join(OUTPUT_DIR, "reserve_expected_shortfall.svg"), lineChart({
    title: "Expected shortfall conditional on reserve breach",
    xLabel: "Capital as share of aggregate exposure",
    yLabel: "Expected shortfall (synthetic ETH)",
    series: reserve.chartData.map((scenario) => ({
      label: scenario.key.replaceAll("_", " "),
      points: scenario.points.map((point) => ({ x: point.capitalRatio, y: point.expectedShortfallEth })),
    })),
    yFormatter: (value) => value.toFixed(1),
  }));
  fs.writeFileSync(path.join(OUTPUT_DIR, "evidence_aes_latency.svg"), barChart({
    title: "Evidence AES-256-GCM latency by document size",
    yLabel: "p95 milliseconds",
    groups: evidence.documentBenchmarks.map((document) => ({
      label: document.key.replaceAll("_", " "),
      values: [
        { value: document.aesEncrypt.p95Ms },
        { value: document.aesDecrypt.p95Ms },
      ],
    })),
  }));
  fs.writeFileSync(path.join(OUTPUT_DIR, "evidence_pre_latency.svg"), lineChart({
    title: "Delegated evidence-key access overhead",
    xLabel: "Recipients",
    yLabel: "p95 milliseconds per operation",
    series: [
      { label: "PRE transform", points: evidence.preBenchmarks.map((row) => ({ x: row.recipientCount, y: row.transformations.p95Ms })) },
      { label: "recipient decrypt", points: evidence.preBenchmarks.map((row) => ({ x: row.recipientCount, y: row.recipientDecryptions.p95Ms })) },
    ],
    yFormatter: (value) => value.toFixed(1),
  }));
  console.log(`Phase 3/4 SVG charts written to ${OUTPUT_DIR}`);
};

if (require.main === module) run();

module.exports = { barChart, lineChart, run };
