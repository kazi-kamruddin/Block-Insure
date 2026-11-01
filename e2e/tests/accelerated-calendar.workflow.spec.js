const { test, expect } = require("@playwright/test");
const { Contract } = require("../../backEnd/node_modules/ethers");
const fs = require("node:fs"), path = require("node:path");
const { loginActor } = require("../support/actions");
const { createActorContext, closeActor } = require("../support/walletBridge");

test("@workflow accelerated calendar becomes payable on elapsed local wall time and settles manual OTP once", async ({ browser }, testInfo) => {
  test.skip(process.env.CALENDAR_PROFILE !== "ACCELERATED_TESTNET", "Separate explicit accelerated deployment required");
  test.setTimeout(240000);
  const user = await createActorContext(browser, "user", { viewport: { width: 320, height: 900 } });
  try {
    expect((await user.provider.getNetwork()).chainId).toBe(31337n);
    // Mine at real one-second intervals; never set/increase the chain timestamp.
    await user.provider.send("evm_setIntervalMining", [1000]);
    const manager = new Contract(process.env.CONTRACT_ADDRESS, require("../../backEnd/abi/InsuranceManager.json").abi, user.wallet);
    const economics = new Contract(await manager.policyEconomics(), require("../../backEnd/abi/PolicyEconomics.json").abi, user.provider);
    await loginActor(user.page, user.actor);
    await user.page.goto("/user/policies/buy");
    await expect(user.page.getByLabel("Payment calendar").first()).toContainText("Accelerated testnet payment demo");
    await expect(user.page.getByLabel("Payment calendar").first()).toContainText("10 minutes");
    const policyId = String(await manager.policyCounter());
    const started = Date.now();
    await user.page.getByRole("checkbox", { name: /I have read and agree/ }).first().check();
    await user.page.getByRole("button", { name: "Buy Policy" }).first().click();
    await expect(user.page.locator(".success-text")).toContainText("policy purchased successfully");
    const policy = await manager.getPolicy(policyId);
    expect(policy.premiumInterval).toBe(600n);
    await user.page.goto("/user/banking");
    await user.page.getByLabel("Source account").selectOption({ index: 1 });
    await user.page.locator(".banking-form select").nth(1).selectOption(policyId);
    await expect(user.page.getByLabel("Payment calendar")).toContainText("8 minutes");
    await user.page.getByRole("button", { name: "Make a manual bank payment" }).click();
    await expect(user.page.locator(".app-toast.toast-error")).toContainText("Next installment opens at");
    await expect.poll(async () => (await economics.getInstallmentQuote(policyId, policy.nextPremiumDueDate)).payableNow,
      { timeout: 160000, intervals: [1000], message: "Real elapsed local time must open the two-minute demo window" }).toBe(true);
    const windowElapsedMs = Date.now() - started;
    expect(windowElapsedMs).toBeGreaterThan(110000);
    await user.page.getByRole("button", { name: "Make a manual bank payment" }).click();
    await expect(user.page.getByLabel("Bank payment OTP")).toHaveValue(/^\d{6}$/);
    await user.page.getByRole("button", { name: "Confirm manual payment" }).click();
    await expect.poll(async () => Number((await manager.getPolicy(policyId)).installmentsPaid)).toBe(2);
    await expect(user.page.getByText("Manual OTP", { exact: true }).first()).toBeVisible();
    const nextPolicy = await manager.getPolicy(policyId);
    expect(nextPolicy.nextPremiumDueDate).toBe(policy.startDate + 1200n);
    expect((await economics.getInstallmentQuote(policyId, nextPolicy.nextPremiumDueDate)).payableNow).toBe(false);
    await user.page.goto("/user/policies");
    await expect(user.page.getByLabel("Payment calendar").first()).toContainText("Accelerated testnet payment demo");
    await testInfo.attach("accelerated-calendar-320", { body: await user.page.screenshot({ fullPage: true }), contentType: "image/png" });
    if (process.env.RELEASE_MEASUREMENTS_DIR) fs.writeFileSync(path.join(process.env.RELEASE_MEASUREMENTS_DIR, "accelerated-wall-clock.json"), JSON.stringify({
      passed: true, profile: "ACCELERATED_TESTNET", intervalSeconds: 600, advanceWindowSeconds: 480, gracePeriodSeconds: 120,
      windowElapsedMs, localOneSecondMining: true, timestampTravelUsed: false,
      scope: "Elapsed local wall time and programmable-wallet/manual OTP application path; not public inclusion/finality or real mailbox acceptance",
    }, null, 2) + "\n", { flag: "wx" });
  } finally {
    await user.provider.send("evm_setIntervalMining", [0]).catch(() => {});
    await closeActor(user);
  }
});
