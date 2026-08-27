const express = require("express");
const {
  anchorLatestTreeHead,
  getConsistencyProof,
  getLatestTreeHead,
} = require("../controllers/evidenceTransparencyController");
const authMiddleware = require("../middleware/authMiddleware");
const { requireRole } = require("../middleware/roleMiddleware");

const router = express.Router();

router.get("/tree-heads/latest", getLatestTreeHead);
router.get("/consistency-proof", getConsistencyProof);
router.post(
  "/tree-heads/anchor",
  authMiddleware,
  requireRole("ADMIN"),
  anchorLatestTreeHead
);

module.exports = router;
