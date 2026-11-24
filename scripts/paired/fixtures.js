const { ethers } = require("../../backEnd/node_modules/ethers");
const { assessProtocol } = require("../../oracle/protocolAssessment");
const { binding, hash, registryRoot } = require("../../oracle/shadowAssessment");
const { loadAdvisoryBundle } = require("../../oracle/advisoryBundle");
const { getCanonicalRecordPayload } = require("../../backEnd/services/merkleRegistryService");

function verifyRouting(spec, packet, authoritative, loaded) {
  const decision = assessProtocol(packet, authoritative, loaded);
  if (decision.verified !== (spec.route === "AUTO") || decision.assessment.result.scoreUnits !== spec.scoreUnits ||
      decision.assessment.result.oodWarning !== spec.oodWarning) throw new Error("Frozen evaluator differs from the approved case");
  return { contextId: decision.assessment.contextId, route: spec.route, scoreUnits: spec.scoreUnits, oodWarning: spec.oodWarning };
}

function verifyFixtures(manifest) {
  const loaded = loadAdvisoryBundle();
  return Object.fromEntries(Object.entries(manifest.cases).map(([name, spec]) => {
    const holder = "0x" + "4".repeat(40);
    const invoice = ethers.id("paired-v6:" + name);
    const record = getCanonicalRecordPayload({
      hospitalId: "HOSP-001", hospitalName: "Synthetic test hospital", patientHash: ethers.id("paired-v6:patient"),
      authorizedClaimants: [holder], admissionDate: "2026-10-20T00:00:00.000Z", dischargeDate: "2026-10-20T00:00:00.000Z",
      invoiceDate: "2026-10-20T00:00:00.000Z", billAmount: spec.grossEth, expectedBillMin: spec.expectedBillEth,
      expectedBillMax: spec.expectedBillEth, invoiceHash: invoice, invoiceNumber: "paired-" + name,
      treatmentType: spec.service, diagnosisCode: "D1", licenseStatus: "ACTIVE", recordStatus: "VALID", invoiceStatus: "VALID",
    });
    const claim = { claimId: "1", claimantWallet: holder, hospitalId: "HOSP-001", invoiceHash: invoice,
      claimAmountEth: spec.grossEth, claimType: spec.service, incidentDate: "1792454400", submittedAt: "1792627200" };
    const request = { requestId: "1", claimId: "1", claimVersion: "1", registryVersion: "1",
      registryRoot: registryRoot([record]), requestBlock: "5", modelVersion: manifest.deployment.modelIdentity };
    const authoritative = { request, claim, chainId: "31337", managerAddress: "0x" + "2".repeat(40),
      coordinatorAddress: "0x" + "3".repeat(40), snapshotTimestamp: "1792713600", requestBlockHash: ethers.id("paired-v6:block") };
    const bound = binding({ ...authoritative, bundleHash: loaded.bundleHash, manifestHash: loaded.manifestHash });
    const packet = { version: "request-shadow-v1", binding: bound, contextId: hash(bound), records: [record] };
    return [name, verifyRouting(spec, packet, authoritative, loaded)];
  }));
}

module.exports = { verifyFixtures, verifyRouting };

