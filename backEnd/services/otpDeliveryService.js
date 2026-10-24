const fail = (message, statusCode = 503) => Object.assign(new Error(message), { statusCode });
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function deliveryMode() {
  const mode = process.env.OTP_DELIVERY_MODE || (process.env.NODE_ENV === "production" ? "disabled" : "simulation");
  if (!["simulation", "brevo", "disabled"].includes(mode) || (mode === "simulation" && process.env.NODE_ENV === "production")) throw fail("OTP delivery configuration is invalid");
  if (mode === "disabled") throw fail("OTP delivery is disabled. Configure email delivery or use a local simulated demo.");
  return mode;
}
const maskEmail = (email) => `${email.slice(0, 1)}***@${email.split("@")[1]}`;
async function deliverOtp({ email, otp, purpose }, { fetchImpl = global.fetch } = {}) {
  const mode = deliveryMode();
  if (mode === "simulation") return { deliveryMode: mode, deliveryMessage: "Simulated inbox only. No email or SMS was sent.", demoOtp: otp };
  if (!emailPattern.test(email || "") || !emailPattern.test(process.env.BREVO_SENDER_EMAIL || "") || !process.env.BREVO_API_KEY?.trim()) throw fail("Email delivery is not configured. Check the sender and API key.");
  try {
    const response = await fetchImpl("https://api.brevo.com/v3/smtp/email", {
      method: "POST", redirect: "error", signal: AbortSignal.timeout(10000),
      headers: { "api-key": process.env.BREVO_API_KEY, "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ sender: { name: "Block-Insure", email: process.env.BREVO_SENDER_EMAIL }, to: [{ email }],
        subject: `Block-Insure ${purpose === "profile" ? "email verification" : "payment confirmation"} code`,
        textContent: `Your Block-Insure ${purpose === "profile" ? "email verification" : "manual premium payment"} code is ${otp}. It expires in 5 minutes and can be used once. Do not share it. This thesis prototype simulates banking; email delivery does not certify a bank transfer.` }),
    });
    if (!response.ok || response.status !== 201) throw fail("Delivery rejected");
    // Acceptance is not proof of mailbox delivery. Do not log provider bodies,
    // recipients, credentials, or OTPs, including in errors.
    const receipt = await response.json();
    if (typeof receipt?.messageId !== "string" || !receipt.messageId || receipt.messageId.length > 512) throw fail("Missing acceptance receipt");
    return { deliveryMode: mode, maskedRecipient: maskEmail(email), deliveryMessage: `Email accepted for delivery to ${maskEmail(email)}. Check your inbox and spam folder.` };
  } catch { throw fail("Email delivery could not be confirmed. Wait one minute, check configuration, then request a new code."); }
}
module.exports = { deliveryMode, deliverOtp, maskEmail };
