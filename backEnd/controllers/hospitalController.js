const { ethers } = require("ethers");
const Hospital = require("../models/Hospital");
const HospitalClaimVerification = require("../models/HospitalClaimVerification");
const MockHospitalRecord = require("../models/MockHospitalRecord");
const {
  getHospitalVerificationRegistry,
  getReadOnlyContract,
} = require("../services/contractService");
const {
  findHospitalByWallet,
  formatHospital,
} = require("../services/hospitalDirectoryService");
const {
  buildHospitalVerificationAssessment,
  formatHospitalVerification,
} = require("../services/hospitalVerificationService");
const { logAdminAction } = require("../services/adminActionLogService");
const { notifyAdmins, notifyWallet } = require("../services/notificationService");

const CLAIM_STATUS = [
  "SUBMITTED", "DUPLICATE_CHECKED", "FRAUD_FLAGGED", "ORACLE_PENDING",
  "ORACLE_VERIFIED", "ORACLE_FAILED", "MANUAL_REVIEW", "PAYOUT_READY",
  "REJECTED", "SETTLED", "CLOSED", "FUNDING_REQUIRED", "APPEALED",
];

const createError = (message, statusCode = 400) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

const escapeRegex = (value) =>
  String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const getHospitalIdentity = async (user) => {
  const hospital = await findHospitalByWallet(user.walletAddress);
  if (!hospital || hospital.networkStatus !== "CONTRACTED") {
    const error = new Error("No active hospital identity is assigned to this wallet");
    error.statusCode = 403;
    throw error;
  }
  return hospital;
};

const formatRecord = (record) => ({
  id: record._id,
  hospitalId: record.hospitalId,
  hospitalName: record.hospitalName,
  patientHash: record.patientHash,
  invoiceNumber: record.invoiceNumber,
  invoiceHash: record.invoiceHash,
  treatmentType: record.treatmentType,
  diagnosisCode: record.diagnosisCode,
  admissionDate: record.admissionDate,
  dischargeDate: record.dischargeDate,
  invoiceDate: record.invoiceDate,
  billAmount: record.billAmount,
  invoiceStatus: record.invoiceStatus,
  recordStatus: record.recordStatus,
  createdAt: record.createdAt,
  updatedAt: record.updatedAt,
});

const formatClaimRequest = (claim) => ({
  claimId: claim.claimId.toString(),
  policyId: claim.policyId.toString(),
  claimantWallet: claim.claimantWallet,
  claimAmountWei: claim.claimAmount.toString(),
  claimAmountEth: ethers.formatEther(claim.claimAmount),
  incidentDate: new Date(Number(claim.incidentDate) * 1000).toISOString(),
  claimType: claim.claimType,
  hospitalId: claim.hospitalId,
  invoiceHash: claim.invoiceHash,
  status: CLAIM_STATUS[Number(claim.status)] || "UNKNOWN",
  submittedAt: new Date(Number(claim.submittedAt) * 1000).toISOString(),
});

const getOwnedClaimAssessment = async (hospital, claimId) => {
  if (!/^\d+$/.test(String(claimId || ""))) {
    throw createError("A valid claim id is required");
  }
  const contract = getReadOnlyContract();
  const claim = await contract.getClaim(claimId);
  if (claim.hospitalId !== hospital.hospitalId) {
    throw createError("Claim belongs to another hospital", 403);
  }
  const claimVersion = Number(await contract.claimVersion(claimId));
  const record = await MockHospitalRecord.findOne({
    hospitalId: hospital.hospitalId,
    invoiceHash: String(claim.invoiceHash).toLowerCase(),
  }).lean();
  const assessment = buildHospitalVerificationAssessment({
    claim,
    claimVersion,
    hospital,
    record,
  });
  const savedVerification = await HospitalClaimVerification.findOne({
    claimId: String(claimId),
    claimVersion,
  }).lean();
  return {
    contract,
    verificationContract: getHospitalVerificationRegistry(contract.runner),
    claim,
    claimVersion,
    record,
    assessment,
    savedVerification,
  };
};

