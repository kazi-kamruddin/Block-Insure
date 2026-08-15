const express = require("express");
const authMiddleware = require("../middleware/authMiddleware");
const { requireRole } = require("../middleware/roleMiddleware");
const {
  listIndexedEvents,
  runIndexer,
} = require("../controllers/indexerController");

const router = express.Router();
router.get("/events", authMiddleware, listIndexedEvents);
router.post("/run", authMiddleware, requireRole("ADMIN"), runIndexer);

module.exports = router;
