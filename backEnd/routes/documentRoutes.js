const express = require("express");
const {
  uploadDocument,
  verifyDocument,
} = require("../controllers/documentController");
const authMiddleware = require("../middleware/authMiddleware");
const upload = require("../middleware/uploadMiddleware");

const router = express.Router();

router.post("/upload", authMiddleware, upload.single("document"), uploadDocument);
router.get("/:id/verify", authMiddleware, verifyDocument);

module.exports = router;