const getNetworkHospitals = async (_req, res, next) => {
  try {
    const hospitals = await Hospital.find({ networkStatus: "CONTRACTED" })
      .sort({ hospitalId: 1 })
      .lean();
    res.status(200).json({
      success: true,
      count: hospitals.length,
      hospitals: hospitals.map(formatHospital),
    });
  } catch (error) {
    next(error);
  }
};

const getMyHospitalProfile = async (req, res, next) => {
  try {
    const hospital = await getHospitalIdentity(req.user);
    const recordFilter = { hospitalId: hospital.hospitalId };
    const [totalRecords, validRecords, usedRecords, cancelledRecords] =
      await Promise.all([
        MockHospitalRecord.countDocuments(recordFilter),
        MockHospitalRecord.countDocuments({ ...recordFilter, recordStatus: "VALID" }),
        MockHospitalRecord.countDocuments({ ...recordFilter, recordStatus: "USED" }),
        MockHospitalRecord.countDocuments({ ...recordFilter, recordStatus: "CANCELLED" }),
      ]);

    res.status(200).json({
      success: true,
      hospital: formatHospital(hospital),
      summary: { totalRecords, validRecords, usedRecords, cancelledRecords },
      capabilities: {
        viewOwnedRecords: true,
        createRecords: true,
        maintainRecords: true,
        verifyClaims: true,
        onChainAttestations: true,
        note: "The hospital owns its records and independently attests claim matches before insurer processing.",
      },
    });
  } catch (error) {
    next(error);
  }
};

const createMyHospitalRecord = async (req, res, next) => {
  try {
    const hospital = await getHospitalIdentity(req.user);
    const invoiceNumber = String(req.body.invoiceNumber || "").trim();
    const patientReference = String(req.body.patientReference || "").trim();
    const treatmentType = String(req.body.treatmentType || "").trim().toUpperCase();
    const diagnosisCode = String(req.body.diagnosisCode || "").trim().toUpperCase();
    const billAmount = String(req.body.billAmount || "").trim();
    const admissionDate = new Date(req.body.admissionDate);
    const dischargeDate = new Date(req.body.dischargeDate);
    const invoiceDate = new Date(req.body.invoiceDate || req.body.dischargeDate);

    if (!invoiceNumber || !patientReference || !treatmentType || !diagnosisCode) {
      throw createError(
        "invoiceNumber, patientReference, treatmentType, and diagnosisCode are required"
      );
    }
    if (
      [admissionDate, dischargeDate, invoiceDate].some((date) =>
        Number.isNaN(date.getTime())
      ) || dischargeDate < admissionDate
    ) {
      throw createError("Valid admission, discharge, and invoice dates are required");
    }
    try {
      if (ethers.parseEther(billAmount) <= 0n) throw new Error("non-positive");
    } catch {
      throw createError("Bill amount must be a positive ETH amount");
    }

    const invoiceHash = ethers.keccak256(ethers.toUtf8Bytes(invoiceNumber));
    const record = await MockHospitalRecord.create({
      hospitalId: hospital.hospitalId,
      providerId: hospital.hospitalId,
      hospitalName: hospital.name,
      division: hospital.division,
      district: hospital.district,
      hospitalTier: hospital.hospitalTier,
      licenseStatus: "ACTIVE",
      patientHash: ethers.keccak256(ethers.toUtf8Bytes(patientReference)),
      treatmentType,
      diagnosisCode,
      admissionDate,
      dischargeDate,
      invoiceDate,
      occurredAt: admissionDate,
      billAmount,
      expectedBillMin: billAmount,
      expectedBillMax: billAmount,
      invoiceNumber,
      invoiceHash,
      invoiceStatus: "VALID",
      recordStatus: "VALID",
      fraudLabel: "LEGITIMATE",
      fraudSignals: {},
      actualFraud: false,
      controlledAttackTruth: false,
      syntheticSource: "hospital-maintained-v1",
      baseDataOrigin: "FULLY_SYNTHETIC",
      claimSetting: "SYNTHETIC",
    });

    res.status(201).json({
      success: true,
      message: "Hospital record created. Publish a new registry commitment before oracle use.",
      registryCommitmentPending: true,
      record: formatRecord(record),
    });
  } catch (error) {
    if (error?.code === 11000) {
      return next(createError("Invoice number or invoice hash already exists", 409));
    }
    next(error);
  }
};

