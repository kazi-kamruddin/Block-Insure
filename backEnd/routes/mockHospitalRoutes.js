const express = require("express");
const {
  getAllHospitalRecords,
  getHospitalRecordById,
  getHospitalRegistrySummary,
  verifyHospitalRecord,
} = require("../controllers/mockHospitalController");
const authMiddleware = require("../middleware/authMiddleware");
const { requireRole } = require("../middleware/roleMiddleware");

const router = express.Router();

router.get(
  "/records",
  authMiddleware,
  requireRole("ADMIN", "AUDITOR"),
  getAllHospitalRecords
);
router.get(
  "/records/summary",
  authMiddleware,
  requireRole("ADMIN", "AUDITOR"),
  getHospitalRegistrySummary
);
router.get(
  "/records/:id",
  authMiddleware,
  requireRole("ADMIN", "AUDITOR"),
  getHospitalRecordById
);
router.get("/verify", verifyHospitalRecord);

module.exports = router;
