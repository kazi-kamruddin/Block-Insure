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
// Archived attestation routes are deliberately unavailable in the new protocol.
router.all(["/claim-requests", "/claim-requests/:claimId", "/claim-requests/:claimId/confirm", "/claim-verifications/:claimId"], (req, res) =>
  res.status(410).json({ success: false, message: "Per-claim hospital attestation is retired. Workers verify published records automatically." }));
module.exports = router;