const updateMyHospitalRecord = async (req, res, next) => {
  try {
    const hospital = await getHospitalIdentity(req.user);
    const allowed = [
      "treatmentType", "diagnosisCode", "admissionDate", "dischargeDate",
      "invoiceDate", "billAmount", "invoiceStatus", "recordStatus",
    ];
    const updates = Object.fromEntries(
      allowed.filter((key) => req.body[key] !== undefined).map((key) => [key, req.body[key]])
    );
    if (Object.keys(updates).length === 0) throw createError("No supported record changes supplied");
    if (updates.treatmentType) updates.treatmentType = String(updates.treatmentType).trim().toUpperCase();
    if (updates.diagnosisCode) updates.diagnosisCode = String(updates.diagnosisCode).trim().toUpperCase();
    if (updates.billAmount !== undefined) {
      try {
        if (ethers.parseEther(String(updates.billAmount)) <= 0n) throw new Error("non-positive");
      } catch {
        throw createError("Bill amount must be a positive ETH amount");
      }
      updates.billAmount = String(updates.billAmount);
    }
    for (const key of ["admissionDate", "dischargeDate", "invoiceDate"]) {
      if (updates[key] !== undefined) {
        updates[key] = new Date(updates[key]);
        if (Number.isNaN(updates[key].getTime())) throw createError(`${key} is invalid`);
      }
    }
    const currentRecord = await MockHospitalRecord.findOne({
      _id: req.params.id,
      hospitalId: hospital.hospitalId,
    }).lean();
    if (!currentRecord) throw createError("Hospital record not found", 404);
    const nextAdmissionDate = updates.admissionDate || currentRecord.admissionDate;
    const nextDischargeDate = updates.dischargeDate || currentRecord.dischargeDate;
    if (nextDischargeDate < nextAdmissionDate) {
      throw createError("Discharge date cannot precede admission date");
    }
    const record = await MockHospitalRecord.findOneAndUpdate(
      { _id: req.params.id, hospitalId: hospital.hospitalId },
      { $set: updates },
      { returnDocument: "after", runValidators: true }
    );
    res.status(200).json({
      success: true,
      message: "Hospital record updated. Publish a new registry commitment before oracle use.",
      registryCommitmentPending: true,
      record: formatRecord(record),
    });
  } catch (error) {
    next(error);
  }
};

const getMyClaimRequests = async (req, res, next) => {
  try {
    const hospital = await getHospitalIdentity(req.user);
    const contract = getReadOnlyContract();
    const nextClaimId = Number(await contract.claimCounter());
    const claims = await Promise.all(
      Array.from({ length: Math.max(nextClaimId - 1, 0) }, (_, index) => index + 1)
        .map((claimId) => contract.getClaim(claimId))
    );
    const ownedClaims = claims.filter((claim) => claim.hospitalId === hospital.hospitalId);
    const requests = await Promise.all(
      ownedClaims.map(async (claim) => {
        const claimId = claim.claimId.toString();
        const claimVersion = Number(await contract.claimVersion(claimId));
        const verification = await HospitalClaimVerification.findOne({ claimId, claimVersion }).lean();
        return {
          ...formatClaimRequest(claim),
          claimVersion,
          verification: formatHospitalVerification(verification),
        };
      })
    );
    res.status(200).json({ success: true, count: requests.length, requests: requests.reverse() });
  } catch (error) {
    next(error);
  }
};

