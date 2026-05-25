const express = require("express");
const {
  getActivePolicyPackages,
} = require("../controllers/policyController");

const router = express.Router();

router.get("/", getActivePolicyPackages);

module.exports = router;