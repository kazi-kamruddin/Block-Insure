// Pure protocol routing over the complete pinned XGBoost context. No network,
// label learning or authority over Auditor votes, reserves or withdrawals.
const { assessShadowPacket, hash } = require("./shadowAssessment");

function assessProtocol(packet, authoritative, loaded) {
  const assessed = assessShadowPacket(packet, authoritative, loaded);
  if (!Number.isSafeInteger(assessed.result.scoreUnits) || assessed.result.scoreUnits < 0 || assessed.result.scoreUnits > 1e9 ||
      !["REVIEW_RECOMMENDED", "NO_ADDITIONAL_MODEL_REVIEW"].includes(assessed.result.recommendation)) {
    throw new Error("Invalid protocol inference result");
  }
  const verified = assessed.result.recommendation === "NO_ADDITIONAL_MODEL_REVIEW";
  // Bind the score, cutoff policy, context and explanation to exact agreement.
  // Verification codes are opaque strings already hashed by the v1 ABI.
  const digest = hash({ contextId: assessed.contextId, resultHash: assessed.resultHash,
    contextHash: assessed.contextHash, explanationHash: assessed.explanationHash });
  return { verified, verificationCode: `${verified ? "XGB_AUTO" : "XGB_REVIEW"}:${digest}`,
    model: "XGBoost", authority: "ORACLE_ROUTING", score: assessed.result.scoreUnits / 1e9,
    riskLevel: assessed.result.scoreUnits >= 700000000 ? "HIGH" : assessed.result.scoreUnits >= 350000000 ? "MEDIUM" : "LOW",
    assessment: assessed, modelReview: assessed.result.reasons.includes("MODEL_THRESHOLD"),
    uncertaintyTriggersReview: false };
}
const unavailable = () => ({ verified: false, verificationCode: "XGB_CONTEXT_OR_INFERENCE_UNAVAILABLE", model: "XGBoost",
  authority: "ORACLE_ROUTING", score: null, riskLevel: "HIGH", unavailable: true, uncertaintyTriggersReview: false });
module.exports = { assessProtocol, unavailable };
