const mongoose = require("mongoose");
const schema = new mongoose.Schema({
  deploymentScope: { type: String, required: true, index: true },
  packageId: { type: String, required: true },
  version: { type: String, required: true },
  policyRuleVersion: { type: String, required: true },
  ruleDocument: { type: String, required: true },
}, { timestamps: true });
schema.index({ deploymentScope: 1, policyRuleVersion: 1 }, { unique: true });
module.exports = mongoose.model("PolicyRulePublication", schema);
