const crypto = require("node:crypto");
const User = require("../models/User");
const Challenge = require("../models/EmailChallenge");
const Slot = require("../models/OtpDeliverySlot");
const { deliveryMode, deliverOtp } = require("./otpDeliveryService");
const fail = (message, statusCode) => Object.assign(new Error(message), { statusCode });
const hash = (id, otp) => {
  const key = process.env.BANK_OTP_SECRET || process.env.JWT_SECRET;
  if (!key) throw fail("OTP secret is not configured", 503);
  return crypto.createHmac("sha256", key).update(`PROFILE:${id}:${otp}`).digest("hex");
};
async function reserveDelivery(wallet, email) {
  // Shared by verification/payment, durable across processes. Recipient hashing
  // also bounds sends to one inbox when callers cycle through wallets.
  const now = new Date(), windowStart = new Date(now.getTime() - 86400000);
  const limits = [
    { id: `wallet:${wallet.toLowerCase()}`, count: 10, delay: 60000 },
    { id: `email:${crypto.createHash("sha256").update(email).digest("hex")}`, count: 10, delay: 60000 },
    { id: "application:otp-email", count: 100, delay: 0 },
  ];
  for (const { id, count, delay } of limits) {
    try {
      const slot = await Slot.findOneAndUpdate({ _id: id, nextAllowedAt: { $lte: now }, $or: [{ count: { $lt: count } }, { windowStart: { $lte: windowStart } }] }, [
        { $set: { nextAllowedAt: new Date(now.getTime() + delay), windowStart: { $cond: [{ $lte: ["$windowStart", windowStart] }, now, "$windowStart"] }, count: { $cond: [{ $lte: ["$windowStart", windowStart] }, 1, { $add: ["$count", 1] }] } } },
      ], { returnDocument: "after", updatePipeline: true });
      if (!slot) await Slot.create({ _id: id, nextAllowedAt: new Date(now.getTime() + delay), windowStart: now, count: 1 });
    } catch (error) {
      if (error.code === 11000) throw fail("Wait at least one minute between codes. Daily limits are 10 per wallet/inbox and 100 for this application; an exhausted quota resets after its 24-hour window.", 429);
      throw error;
    }
  }
}
async function requestVerification(walletAddress) {
  const user = await User.findOne({ walletAddress });
  if (!user?.email) throw fail("Save an email address in your profile first.", 422);
  const mode = deliveryMode();
  await reserveDelivery(walletAddress, user.email);
  const challengeId = crypto.randomUUID(), otp = String(crypto.randomInt(100000, 1000000));
  const expiresAt = new Date(Date.now() + 300000);
  await Challenge.updateMany({ walletAddress, status: "PENDING" }, { $set: { status: "EXPIRED" } });
  const challenge = await Challenge.create({ walletAddress, email: user.email, deliveryMode: mode, challengeId, expiresAt, otpHash: hash(challengeId, otp) });
  try { return { challengeId, expiresAt, ...(await deliverOtp({ email: user.email, otp, purpose: "profile" })), verificationKind: mode === "brevo" ? "email" : "simulation" }; }
  catch (error) { await Challenge.updateOne({ _id: challenge._id, status: "PENDING" }, { $set: { status: "FAILED" } }); throw error; }
}
async function confirmVerification(walletAddress, challengeId, otp) {
  if (typeof challengeId !== "string" || challengeId.length > 80 || !/^\d{6}$/.test(otp || "")) throw fail("Supply a challenge and six-digit code.", 422);
  const challenge = await Challenge.findOne({ walletAddress, challengeId, status: "PENDING", expiresAt: { $gt: new Date() } }).select("+otpHash");
  if (!challenge) throw fail("Code expired, used or unavailable. Request a new code.", 409);
  const matches = crypto.timingSafeEqual(Buffer.from(hash(challengeId, otp), "hex"), Buffer.from(challenge.otpHash, "hex"));
  const updated = await Challenge.findOneAndUpdate({ _id: challenge._id, status: "PENDING", attempts: challenge.attempts, expiresAt: { $gt: new Date() } },
    { $inc: { attempts: 1 }, $set: { status: matches ? "USED" : challenge.attempts >= 2 ? "LOCKED" : "PENDING" } }, { returnDocument: "after" });
  if (!updated) throw fail("Another verification attempt completed. Try again.", 409);
  if (!matches) throw fail("Incorrect code. Three incorrect attempts lock the challenge.", 422);
  // Simulation must never establish ownership of a real mailbox.
  if (challenge.deliveryMode !== "brevo") return { verified: false, message: "Simulation completed. Mailbox ownership was not verified." };
  const user = await User.findOneAndUpdate({ walletAddress, email: challenge.email }, { verifiedEmail: challenge.email, emailVerifiedAt: new Date() }, { returnDocument: "after" });
  if (!user) throw fail("Your profile email changed. Request a new code.", 409);
  return { verified: true, message: "Email verified. This does not verify legal identity." };
}
module.exports = { reserveDelivery, requestVerification, confirmVerification };
