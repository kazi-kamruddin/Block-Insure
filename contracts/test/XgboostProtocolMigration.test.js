const { expect } = require("chai");
const { ethers } = require("hardhat");
const { configureOracleFixture, finalizeExactResult } = require("./helpers/oracleCoordinator");
const { loadProtocolArtifact, resolveRequestModel } = require("../../oracle/runtimeProtocol");
const { assessProtocol } = require("../../oracle/protocolAssessment");
const { registryRoot, binding, hash } = require("../../oracle/shadowAssessment");
const { loadAdvisoryBundle } = require("../../oracle/advisoryBundle");
const { buildResultHash } = require("../../oracle/protocol");
const { hashCanonicalRecord } = require("../../oracle/merkleProof");

describe("XGBoost routing with the existing contract protocol", function () {
  async function setup(amount = "0.1", legacy = false) {
    const [admin, user, first, second] = await ethers.getSigners();
    const manager = await (await ethers.getContractFactory("InsuranceManager")).deploy();
    const coordinator = await configureOracleFixture(manager, admin, [first, second], { commitBlocks: 20, revealBlocks: 20 });
    const active = loadProtocolArtifact(); await manager.updateOracleModelVersion(legacy ? active.legacyModelIdentityHash : active.modelIdentityHash);
    await manager.createPolicyPackage("Migration", "HEALTH", ethers.parseEther("0.01"), ethers.parseEther("1"), 365, "HOSPITAL_BILL");
    await manager.connect(user).purchasePolicy(1, { value: ethers.parseEther("0.01") });
    const policy = await manager.getPolicy(1), day = new Date(Number(policy.startDate) * 1000).toISOString();
    const record = { hospitalId: "HOSP-001", patientHash: ethers.id("synthetic-patient"), authorizedClaimants: [user.address.toLowerCase()],
      treatmentType: "HOSPITALIZATION", diagnosisCode: "D1", admissionDate: day, dischargeDate: day, invoiceDate: day,
      invoiceHash: ethers.id("migration-invoice"), invoiceNumber: "migration-invoice", billAmount: "0.1", expectedBillMin: "0.01", expectedBillMax: "1",
      licenseStatus: "ACTIVE", recordStatus: "VALID", invoiceStatus: "VALID" };
    await coordinator.publishRegistrySnapshot(registryRoot([record]), 1, ethers.id("schema"));
    await manager.connect(user).submitClaim(1, ethers.parseEther(amount), policy.startDate, record.treatmentType, record.hospitalId,
      record.invoiceHash, ethers.id("synthetic-doc"), "ipfs://synthetic");
    await manager.requestOracleVerification(1);
    const request = await coordinator.getRequestByClaimId(1), claim = await manager.getClaim(1), snapshot = await coordinator.getRegistrySnapshot(request.registryVersion);
    const authoritative = { request, claim: { ...claim.toObject(), claimAmountEth: ethers.formatEther(claim.claimAmount) },
      chainId: "31337", managerAddress: await manager.getAddress(), coordinatorAddress: await coordinator.getAddress(),
      requestBlockHash: (await ethers.provider.getBlock(Number(request.requestBlock))).hash, snapshotTimestamp: snapshot.publishedAt };
    const loaded = loadAdvisoryBundle(), bound = binding({ ...authoritative, bundleHash: loaded.bundleHash, manifestHash: loaded.manifestHash });
    const assessed = assessProtocol({ version: "request-shadow-v1", binding: bound, contextId: hash(bound), records: [record] }, authoritative);
    const resultHash = buildResultHash({ request, verified: assessed.verified, verificationCode: assessed.verificationCode, leafHash: hashCanonicalRecord(record) });
    return { manager, coordinator, first, second, request, assessed, resultHash, active };
  }
  it("routes a real XGBoost computation through exact two-worker agreement and funded pull allocation", async () => {
    const f = await setup(); expect(f.assessed.verified).to.equal(true);
    await f.manager.fundContract({ value: ethers.parseEther("1") });
    await finalizeExactResult(f.coordinator, f.request.requestId, [f.first, f.second], true, f.resultHash);
    expect((await f.manager.getClaim(1)).status).to.equal(7); // PAYOUT_READY; not a push transfer
  });
  it("routes an observable integrity finding to the existing failure/manual-eligibility path without allocation", async () => {
    const f = await setup("0.15"); expect(f.assessed.verified).to.equal(false);
    await finalizeExactResult(f.coordinator, f.request.requestId, [f.first, f.second], false, f.resultHash);
    expect((await f.manager.getClaim(1)).status).to.equal(5); // ORACLE_FAILED
    expect(await f.manager.manualReviewEligibleAt(1)).to.be.greaterThan(0);
  });
  it("rolls the future default back without reinterpreting an in-flight XGBoost request", async () => {
    const f = await setup();
    await f.manager.updateOracleModelVersion(f.active.legacyModelIdentityHash);
    const pinned = await f.coordinator.getRequest(f.request.requestId);
    expect(pinned.modelVersion).to.equal(f.active.modelIdentityHash);
    expect(resolveRequestModel(pinned.modelVersion).kind).to.equal("xgboost");
    expect(resolveRequestModel(await f.manager.oracleModelVersion()).kind).to.equal("legacy-nb");
    await finalizeExactResult(f.coordinator, f.request.requestId, [f.first, f.second], f.assessed.verified, f.resultHash);
    expect((await f.coordinator.getRequest(f.request.requestId)).isFulfilled).to.equal(true);
  });
  it("keeps a pending NB request evaluable after publishing the XGBoost default", async () => {
    const f = await setup("0.1", true);
    await f.manager.updateOracleModelVersion(f.active.modelIdentityHash);
    const pinned = await f.coordinator.getRequest(f.request.requestId);
    expect(pinned.modelVersion).to.equal(f.active.legacyModelIdentityHash);
    const selected = resolveRequestModel(pinned.modelVersion);
    expect(selected.kind).to.equal("legacy-nb");
    // Existing workers use this unchanged historical evaluator, never the new
    // threshold, when interpreting the snapshotted NB request.
    const claim = await f.manager.getClaim(1);
    const day = new Date(Number(claim.incidentDate) * 1000).toISOString();
    const record = { hospitalId: claim.hospitalId, patientHash: ethers.id("synthetic-patient"), invoiceNumber: "migration-invoice",
      authorizedClaimants: [claim.claimantWallet.toLowerCase()], invoiceHash: claim.invoiceHash,
      billAmount: "0.1", expectedBillMin: "0.01", expectedBillMax: "1", treatmentType: claim.claimType,
      admissionDate: day, dischargeDate: day, invoiceDate: day, licenseStatus: "ACTIVE", recordStatus: "VALID", invoiceStatus: "VALID" };
    const assessment = require("../../oracle/independentAssessment").independentlyAssessRecord({ record,
      claim: { claimantWallet: claim.claimantWallet, hospitalId: claim.hospitalId, invoiceHash: claim.invoiceHash, claimAmountEth: "0.1",
        claimType: claim.claimType, incidentDate: claim.incidentDate.toString() }, modelArtifact: selected.artifact,
      triagePolicy: require("../../backEnd/triage-policy.json") });
    expect(assessment.verified).to.equal(true);
    const resultHash = buildResultHash({ request: pinned, verified: assessment.verified,
      verificationCode: assessment.verificationCode, leafHash: hashCanonicalRecord(record) });
    await finalizeExactResult(f.coordinator, pinned.requestId, [f.first, f.second], assessment.verified, resultHash);
    expect((await f.coordinator.getRequest(pinned.requestId)).isFulfilled).to.equal(true);
  });
});
