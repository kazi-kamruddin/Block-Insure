const express = require("express");
const {
  getAllHospitalRecords,
  getHospitalRecordById,
  getHospitalOnChainRegistryMerkleRoot,
  getHospitalRegistryMerkleProof,
  getHospitalRegistryMerkleRoot,
  getHospitalRegistrySummary,
  verifyHospitalRecord,
} = require("../controllers/mockHospitalController");
const authMiddleware = require("../middleware/authMiddleware");
const { requireRole } = require("../middleware/roleMiddleware");
const requireOracleApiKey = require("../middleware/oracleApiKeyMiddleware");

const router = express.Router();

router.get(
  "/records",
  authMiddleware,
  requireRole("ADMIN"),
  getAllHospitalRecords
);
router.get(
  "/records/summary",
  authMiddleware,
  requireRole("ADMIN"),
  getHospitalRegistrySummary
);
router.get(
  "/records/merkle-root",
  authMiddleware,
  requireRole("ADMIN"),
  getHospitalRegistryMerkleRoot
);
router.get(
  "/records/on-chain-merkle-root",
  authMiddleware,
  requireRole("ADMIN"),
  getHospitalOnChainRegistryMerkleRoot
);
router.get(
  "/records/merkle-proof",
  authMiddleware,
  requireRole("ADMIN"),
  getHospitalRegistryMerkleProof
);
router.get(
  "/records/:id",
  authMiddleware,
  requireRole("ADMIN"),
  getHospitalRecordById
);
router.get("/verify", requireOracleApiKey, verifyHospitalRecord);

module.exports = router;
