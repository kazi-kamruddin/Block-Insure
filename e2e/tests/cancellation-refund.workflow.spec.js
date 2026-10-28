const { test, expect } = require("@playwright/test");
const { Contract } = require("../../backEnd/node_modules/ethers");
const { loginActor, advanceToInstallment } = require("../support/actions");
const { createActorContext, closeActor } = require("../support/walletBridge");

test("@workflow cancellation refund uses scheduled receipts and a separately funded pull withdrawal", async ({ browser }) => {
  test.setTimeout(180000);
  const user = await createActorContext(browser, "user");
  try {
    await loginActor(user.page, user.actor);
    const manager = new Contract(process.env.CONTRACT_ADDRESS || process.env.VITE_CONTRACT_ADDRESS, require("../../backEnd/abi/InsuranceManager.json").abi, user.wallet);
    const policyId = String(await manager.policyCounter());
    await user.page.goto("/user/policies/buy");
    await user.page.getByRole("checkbox", { name: /I have read and agree/ }).first().check();
    await user.page.getByRole("button", { name: "Buy Policy" }).first().click();
    await expect(user.page.locator(".success-text")).toContainText("policy purchased successfully");
    await advanceToInstallment(user, policyId);
    await user.page.goto("/user/policies");
    const card = user.page.locator(".policy-lifecycle-card").filter({ hasText: `Policy #${policyId}` });
    await card.getByRole("button", { name: /Pay Premium/ }).click();
    await expect.poll(async () => Number((await manager.getPolicy(policyId)).installmentsPaid)).toBe(2);
    await user.page.reload();
    await card.locator("details.policy-benefits-panel > summary").click();
    user.page.once("dialog", (dialog) => dialog.accept());
    await card.getByRole("button", { name: "Cancel policy for refund" }).click();
    await expect(card.getByRole("button", { name: "Request cancellation refund" })).toBeVisible();
    await card.getByRole("button", { name: "Request cancellation refund" }).click();
    await expect(card).toContainText("REQUESTED");
    const admin = await createActorContext(browser, "admin");
    try {
      await loginActor(admin.page, admin.actor); await admin.page.goto("/admin/benefits");
      const request = admin.page.locator("article.card").filter({ hasText: "SURRENDER request" }).filter({ hasText: `Policy #${policyId}` });
      await request.getByRole("button", { name: "Approve", exact: true }).click();
      await expect(request).toContainText("Status: APPROVED", { timeout: 60000 });
      await request.getByRole("button", { name: "Allocate Benefit" }).click();
      await expect(request).toContainText("Status: ALLOCATED", { timeout: 60000 });
    } finally { await closeActor(admin); }
    await expect(card.getByRole("button", { name: "Withdraw cancellation refund" })).toBeVisible({ timeout: 30000 });
    await card.getByRole("button", { name: "Withdraw cancellation refund" }).click();
    await expect(card).toContainText("Latest wallet refund withdrawal confirmed", { timeout: 30000 });
    await expect(card.getByRole("button", { name: "Withdraw cancellation refund" })).toHaveCount(0);
    await user.page.goto("/user/benefits");
    await expect(user.page.getByRole("heading", { name: "Cancellation refunds" })).toBeVisible();
    await expect(user.page.getByRole("button", { name: /death|maturity/i })).toHaveCount(0);
  } finally { await closeActor(user); }
});
