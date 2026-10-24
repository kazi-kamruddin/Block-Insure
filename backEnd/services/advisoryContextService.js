const { createContextIndex } = require("../research/context");
const { continuousFeatures } = require("./continuousFeatureService");
const { extractObservedFeatures } = require("../../oracle/observableFeatures");
const { compareCommittedRecord } = require("../../oracle/independentAssessment");
const policy = require("../triage-policy.json");
const DAY = 86400000;
const MAX_RECORDS = 10000;
const ALLOWED_FIELDS = ["hospitalId", "patientHash", "authorizedClaimants", "treatmentType", "diagnosisCode", "admissionDate", "dischargeDate", "invoiceDate",
  "billAmount", "expectedBillMin", "expectedBillMax", "invoiceHash", "invoiceStatus", "recordStatus", "licenseStatus"];

function fail(code) { const error = new Error(code); error.code = code; throw error; }
function clean(record) {
  const result = Object.fromEntries(ALLOWED_FIELDS.map((key) => [key, record[key]]));
  for (const key of ["admissionDate", "dischargeDate", "invoiceDate"]) {
    const timestamp = Date.parse(record[key]);
    if (!Number.isFinite(timestamp)) fail("INVALID_CONTEXT_RECORD");
    result[key] = new Date(Math.floor(timestamp / DAY) * DAY).toISOString();
  }
  for (const key of ["billAmount", "expectedBillMin", "expectedBillMax"]) {
    if (!Number.isFinite(Number(record[key])) || Number(record[key]) < 0) fail("INVALID_CONTEXT_RECORD");
  }
  if (!result.patientHash || !result.hospitalId || !result.invoiceHash || Number(result.expectedBillMax) <= 0) fail("INVALID_CONTEXT_RECORD");
  result.observationDate = result.invoiceDate;
  // New inference deliberately does not consume old pre-engineered history flags.
  result.observableHistory = {};
  return result;
}

function prepareAdvisoryObservation({ records, claim, snapshotTimestamp }) {
  if (!Array.isArray(records) || records.length > MAX_RECORDS) fail("CONTEXT_LIMIT_EXCEEDED");
  const original = records.find((record) => String(record.invoiceHash).toLowerCase() === String(claim.invoiceHash).toLowerCase());
  if (!original) fail("INVOICE_NOT_IN_COMMITTED_SNAPSHOT");
  const record = clean(original);
  const cutoff = Math.min(Date.parse(record.invoiceDate), Number(snapshotTimestamp) * 1000, Number(claim.submittedAt) * 1000);
  if (!Number.isFinite(cutoff)) fail("INVALID_CONTEXT_CUTOFF");
  const cutoffDay = Math.floor(cutoff / DAY) * DAY;
  record.observationDate = new Date(cutoffDay).toISOString();
  const index = createContextIndex(), seen = new Set();
  let included = 0;
  for (const source of records) {
    if (seen.has(String(source.invoiceHash).toLowerCase())) fail("DUPLICATE_CONTEXT_IDENTITY");
    seen.add(String(source.invoiceHash).toLowerCase());
    if (source.invoiceHash.toLowerCase() === record.invoiceHash.toLowerCase()) continue;
    const date = Date.parse(source.invoiceDate);
    if (!Number.isFinite(date)) fail("INVALID_CONTEXT_RECORD");
    if (date >= cutoffDay || date < cutoffDay - 90 * DAY) continue;
    const prior = clean(source);
    index.add(prior); included++;
  }
  index.seal();
  const context = index.query(record);
  const comparison = compareCommittedRecord({ record, claim });
  const binary = extractObservedFeatures({ record, comparison });
  const mandatory = ["patientMatches", "hospitalId", "invoiceHash", "billAmount", "recordStatus", "invoiceStatus", "licenseStatus"].some((name) => !comparison[name]) ||
    [...policy.routing.hardBlockingFeatures, ...policy.routing.manualReviewFeatures].some((name) => binary[name]);
  return {
    observation: { features: { ...Object.fromEntries(Object.entries(binary).map(([key, value]) => [key, Number(value)])), ...continuousFeatures(record), ...context.features },
      providerLags: context.providerLags, mandatory, group: record.treatmentType, diagnosis: record.diagnosisCode || "" },
    record, comparison,
    context: { version: "committed-registry-history-v1", cutoff: new Date(cutoffDay).toISOString(), recordsInSnapshot: records.length,
      eligiblePriorRecords: included, historyAvailable: Boolean(context.features.history_available), providerHistoryAvailable: Boolean(context.features.temporal_history_available),
      semantics: "Committed registry bills; invoice dates are availability proxies, not proven submission times or rendered services",
      unknownHistory: "No matching prior entries in this snapshot does not prove absence of outside history", sourceMapping: "Exact patient and hospital identities only; no invented Medicare-to-wallet mapping" },
  };
}

module.exports = { prepareAdvisoryObservation, MAX_RECORDS };
