const fs = require("node:fs");
const path = require("node:path");
const { collectResearchMetrics } = require("../services/researchMetricsService");

const projectRoot = path.resolve(__dirname, "..", "..");
const outputPath = path.join(__dirname, "..", "evaluation-results", "research-metrics.json");
const metrics = collectResearchMetrics(projectRoot);
fs.writeFileSync(outputPath, `${JSON.stringify(metrics, null, 2)}\n`, "utf8");
console.log(`Research metrics written to ${outputPath}`);
