const express = require("express");
const {
  uploadDocument,
  verifyDocument,
  attachClaimIdToDocument,
  getEncryptionPublicKey,
  getDecryptionKey,
  getRecipientEncryptionIdentity,
  grantEvidenceAccess,
  revokeEvidenceAccess,
  registerEncryptionIdentity,
  getReceipt,
} = require("../controllers/documentController");
const authMiddleware = require("../middleware/authMiddleware");
const upload = require("../middleware/uploadMiddleware");
const claimSubmissionRateLimit = require("../middleware/claimSubmissionRateLimit");

const router = express.Router();

router.get("/encryption-key", authMiddleware, getEncryptionPublicKey);
router.post("/encryption-key", authMiddleware, registerEncryptionIdentity);
router.get(
  "/encryption-identities/:walletAddress",
  authMiddleware,
  getRecipientEncryptionIdentity
);
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
router.post("/:id/grants", authMiddleware, grantEvidenceAccess);
router.delete("/:id/grants", authMiddleware, revokeEvidenceAccess);
router.get("/:id/receipt", authMiddleware, getReceipt);

module.exports = router;
