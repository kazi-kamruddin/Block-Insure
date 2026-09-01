const express = require("express");
const {
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
} = require("../controllers/hospitalController");
const authMiddleware = require("../middleware/authMiddleware");
const { requireRole } = require("../middleware/roleMiddleware");

const router = express.Router();

router.get("/network", getNetworkHospitals);
router.get("/me", authMiddleware, requireRole("HOSPITAL"), getMyHospitalProfile);
router.get(
  "/claim-verifications/:claimId",
  authMiddleware,
  requireRole("ADMIN", "AUDITOR"),
  getClaimVerificationForInsurer
);
router.get(
  "/claim-requests",
  authMiddleware,
  requireRole("HOSPITAL"),
  getMyClaimRequests
);
router.get(
  "/claim-requests/:claimId",
  authMiddleware,
  requireRole("HOSPITAL"),
  getMyClaimRequest
);
router.post(
  "/claim-requests/:claimId/confirm",
  authMiddleware,
  requireRole("HOSPITAL"),
  confirmMyClaimVerification
);
router.get(
  "/records",
  authMiddleware,
  requireRole("HOSPITAL"),
  getMyHospitalRecords
);
router.post(
  "/records",
  authMiddleware,
  requireRole("HOSPITAL"),
  createMyHospitalRecord
);
router.get(
  "/records/:id",
  authMiddleware,
  requireRole("HOSPITAL"),
  getMyHospitalRecordById
);
router.patch(
  "/records/:id",
  authMiddleware,
  requireRole("HOSPITAL"),
  updateMyHospitalRecord
);

module.exports = router;
