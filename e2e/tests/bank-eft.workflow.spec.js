const { test, expect } = require("@playwright/test");
const { loginActor } = require("../support/actions");
const { closeActor, createActorContext } = require("../support/walletBridge");

const dateOnly = (date) => date.toISOString().slice(0, 10);

test.describe("@workflow quarterly bank EFT", () => {
  test("policyholder mandate, bank approval, automatic debit, and manual OTP payment", async ({ browser }) => {
    const today = new Date();
    const tomorrow = new Date(today.getTime() + 24 * 60 * 60 * 1000);
    const userSession = await createActorContext(browser, "user");
    try {
      await loginActor(userSession.page, userSession.actor);
      await userSession.page.goto("/user/policies/buy");
      await userSession.page.getByRole("checkbox", { name: /I have read and agree/ }).first().check();
      await userSession.page.getByRole("button", { name: "Buy Policy" }).first().click();
      await expect(userSession.page.locator(".success-text")).toContainText("policy purchased successfully");

      await userSession.page.goto("/user/banking");
      await expect(userSession.page.getByRole("heading", { name: "Premium payments and standing EFT instructions" })).toBeVisible();
      await userSession.page.getByLabel("Source account").selectOption({ index: 1 });
      const policySelect = userSession.page.locator(".banking-form select").nth(1);
      await expect.poll(() => policySelect.locator("option").count()).toBeGreaterThan(1);
      await policySelect.selectOption({ index: 1 });
      await userSession.page.getByLabel("Start date").fill(dateOnly(today));
      await userSession.page.getByRole("button", { name: "Send mandate to bank" }).click();
      await expect(userSession.page.getByText("PENDING BANK APPROVAL")).toBeVisible();
    } finally {
      await closeActor(userSession);
    }

    const bankSession = await createActorContext(browser, "bank");
    try {
      await loginActor(bankSession.page, bankSession.actor);
      const pendingRow = bankSession.page.locator("tbody tr").filter({ hasText: "PENDING BANK APPROVAL" }).first();
      await expect(pendingRow).toBeVisible();
      await pendingRow.getByRole("button", { name: "Approve" }).click();
      await expect(bankSession.page.getByText("ACTIVE", { exact: true }).first()).toBeVisible();
      await bankSession.page.getByLabel("Automation reference date").fill(dateOnly(tomorrow));
      await bankSession.page.getByRole("button", { name: "Run reminder and debit scan" }).click();
      await expect(bankSession.page.getByText("PAID", { exact: true }).first()).toBeVisible({ timeout: 60_000 });
      await expect(bankSession.page.getByText("4,000.00 BDT", { exact: true })).toBeVisible();
    } finally {
      await closeActor(bankSession);
    }

    const paymentSession = await createActorContext(browser, "user");
    try {
      await loginActor(paymentSession.page, paymentSession.actor);
      await paymentSession.page.goto("/user/banking");
      await expect(paymentSession.page.getByText("Quarterly EFT", { exact: true }).first()).toBeVisible();
      await paymentSession.page.getByLabel("Source account").selectOption({ index: 1 });
      await paymentSession.page.locator(".banking-form select").nth(1).selectOption({ index: 1 });
      await paymentSession.page.getByRole("button", { name: "Make a manual bank payment" }).click();
      await expect(paymentSession.page.getByLabel("Bank payment OTP")).toHaveValue(/^\d{6}$/);
      await paymentSession.page.getByRole("button", { name: "Confirm manual payment" }).click();
      await expect(paymentSession.page.getByText("Manual OTP", { exact: true }).first()).toBeVisible({ timeout: 60_000 });
      await paymentSession.page.goto("/user/payments");
      await expect(paymentSession.page.getByText("Quarterly bank EFT", { exact: true }).first()).toBeVisible();
      await expect(paymentSession.page.getByText("Manual bank payment (OTP)", { exact: true }).first()).toBeVisible();
    } finally {
      await closeActor(paymentSession);
    }
  });
});