const getMyClaimRequest = async (req, res, next) => {
  try {
    const hospital = await getHospitalIdentity(req.user);
    const result = await getOwnedClaimAssessment(hospital, req.params.claimId);
    res.status(200).json({
      success: true,
      claim: formatClaimRequest(result.claim),
      claimVersion: result.claimVersion,
      matchedRecord: result.record ? formatRecord(result.record) : null,
      proposedVerification: result.assessment,
      verification: formatHospitalVerification(result.savedVerification),
    });
  } catch (error) {
    next(error);
  }
};

const confirmMyClaimVerification = async (req, res, next) => {
  try {
    const hospital = await getHospitalIdentity(req.user);
    const transactionHash = String(req.body.transactionHash || "").trim().toLowerCase();
    const note = String(req.body.note || "").trim().slice(0, 500);
    if (!/^0x[a-f\d]{64}$/.test(transactionHash)) {
      throw createError("A valid transactionHash is required");
    }
    const existing = await HospitalClaimVerification.findOne({ transactionHash }).lean();
    if (existing) {
      return res.status(200).json({
        success: true,
        idempotent: true,
        verification: formatHospitalVerification(existing),
      });
    }
    const result = await getOwnedClaimAssessment(hospital, req.params.claimId);
    const [receipt, transaction] = await Promise.all([
      result.verificationContract.runner.getTransactionReceipt(transactionHash),
      result.verificationContract.runner.getTransaction(transactionHash),
    ]);
    if (!receipt || !transaction) {
      return res.status(202).json({ success: false, pending: true, message: "Hospital transaction is still pending" });
    }
    if (Number(receipt.status) !== 1) throw createError("Hospital verification transaction reverted", 409);
    if (transaction.to?.toLowerCase() !== String(result.verificationContract.target).toLowerCase()) {
      throw createError("Transaction does not target HospitalVerificationRegistry", 409);
    }
    if (transaction.from.toLowerCase() !== hospital.walletAddress.toLowerCase()) {
      throw createError("Transaction signer does not match this hospital wallet", 403);
    }
    let event = null;
    for (const log of receipt.logs) {
      try {
        const parsed = result.verificationContract.interface.parseLog(log);
        if (parsed?.name === "HospitalClaimVerified" && parsed.args.claimId.toString() === String(req.params.claimId)) {
          event = parsed;
          break;
        }
      } catch {
        // Ignore logs from other contracts.
      }
    }
    if (!event) throw createError("Transaction does not contain the expected hospital verification", 409);
    if (
      Boolean(event.args.verified) !== result.assessment.verified ||
      String(event.args.attestationHash).toLowerCase() !== result.assessment.attestationHash.toLowerCase() ||
      Number(event.args.claimVersion) !== result.claimVersion
    ) {
      throw createError("On-chain attestation does not match the current hospital record", 409);
    }

    const verification = await HospitalClaimVerification.findOneAndUpdate(
      { claimId: String(req.params.claimId), claimVersion: result.claimVersion },
      {
        $set: {
          hospitalId: hospital.hospitalId,
          hospitalWallet: hospital.walletAddress,
          recordId: result.record?._id || null,
          invoiceHash: result.claim.invoiceHash,
          ...result.assessment,
          transactionHash,
          blockNumber: receipt.blockNumber,
          note,
          verifiedAt: new Date(Number(event.args.verifiedAt) * 1000),
        },
      },
      { upsert: true, returnDocument: "after", runValidators: true }
    );
    await Promise.all([
      notifyAdmins({
        actorWallet: hospital.walletAddress,
        type: "HOSPITAL_CLAIM_VERIFIED",
        title: `${hospital.name} completed claim #${req.params.claimId} verification`,
        message: `Hospital outcome: ${result.assessment.outcome}. Insurer processing may now continue.`,
        claimId: String(req.params.claimId),
        status: result.assessment.outcome,
        link: `/admin/claims/${req.params.claimId}`,
        dedupeKey: `hospital-verification:${req.params.claimId}:${result.claimVersion}`,
      }),
      notifyWallet(result.claim.claimantWallet, {
        actorWallet: hospital.walletAddress,
        type: "HOSPITAL_CLAIM_VERIFIED",
        title: `Hospital verification completed for claim #${req.params.claimId}`,
        message: `${hospital.name} reported ${result.assessment.outcome}.`,
        claimId: String(req.params.claimId),
        status: result.assessment.outcome,
        link: `/user/claims/${req.params.claimId}`,
        dedupeKey: `claimant-hospital-verification:${req.params.claimId}:${result.claimVersion}`,
      }),
      logAdminAction({
        req,
        action: "HOSPITAL_CLAIM_VERIFICATION",
        targetType: "CLAIM",
        targetId: req.params.claimId,
        tx: { hash: transactionHash },
        receipt,
        metadata: { outcome: result.assessment.outcome, attestationHash: result.assessment.attestationHash },
      }),
    ]);
    res.status(200).json({
      success: true,
      message: "Hospital verification confirmed on-chain and shared with the insurer",
      verification: formatHospitalVerification(verification),
    });
  } catch (error) {
    if (error?.code === 11000) {
      return next(createError("This claim version already has a hospital verification", 409));
    }
    next(error);
  }
};

