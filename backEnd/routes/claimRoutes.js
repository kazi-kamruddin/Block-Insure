const express = require("express");
const {
  getMyClaims,
  getClaimById,
  getClaimDocumentHash,
} = require("../controllers/claimController");
const authMiddleware = require("../middleware/authMiddleware");

const router = express.Router();

router.get("/my", authMiddleware, getMyClaims);
router.get("/:claimId/document-hash", authMiddleware, getClaimDocumentHash);
router.get("/:claimId", authMiddleware, getClaimById);

module.exports = router;
