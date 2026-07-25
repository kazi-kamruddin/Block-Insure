const express = require("express");
const {
  uploadDocument,
  verifyDocument,
  attachClaimIdToDocument,
} = require("../controllers/documentController");
const authMiddleware = require("../middleware/authMiddleware");
const upload = require("../middleware/uploadMiddleware");
const claimSubmissionRateLimit = require("../middleware/claimSubmissionRateLimit");

const router = express.Router();

router.post(
  "/upload",
  authMiddleware,
  claimSubmissionRateLimit,
  upload.single("document"),
  uploadDocument
);
router.patch("/:id/claim", authMiddleware, attachClaimIdToDocument);
router.get("/:id/verify", authMiddleware, verifyDocument);

module.exports = router;
