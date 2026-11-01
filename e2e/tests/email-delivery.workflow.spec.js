const { test, expect } = require("@playwright/test");
const mongoose = require("../../backEnd/node_modules/mongoose");
const { loginActor, advanceToInstallment } = require("../support/actions");
const { createActorContext, closeActor } = require("../support/walletBridge");
const { getE2EConfig, requireDisposableE2EMongoUri } = require("../support/environment");

const mailboxHeaders = () => ({ Authorization: `Bearer ${process.env.E2E_MAILBOX_TOKEN}` });
const messagesFor = async (page, recipient) => {
  const response = await page.request.get(`http://127.0.0.1:5060/messages?recipient=${encodeURIComponent(recipient)}`, { headers: mailboxHeaders() });
  expect(response.status()).toBe(200);
  return response.json();
};
const capture = async (page, testInfo, name) => testInfo.attach(name, {
  body: await page.screenshot({ fullPage: true, animations: "disabled" }), contentType: "image/png",
});
const saveEmail = async (page, email) => {
  await page.goto("/user/profile");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByRole("button", { name: "Save profile" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Profile saved" })).toBeVisible();
};

test.describe("@workflow Brevo-mode application with a local provider stub", () => {
  test.skip(process.env.E2E_BREVO_STUB !== "true", "Requires the isolated --brevo-stub stack; never sends external email");

  test("profile verification and bank payment keep email codes private and single-use", async ({ browser }, testInfo) => {
    test.setTimeout(240_000);
    const mongo = await mongoose.createConnection(requireDisposableE2EMongoUri()).asPromise();
    const session = await createActorContext(browser, "user", { viewport: { width: 320, height: 900 } });
    const page = session.page;
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const email = "policyholder@example.test";
    try {
      await loginActor(page, session.actor);
      await saveEmail(page, email);
      const issued = page.waitForResponse((response) => response.request().method() === "POST" && response.url().endsWith("/api/users/email-verification"));
      await page.getByRole("button", { name: "Request email verification code" }).click();
      const issueResponse = await issued;
      expect(issueResponse.status()).toBe(200);
      const challenge = await issueResponse.json();
      expect(challenge.deliveryMode).toBe("brevo");
      expect(challenge.demoOtp).toBeUndefined();
      const sentAt = Date.now();
      const code = (await messagesFor(page, email))[0].code;
      expect(JSON.stringify(challenge).includes(code)).toBe(false);
      const input = page.getByLabel("Email verification code", { exact: true });
      await expect(input).toHaveValue("");
      await expect(page.getByText(/Simulated code:/)).toHaveCount(0);
      await input.fill(code === "000000" ? "111111" : "000000");
      await page.getByRole("button", { name: "Confirm email code" }).click();
      await expect(page.getByRole("alert")).toContainText("Incorrect code");
      expect(await mongo.db.collection("users").countDocuments({ email, verifiedEmail: email })).toBe(0);
      await input.fill(code);
      await page.getByRole("button", { name: "Confirm email code" }).click();
      await expect(page.getByText("Email verified for payment codes.")).toBeVisible();
      await page.reload();
      await expect(page.getByText("Email verified for payment codes.")).toBeVisible();
      await capture(page, testInfo, "verified-profile-320.png");
      const token = await page.evaluate(() => localStorage.getItem("blockinsure_jwt"));
      const headers = { Authorization: `Bearer ${token}` };
      const confirmUrl = `${getE2EConfig().apiUrl}/api/users/email-verification/confirm`;
      const replay = await page.request.post(confirmUrl, { headers, data: { challengeId: challenge.challengeId, otp: code } });
      expect(replay.status()).toBe(409);
      const throttled = await page.request.post(`${getE2EConfig().apiUrl}/api/users/email-verification`, { headers });
      expect(throttled.status()).toBe(429);
      expect((await messagesFor(page, email)).length).toBe(1);

      await page.goto("/user/policies/buy");
      await page.getByRole("checkbox", { name: /I have read and agree/ }).first().check();
      await page.getByRole("button", { name: "Buy Policy" }).first().click();
      await expect(page.locator(".success-text")).toContainText("policy purchased successfully");
      await page.goto("/user/banking");
      await page.getByLabel("Source account").selectOption({ index: 1 });
      const accountReference = await page.getByLabel("Source account").inputValue();
      const policy = page.getByRole("combobox", { name: /^Policy/ });
      await expect.poll(() => policy.locator("option").count()).toBeGreaterThan(1);
      await policy.selectOption({ index: 1 });
      const policyId = await policy.inputValue();
      await advanceToInstallment(session, policyId);
      // Keep the actual durable resend limit intact, including the shared
      // profile/payment wallet limit. Do not mutate quota rows to skip it.
      await page.waitForTimeout(Math.max(0, 61_000 - (Date.now() - sentAt)));
      const paymentIssued = page.waitForResponse((response) => response.request().method() === "POST" && response.url().endsWith("/manual-payments/otp"));
      await page.getByRole("button", { name: "Make a manual bank payment" }).click();
      const paymentResponse = await paymentIssued;
      expect(paymentResponse.status()).toBe(201);
      const payment = await paymentResponse.json();
      expect(payment.deliveryMode).toBe("brevo");
      expect(payment.demoOtp).toBeUndefined();
      const paymentCode = (await messagesFor(page, email)).at(-1).code;
      expect(JSON.stringify(payment).includes(paymentCode)).toBe(false);
      const paymentInput = page.getByLabel("Bank payment OTP");
      await expect(paymentInput).toHaveValue("");
      await expect(page.getByRole("status", { name: "Email payment code" })).toBeVisible();
      await expect(page.getByRole("status", { name: "Simulated bank inbox" })).toHaveCount(0);
      await paymentInput.fill(paymentCode === "000000" ? "111111" : "000000");
      await page.getByRole("button", { name: "Confirm manual payment" }).click();
      await expect(page.locator(".app-toast.toast-error")).toContainText("Incorrect OTP");
      expect(await mongo.db.collection("banktransactions").countDocuments({ policyId, type: "MANUAL_OTP" })).toBe(0);
      await paymentInput.fill(paymentCode);
      await page.getByRole("button", { name: "Confirm manual payment" }).click();
      const transferRow = page.getByRole("row").filter({ has: page.getByRole("cell", { name: "Manual OTP", exact: true }) });
      // The method is visible while durable reconciliation is still processing.
      // Require the application to show confirmed settlement before checking it.
      await expect(transferRow.getByRole("cell", { name: "PAID", exact: true })).toBeVisible({ timeout: 60_000 });
      const transfer = await mongo.db.collection("banktransactions").findOne({ policyId, type: "MANUAL_OTP" });
      expect(transfer.status).toBe("PAID");
      expect((await session.provider.getTransactionReceipt(transfer.transactionHash)).status).toBe(1);
      const paymentReplay = await page.request.post(`${getE2EConfig().apiUrl}/api/banks/user/manual-payments/confirm`, { headers,
        data: { challengeId: payment.challengeId, otp: paymentCode } });
      expect([404, 409]).toContain(paymentReplay.status());
      expect(await mongo.db.collection("banktransactions").countDocuments({ policyId, type: "MANUAL_OTP" })).toBe(1);
      await page.goto("/user/payments");
      await expect(page.getByText("Manual bank payment (OTP)", { exact: true }).first()).toBeVisible();
      await capture(page, testInfo, "confirmed-premium-320.png");
      await saveEmail(page, "changed@example.test");
      await expect(page.getByText("Email verified for payment codes.")).toHaveCount(0);
      expect(await mongo.db.collection("users").countDocuments({ email: "changed@example.test", verifiedEmail: email })).toBe(0);
      // Reach a payable next installment so this probe tests mailbox authority,
      // rather than failing earlier because the paid period closed its window.
      await advanceToInstallment(session, policyId);
      await expect.poll(async () => {
        const response = await page.request.get(`${getE2EConfig().apiUrl}/api/policies/my?limit=100`, { headers });
        expect(response.status()).toBe(200);
        return (await response.json()).policies.find((item) => item.policyId === policyId)?.installment?.payableNow;
      }, { timeout: 10_000, message: "The next period must be eligible before probing unverified-email rejection" }).toBe(true);
      const unverifiedPayment = await page.request.post(`${getE2EConfig().apiUrl}/api/banks/user/manual-payments/otp`, {
        headers, data: { accountReference, policyId },
      });
      expect(unverifiedPayment.status()).toBe(422);
      expect((await messagesFor(page, "changed@example.test")).length).toBe(0);
      expect(errors).toEqual([]);
    } finally { await closeActor(session); await mongo.close(); }
  });

  test("provider rejection leaves no usable challenge and no simulated fallback", async ({ browser }, testInfo) => {
    const mongo = await mongoose.createConnection(requireDisposableE2EMongoUri()).asPromise();
    const session = await createActorContext(browser, "beneficiary");
    try {
      const page = session.page;
      await loginActor(page, session.actor);
      await saveEmail(page, "rejected@example.test");
      expect((await page.request.post("http://127.0.0.1:5060/fail-next", { headers: mailboxHeaders() })).status()).toBe(200);
      const response = page.waitForResponse((result) => result.request().method() === "POST" && result.url().endsWith("/api/users/email-verification"));
      await page.getByRole("button", { name: "Request email verification code" }).click();
      expect((await response).status()).toBe(503);
      await expect(page.getByRole("alert")).toContainText("Email delivery could not be confirmed");
      await expect(page.getByLabel("Email verification code", { exact: true })).toHaveCount(0);
      await expect(page.getByText(/Simulated code:/)).toHaveCount(0);
      expect((await messagesFor(page, "rejected@example.test")).length).toBe(0);
      expect(await mongo.db.collection("emailchallenges").countDocuments({ email: "rejected@example.test", status: "FAILED" })).toBe(1);
      expect(await mongo.db.collection("emailchallenges").countDocuments({ email: "rejected@example.test", status: "PENDING" })).toBe(0);
      await capture(page, testInfo, "provider-rejection.png");
    } finally { await closeActor(session); await mongo.close(); }
  });
});