const getClaimVerificationForInsurer = async (req, res, next) => {
  try {
    const verification = await HospitalClaimVerification.findOne({
      claimId: String(req.params.claimId),
    }).sort({ claimVersion: -1 }).lean();
    res.status(200).json({
      success: true,
      verification: formatHospitalVerification(verification),
      status: verification ? verification.outcome : "PENDING_HOSPITAL",
    });
  } catch (error) {
    next(error);
  }
};

const getMyHospitalRecords = async (req, res, next) => {
  try {
    const hospital = await getHospitalIdentity(req.user);
    const page = Math.max(Number.parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(
      Math.max(Number.parseInt(req.query.limit, 10) || 25, 1),
      100
    );
    const filter = { hospitalId: hospital.hospitalId };
    if (req.query.recordStatus) filter.recordStatus = req.query.recordStatus;
    if (req.query.invoiceStatus) filter.invoiceStatus = req.query.invoiceStatus;
    if (req.query.treatmentType) filter.treatmentType = req.query.treatmentType;
    if (req.query.q) {
      const search = new RegExp(escapeRegex(String(req.query.q).slice(0, 80)), "i");
      filter.$or = [
        { invoiceNumber: search },
        { invoiceHash: search },
        { patientHash: search },
        { diagnosisCode: search },
      ];
    }

    const [records, total] = await Promise.all([
      MockHospitalRecord.find(filter)
        .sort({ invoiceDate: -1, _id: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      MockHospitalRecord.countDocuments(filter),
    ]);

    res.status(200).json({
      success: true,
      hospital: formatHospital(hospital),
      count: records.length,
      records: records.map(formatRecord),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.max(Math.ceil(total / limit), 1),
      },
    });
  } catch (error) {
    next(error);
  }
};

const getMyHospitalRecordById = async (req, res, next) => {
  try {
    const hospital = await getHospitalIdentity(req.user);
    const record = await MockHospitalRecord.findOne({
      _id: req.params.id,
      hospitalId: hospital.hospitalId,
    }).lean();
    if (!record) {
      return res.status(404).json({ success: false, message: "Hospital record not found" });
    }
    res.status(200).json({ success: true, record: formatRecord(record) });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  confirmMyClaimVerification,
  createMyHospitalRecord,
  getClaimVerificationForInsurer,
  getMyClaimRequest,
  getMyClaimRequests,
  getMyHospitalProfile,
  getMyHospitalRecordById,
  getMyHospitalRecords,
  getNetworkHospitals,
  updateMyHospitalRecord,
};
