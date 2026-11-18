const express = require("express");
const { createMyHospitalRecord, getMyHospitalProfile, getMyHospitalRecordById,
  getMyHospitalRecords, getNetworkHospitals, updateMyHospitalRecord } = require("../controllers/hospitalController");
const staffAuth = require("../middleware/hospitalStaffAuth");
const authMiddleware = require("../middleware/authMiddleware");
const { requireRole } = require("../middleware/roleMiddleware");
const Hospital = require("../models/Hospital");
const Record = require("../models/MockHospitalRecord");
const { logAdminAction } = require("../services/adminActionLogService");
const router = express.Router();
router.get("/network", getNetworkHospitals);
router.get("/me", staffAuth, getMyHospitalProfile);
router.get("/records", staffAuth, getMyHospitalRecords);
router.post("/records", staffAuth, createMyHospitalRecord);
router.get("/records/:id", staffAuth, getMyHospitalRecordById);
router.patch("/records/:id", staffAuth, updateMyHospitalRecord);
router.get("/insurer/records/:hospitalId", authMiddleware, requireRole("ADMIN"), async (req, res, next) => {
  try {
    const hospital = await Hospital.findOne({ hospitalId: req.params.hospitalId.toUpperCase(), networkStatus: "CONTRACTED" });
    if (!hospital) return res.status(404).json({ success: false, message: "Contracted hospital not found." });
    const page = Math.max(1, Math.min(10000, parseInt(req.query.page, 10) || 1));
    const records = await Record.find({ hospitalId: hospital.hospitalId }).sort({ _id: 1 }).skip((page - 1) * 50).limit(50)
      .select("hospitalId invoiceNumber invoiceHash patientHash treatmentType diagnosisCode admissionDate dischargeDate billAmount recordStatus invoiceStatus publicationPending identityVersion sourceRevision").lean();
    await logAdminAction({ req, action: "INSURER_SOURCE_RECORDS_READ", targetType: "Hospital", targetId: hospital.hospitalId, metadata: { page, count: records.length } });
    res.json({ success: true, records, page });
  } catch (error) { next(error); }
});
router.post("/insurer/publish", authMiddleware, requireRole("ADMIN", "CLAIM_OFFICER"), async (req, res, next) => {
  try {
    const job = await require("../services/registryPublicationService").publishPendingRegistry();
    res.json({ success: true, message: job ? "Publication processed." : "No pending records." });
  } catch (error) { next(error); }
});
router.get("/insurer/unlinked", authMiddleware, requireRole("ADMIN", "CLAIM_OFFICER"), async (req, res, next) => {
  try {
    const page = Math.max(1, Math.min(10000, parseInt(req.query.page, 10) || 1));
    const rows = await Record.find({ identityVersion: 2, createdByStaffId: { $nin: ["", null] }, authorizedClaimants: { $size: 0 } })
      .sort({ updatedAt: -1, _id: 1 }).skip((page - 1) * 50).limit(50)
      .select("hospitalId invoiceNumber sourceRevision +patientContact").lean();
    const contacts = rows.map(row => row.patientContact).filter(Boolean);
    const beneficiaries = await require("../models/User").find({ verifiedEmail: { $in: contacts }, emailVerifiedAt: { $ne: null } })
      .select("walletAddress +verifiedEmail").lean();
    res.set("Cache-Control", "private, no-store").json({ records: rows.map(row => ({
      hospitalId: row.hospitalId, invoiceNumber: row.invoiceNumber, revision: row.sourceRevision,
      candidates: beneficiaries.filter(user => user.verifiedEmail === row.patientContact).map(user => user.walletAddress),
    })) });
  } catch (error) { next(error); }
});
router.put("/insurer/association", authMiddleware, requireRole("ADMIN", "CLAIM_OFFICER"), async (req, res, next) => {
  try {
    const { hospitalId, invoiceNumber, patientReference, wallet, reason, revision } = req.body;
    if (![hospitalId, invoiceNumber, patientReference, reason].every(value => typeof value === "string" && value.trim() && value.length <= 256) ||
        (wallet !== null && !require("ethers").isAddress(wallet)) || !Number.isSafeInteger(revision)) {
      return res.status(422).json({ message: "Supply verified episode details, current revision and decision basis." });
    }
    const issuer = hospitalId.trim().toUpperCase();
    const patientHash = require("../../oracle/recordIdentity").patientIdentity(issuer, patientReference);
    const record = await Record.findOneAndUpdate({ hospitalId: issuer, invoiceNumber: invoiceNumber.trim(), patientHash, sourceRevision: revision },
      { $set: { authorizedClaimants: wallet ? [wallet.toLowerCase()] : [], publicationPending: true }, $inc: { sourceRevision: 1 },
        $push: { associationHistory: { actor: req.user.walletAddress, wallet, reason, revision: revision + 1, at: new Date() } } }, { new: true });
    if (!record) return res.status(409).json({ message: "Verified episode details or revision do not match." });
    await require("../services/registryPublicationService").queueRegistryPublication();
    res.json({ success: true, revision: record.sourceRevision });
  } catch (error) { next(error); }
});
router.get("/my-episodes", authMiddleware, async (req, res, next) => {
  try {
    const records = await Record.find({ authorizedClaimants: req.user.walletAddress.toLowerCase(), publicationPending: { $ne: true },
      recordStatus: "VALID", invoiceStatus: "VALID", licenseStatus: "ACTIVE" })
      .select("invoiceNumber hospitalId invoiceHash treatmentType admissionDate dischargeDate billAmount sourceRevision")
      .sort({ admissionDate: -1, _id: 1 }).limit(200).lean();
    res.set("Cache-Control", "private, no-store").json({ records });
  } catch (error) { next(error); }
});
// Archived attestation routes are deliberately unavailable in the new protocol.
router.all(["/claim-requests", "/claim-requests/:claimId", "/claim-requests/:claimId/confirm", "/claim-verifications/:claimId"], (req, res) =>
  res.status(410).json({ success: false, message: "Per-claim hospital attestation is retired. Workers verify published records automatically." }));
module.exports = router;
