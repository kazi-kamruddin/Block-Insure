// Action-based counterfactual engineering. Never imports a model or risk policy.
const { stableUnit, hashInvoiceNumber } = require('../services/hybridDatasetAdapterService');
const DAY = 86400000;
const at = (date, days) => new Date(Date.parse(date) + days * DAY).toISOString();
function engineer(base, { seed, rate, plan, cohort = 'test', forcedFamily, forcedSeverity } = {}) {
  const unit = (key) => stableUnit(`engineering-v2:${seed}:${base.sourceClaimId}:${key}`);
  const intentional = forcedFamily ? plan.primaryFamilies.includes(forcedFamily) || forcedFamily === plan.heldOutFamily : unit('intervention') < rate;
  const families = intentional ? (cohort === 'test_family' ? [plan.heldOutFamily] : plan.primaryFamilies) : plan.benignFamilies;
  const family = forcedFamily || families[Math.min(families.length - 1, Math.floor(unit(intentional ? 'attack-family' : 'benign-family') * families.length))];
  const range = cohort === 'test_severity' ? plan.severity.stress : plan.severity.primary;
  const severity = forcedSeverity ?? range[0] + unit('severity') * (range[1] - range[0]);
  const record = { ...base, observableHistory: {} };
  const claim = { hospitalId: base.hospitalId, invoiceHash: base.invoiceHash, claimAmountEth: base.billAmount, claimType: base.treatmentType, incidentDate: Date.parse(base.admissionDate) / 1000 };
  const events = [];
  const add = (days, fields = {}) => events.push({ ...base, ...fields,
    admissionDate: at(base.admissionDate, -days), dischargeDate: at(base.dischargeDate, -days),
    invoiceDate: at(base.invoiceDate, -days), observationDate: at(base.invoiceDate, -days), observableHistory: {} });
  let observableAction = 'UNCHANGED';
  if (family === 'AMOUNT_INCONSISTENCY') {
    claim.claimAmountEth = (Number(base.billAmount) * severity).toFixed(4);
    observableAction = 'Requested more than unchanged registry bill';
  } else if (family === 'INVOICE_REPLAY') {
    record.invoiceStatus = 'USED'; add(2);
    observableAction = 'Submitted a previously used invoice';
  } else if (family === 'DATE_INCONSISTENCY') {
    claim.incidentDate = Date.parse(base.invoiceDate) / 1000 + Math.ceil(31 * severity) * 86400;
    observableAction = 'Submitted an incident date beyond the recorded care episode';
  } else if (family === 'COHERENT_BILL_INFLATION' || family === 'BENIGN_HIGH_COST') {
    record.billAmount = (Number(base.billAmount) * severity).toFixed(4);
    claim.claimAmountEth = record.billAmount;
    observableAction = 'Registry and requested amount jointly increased';
  } else if (family === 'REPEATED_SERVICE_BILLING' || family === 'BENIGN_REPEAT_CARE') {
    for (let i = 1; i <= 3 + Math.floor(severity); i++) add(i * 2);
    observableAction = 'Several earlier similar care/billing records';
  } else if (family === 'COORDINATED_BILLING_BURST' || family === 'BENIGN_PROVIDER_SURGE') {
    for (let i = 0; i < 8 + Math.floor(4 * severity); i++) add(1 + i % 7, { patientHash: `simulation-patient:${seed}:${base.sourceClaimId}:${i % 5}` });
    // Same observable mechanism for a benign outreach surge and intentional billing.
    // Do not expose an intent flag through a synthetic "collusion" feature.
    observableAction = 'Concentrated prior provider activity across several simulated patients';
  } else if (!['UNCHANGED_CONTROL', 'CONCEALED_PHANTOM_BILLING'].includes(family)) {
    throw new Error(`Unsupported engineering family: ${family}`);
  }
  // Invoice identifiers of extra events are bookkeeping, not model features.
  for (let i = 0; i < events.length; i++) {
    events[i].sourceClaimId = `simulation:${seed}:${base.sourceClaimId}:${i}`;
    events[i].invoiceNumber = family === 'INVOICE_REPLAY' ? base.invoiceNumber : events[i].sourceClaimId;
    events[i].invoiceHash = family === 'INVOICE_REPLAY' ? base.invoiceHash : hashInvoiceNumber(events[i].invoiceNumber);
  }
  return { observable: { record, claim, events }, truth: { family, intentionalIntervention: intentional, severity,
    mechanism: observableAction, sourceClaimId: base.sourceClaimId,
    latentSimulationFacts: { serviceRenderedAssumption: family !== 'CONCEALED_PHANTOM_BILLING',
      repeatedServicesActuallyRendered: family === 'BENIGN_REPEAT_CARE' ? events.length + 1 : 1,
      billReflectsSimulatedUnderlyingCost: family !== 'COHERENT_BILL_INFLATION',
      surgeJustifiedInSimulator: family !== 'COORDINATED_BILLING_BURST' },
    observability: family === 'CONCEALED_PHANTOM_BILLING' ? 'NO_CHANGED_OBSERVATION' : ['COHERENT_BILL_INFLATION', 'REPEATED_SERVICE_BILLING', 'COORDINATED_BILLING_BURST'].includes(family) ? 'AMBIGUOUS_WITH_BENIGN_COUNTERPART' : 'OBSERVABLE_ACTION',
    intentWarning: 'Simulator action/intent only, not adjudicated natural fraud or clinical necessity' } };
}
module.exports = { engineer };
