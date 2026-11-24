const fs = require("node:fs");
const crypto = require("node:crypto");
const { parseEther } = require("../../backEnd/node_modules/ethers");

const roles = ["admin", "holder", "bank", "hospital", "oracle1", "oracle2", "auditor1", "auditor2", "auditor3", "auditor4"];
const digest = (data) => crypto.createHash("sha256").update(data).digest("hex");

function amount(value, name) {
  if (typeof value !== "string" || !/^(0|[1-9]\d*)(\.\d{1,18})?$/.test(value)) throw new Error("Invalid amount for " + name);
  return parseEther(value);
}

function validateManifest(manifest) {
  if (manifest.schema !== "block-insure-paired-v6/v1" || manifest.chains?.l1 !== 11155111 || manifest.chains?.l2 !== 84532 ||
      manifest.deployment?.claimWorkflowProfile !== "V6" || manifest.deployment.calendarProfile !== "ACCELERATED_TESTNET" ||
      manifest.deployment.reviewTimingProfile !== "DEMONSTRATION" || !/^0x[a-f0-9]{64}$/.test(manifest.deployment.modelIdentity) ||
      manifest.deployment.deductibleBps !== 1000 || manifest.deployment.insurerShareBps !== 8000) {
    throw new Error("Invalid paired V6 deployment configuration");
  }
  const { deployment, budget, cases, timing, operations } = manifest;
  if (!budget || !cases || !Number.isSafeInteger(timing?.pollMs) || timing.pollMs < 200 || timing.finalityTag !== "finalized" ||
      timing.retry !== "reconcile-signed-intent" || timing.deadlines !== "chain-time") throw new Error("Invalid paired timing or budget");
  const coverage = amount(deployment.coverageEth, "coverage");
  if (amount(deployment.premiumEth, "premium") === 0n || amount(deployment.surgerySublimitEth, "surgery sublimit") > coverage ||
      amount(deployment.medicalReserveEth, "medical reserve") > amount("0.012", "medical ceiling") ||
      amount(deployment.refundReserveEth, "refund reserve") > amount("0.0015", "refund ceiling") ||
      amount(budget.feeCeilingEth, "fee ceiling") > amount("0.002", "fee ceiling") ||
      amount(budget.adminRetainedEth, "admin retained") < amount("0.02", "admin floor")) throw new Error("Unapproved financial limits");
  for (const [name, fixture] of Object.entries(cases)) {
    if (!["AUTO", "REVIEW"].includes(fixture.route) || typeof fixture.service !== "string" ||
        !Number.isSafeInteger(fixture.scoreUnits) || typeof fixture.oodWarning !== "boolean" ||
        amount(fixture.grossEth, name) <= 0n || amount(fixture.grossEth, name) > coverage ||
        amount(fixture.expectedBillEth, name) <= 0n || amount(fixture.payoutEth, name) > coverage) {
      throw new Error("Invalid paired case " + name);
    }
  }
  const caseNames = ["routine", "manual", "surgery"];
  if (Object.keys(cases).length !== caseNames.length || caseNames.some((name) => !Object.hasOwn(cases, name))) throw new Error("Missing paired case");
  if (!Array.isArray(operations) || operations.length === 0 ||
      operations.filter((step) => step.kind === "transaction").length !== manifest.expectedTransactionsPerChain) {
    throw new Error("Incorrect paired operation count");
  }
  const ids = new Set();
  for (const step of operations) {
    if (!/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/.test(step.id) || ids.has(step.id) ||
        !["bootstrap", "setup", "premium", "registry", "evidence", "automatic", "manual", "appeal", "clarification", "capped", "refund"].includes(step.category) ||
        !["transaction", "observation"].includes(step.kind) || !roles.includes(step.role) ||
        !step.target || !step.method || !Array.isArray(step.arguments) || !step.expectedAfter ||
        (step.case && !Object.hasOwn(cases, step.case))) throw new Error("Invalid or repeated paired operation " + step.id);
    amount(step.valueEth, step.id);
    ids.add(step.id);
  }
  return manifest;
}

function readManifest(file) {
  const bytes = fs.readFileSync(file);
  return { manifest: validateManifest(JSON.parse(bytes)), manifestHash: digest(bytes) };
}

module.exports = { amount, digest, readManifest, roles, validateManifest };

