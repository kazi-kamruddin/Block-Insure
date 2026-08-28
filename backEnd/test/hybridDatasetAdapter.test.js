const test = require("node:test");
const assert = require("node:assert/strict");
const { ethers } = require("ethers");
const {
  buildBaseHybridRecord,
  createDeterministicSampler,
  getProviderSplit,
  hashInvoiceNumber,
  injectScenario,
  parseCsvLine,
} = require("../services/hybridDatasetAdapterService");
const { alignDemoPresetDates } = require("../scripts/seedHybridData");

const claim = {
  BeneID: "BENE1",
  ClaimID: "CLM1",
  ClaimStartDt: "2009-01-02",
  ClaimEndDt: "2009-01-04",
  Provider: "PRV1",
  InscClaimAmtReimbursed: "5000",
  DeductibleAmtPaid: "100",
  ClmAdmitDiagnosisCode: "4019",
  ClmProcedureCode_1: "9901",
};

test("CSV parser preserves quoted commas and escaped quotes", () => {
  assert.deepEqual(parseCsvLine('"A","B, C","D""E"'), ["A", "B, C", 'D"E']);
});

test("hybrid base records retain provider label without turning it into claim fraud", () => {
  const record = buildBaseHybridRecord({
    claim,
    beneficiary: { DOB: "1940-01-01", Gender: "1", Race: "2" },
    potentialFraud: true,
    claimSetting: "INPATIENT",
    amountRange: { minimum: 1000, maximum: 10000 },
  });

  assert.equal(record.providerPotentialFraud, true);
  assert.equal(record.actualFraud, false);
  assert.equal(record.controlledAttackTruth, false);
  assert.equal(record.scenarioInjected, false);
  assert.equal(record.claimSetting, "INPATIENT");
  assert.equal(record.treatmentType, "HOSPITALIZATION");
  assert.equal(record.invoiceHash, ethers.keccak256(ethers.toUtf8Bytes(record.invoiceNumber)));
});

test("provider split is stable and provider-disjoint", () => {
  const first = getProviderSplit("PRV1", 71);
  assert.equal(getProviderSplit("PRV1", 71), first);
  assert.ok(["train", "calibration", "test"].includes(first));
});

test("scenario injection creates separate controlled claim truth", () => {
  const record = buildBaseHybridRecord({
    claim,
    beneficiary: { DOB: "1940-01-01" },
    potentialFraud: false,
    claimSetting: "OUTPATIENT",
    amountRange: { minimum: 100, maximum: 1000 },
  });
  const injected = injectScenario(record, { seed: 9, rate: 1 });

  assert.equal(injected.scenarioInjected, true);
  assert.equal(injected.actualFraud, true);
  assert.equal(injected.controlledAttackTruth, true);
  assert.notEqual(injected.scenarioType, "NONE");
  assert.equal(record.actualFraud, false);
  assert.equal(record.controlledAttackTruth, false);
});

test("invoice hashing matches the existing frontend convention", () => {
  assert.equal(
    hashInvoiceNumber("INV-HOSP-001-001"),
    ethers.keccak256(ethers.toUtf8Bytes("INV-HOSP-001-001"))
  );
});

test("runtime sampling is deterministic, bounded, and independent of source order", () => {
  const buildSample = (keys) => {
    const sampler = createDeterministicSampler(3, {
      seed: 42,
      namespace: "runtime-test",
    });
    keys.forEach((key) => sampler.consider(key, { key }));
    return sampler.values().map(({ key }) => key);
  };

  const forward = buildSample(["a", "b", "c", "d", "e", "f"]);
  const reverse = buildSample(["f", "e", "d", "c", "b", "a"]);

  assert.equal(forward.length, 3);
  assert.deepEqual(forward, reverse);
});

test("runtime demo presets align to the local deployment window without changing identity", () => {
  const original = [{
    invoiceNumber: "INV-HOSP-001-001",
    admissionDate: "2023-01-01T00:00:00.000Z",
  }];
  const reference = "2026-08-28T12:00:00.000Z";
  const [aligned] = alignDemoPresetDates(original, reference);
  assert.equal(aligned.invoiceNumber, original[0].invoiceNumber);
  assert.equal(aligned.admissionDate, "2026-08-27T12:00:00.000Z");
  assert.equal(aligned.dischargeDate, "2026-08-28T10:00:00.000Z");
  assert.equal(aligned.invoiceDate, "2026-08-28T11:00:00.000Z");
});
