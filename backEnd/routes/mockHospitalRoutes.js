const express = require("express");
const {
  getAllHospitalRecords,
  verifyHospitalRecord,
} = require("../controllers/mockHospitalController");

const router = express.Router();

router.get("/records", getAllHospitalRecords);
router.get("/verify", verifyHospitalRecord);

module.exports = router;