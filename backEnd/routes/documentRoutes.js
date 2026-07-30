const express = require("express");
const {
  uploadDocument,
  verifyDocument,
  attachClaimIdToDocument,
  getEncryptionPublicKey,
  getDecryptionKey,
} = require("../controllers/documentController");
const authMiddleware = require("../middleware/authMiddleware");
const upload = require("../middleware/uploadMiddleware");
const claimSubmissionRateLimit = require("../middleware/claimSubmissionRateLimit");

const router = express.Router();

router.get("/encryption-key", authMiddleware, getEncryptionPublicKey);
router.post(
  "/upload",
  authMiddleware,
  claimSubmissionRateLimit,
  upload.single("document"),
  uploadDocument
);
router.patch("/:id/claim", authMiddleware, attachClaimIdToDocument);
router.get("/:id/verify", authMiddleware, verifyDocument);
router.get("/:id/decryption-key", authMiddleware, getDecryptionKey);

module.exports = router;
