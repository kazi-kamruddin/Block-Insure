// An additive offline baseline, not a deployed fraud verdict. No labels,
// experiment flags, identifiers or optional procedure-code presence features.
const CONTINUOUS_FEATURES = ["log_bill", "bill_to_expected_max", "care_days", "invoice_lag_days", "log_prior_claims"];
const number = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;
const days = (end, start) => {
  const delta = (Date.parse(end) - Date.parse(start)) / 86400000;
  return Number.isFinite(delta) ? Math.max(-365, Math.min(365, delta)) : 0;
};
const continuousFeatures = (record) => ({
  log_bill: Math.log1p(Math.max(0, number(record.billAmount))),
  bill_to_expected_max: Math.min(20, Math.max(0, number(record.billAmount)) / Math.max(0.0001, number(record.expectedBillMax))),
  care_days: days(record.dischargeDate, record.admissionDate),
  invoice_lag_days: days(record.invoiceDate, record.dischargeDate),
  log_prior_claims: Math.log1p(Math.max(0, number(record.observableHistory?.previousClaimCount))),
});
const fitStandardizer = (rows, names) => Object.fromEntries(names.map((name) => {
  const mean = rows.reduce((sum, row) => sum + Number(row.features[name]), 0) / rows.length;
  const variance = rows.reduce((sum, row) => sum + (Number(row.features[name]) - mean) ** 2, 0) / rows.length;
  return [name, { mean, scale: Math.sqrt(variance) || 1 }];
}));
const standardize = (features, parameters) => Object.fromEntries(Object.entries(parameters).map(([name, parameter]) => [name,
  (Number(features[name]) - parameter.mean) / parameter.scale]));
module.exports = { CONTINUOUS_FEATURES, continuousFeatures, fitStandardizer, standardize };
