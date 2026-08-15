const mongoose = require("mongoose");

const evidenceEventSchema = new mongoose.Schema(
  {
    treeIndex: { type: Number, required: true, min: 0, unique: true, index: true },
    eventType: { type: String, required: true, trim: true, index: true },
    claimId: { type: String, trim: true, default: "", index: true },
    claimVersion: { type: Number, min: 0, default: 0 },
    documentId: { type: mongoose.Schema.Types.ObjectId, ref: "File", default: null },
    actorWallet: { type: String, required: true, lowercase: true, trim: true },
    canonicalEvent: { type: String, required: true },
    leafHash: { type: String, required: true, unique: true, index: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model("EvidenceEvent", evidenceEventSchema);
