const DAY = 86400000;
const timestamp = (record) => Date.parse(record.admissionDate);
const positive = (value) => Number.isFinite(Number(value)) && Number(value) >= 0 ? Number(value) : 0;
const compactObservation = (record) => ({ hospital: record.hospitalId, patient: record.patientHash,
  time: timestamp(record), amount: positive(record.billAmount), diagnosis: String(record.diagnosisCode || ""),
  treatment: String(record.treatmentType || ""), procedure: String(record.sourceProcedureCode || ""),
  ratio: Math.min(20, positive(record.billAmount) / Math.max(0.0001, positive(record.expectedBillMax))) });

// Query strictly prior observations. Neither attack labels nor injected history
// flags are consumed. Optional codes match only when present on both records.
function historicalContext(candidate, observations) {
  const current = compactObservation(candidate);
  const prior = observations.filter((row) => Number.isFinite(row.time) && row.time < current.time && row.time >= current.time - 30 * DAY);
  const provider = prior.filter((row) => row.hospital === current.hospital);
  const patient = prior.filter((row) => row.patient === current.patient && row.time >= current.time - 14 * DAY);
  const similar = patient.filter((row) => row.hospital === current.hospital && row.treatment === current.treatment &&
    Boolean(current.diagnosis && row.diagnosis === current.diagnosis) &&
    (!current.procedure || !row.procedure || row.procedure === current.procedure) &&
    Math.abs(row.amount - current.amount) / Math.max(row.amount, current.amount, 0.0001) <= 0.1);
  return { priorSimilarCount: similar.length, priorPatient14DayCount: patient.length,
    providerPrior30DayCount: provider.length,
    providerPriorMeanBillRatio: provider.length ? provider.reduce((sum, row) => sum + row.ratio, 0) / provider.length : 0 };
}

// Build sorted per-entity indices once. Binary-search windows bound each query
// to a relevant entity's preceding month, rather than rescanning the full cohort.
function createHistoryIndex() {
  const hospitals = new Map(), patients = new Map();
  let sealed = false;
  const append = (map, key, row) => { if (!map.has(key)) map.set(key, []); map.get(key).push(row); };
  const lower = (rows, time) => { let a = 0, b = rows.length; while (a < b) { const m = (a + b) >>> 1; if (rows[m].time < time) a = m + 1; else b = m; } return a; };
  return {
    add(record) { if (sealed) throw new Error("History index is sealed"); const row = compactObservation(record); if (!Number.isFinite(row.time)) return;
      append(hospitals, row.hospital, row); append(patients, row.patient, row); },
    seal() { for (const map of [hospitals, patients]) for (const list of map.values()) list.sort((a, b) => a.time - b.time); sealed = true; },
    query(record) {
      if (!sealed) throw new Error("Seal history before querying");
      const time = timestamp(record);
      const window = (map, key) => { const list = map.get(key) || []; return list.slice(lower(list, time - 30 * DAY), lower(list, time)); };
      const relevant = new Set([...window(hospitals, record.hospitalId), ...window(patients, record.patientHash)]);
      return historicalContext(record, [...relevant]);
    },
  };
}
const HISTORY_FEATURES = ["log_prior_similar", "log_patient_14d", "log_provider_30d", "provider_prior_bill_ratio"];
const historyFeatures = (context) => ({ log_prior_similar: Math.log1p(context.priorSimilarCount),
  log_patient_14d: Math.log1p(context.priorPatient14DayCount), log_provider_30d: Math.log1p(context.providerPrior30DayCount),
  provider_prior_bill_ratio: context.providerPriorMeanBillRatio });
module.exports = { historicalContext, compactObservation, createHistoryIndex, historyFeatures, HISTORY_FEATURES };
