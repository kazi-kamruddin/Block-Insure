const { ethers } = require("ethers");
const { binding, hash } = require("../../../oracle/shadowAssessment");
const { buildMerkleTree, getCanonicalRecordPayload } = require("../../services/merkleRegistryService");
const { loadAdvisoryBundle } = require("../../../oracle/advisoryBundle");
module.exports = () => {
  const wallet = ethers.Wallet.createRandom();
  const record = { hospitalId: "HOSP-001", hospitalName: "Synthetic test hospital", patientHash: ethers.id("test-patient"), authorizedClaimants: [wallet.address.toLowerCase()],
    admissionDate: "2026-10-20T00:00:00.000Z", dischargeDate: "2026-10-20T00:00:00.000Z", invoiceDate: "2026-10-20T00:00:00.000Z", billAmount: "0.1", expectedBillMin: "0.01", expectedBillMax: "1",
    invoiceHash: ethers.id("test-invoice"), invoiceNumber: "test-invoice", treatmentType: "HOSPITALIZATION", diagnosisCode: "D1", licenseStatus: "ACTIVE", recordStatus: "VALID", invoiceStatus: "VALID" };
  const claim = { claimId: "1", claimantWallet: wallet.address.toLowerCase(), hospitalId: "HOSP-001", invoiceHash: record.invoiceHash,
    claimAmountEth: "0.1", claimType: "HOSPITALIZATION", incidentDate: String(Date.parse(record.admissionDate) / 1000), submittedAt: "1792627200" };
  const request = { requestId: "1", claimId: "1", claimVersion: "1", registryVersion: "1", registryRoot: buildMerkleTree([record]).rootHash, requestBlock: "5" };
  const authoritative = { request, claim, chainId: "31337", managerAddress: `0x${"2".repeat(40)}`, coordinatorAddress: `0x${"3".repeat(40)}`,
    snapshotTimestamp: "1792713600", requestBlockHash: ethers.id("request-block") };
  const loaded = loadAdvisoryBundle();
  const bound = binding({ ...authoritative, bundleHash: loaded.bundleHash, manifestHash: loaded.manifestHash });
  return { wallet, record, authoritative, loaded, packet: { version: "request-shadow-v1", binding: bound, contextId: hash(bound), records: [getCanonicalRecordPayload(record)] } };
};
