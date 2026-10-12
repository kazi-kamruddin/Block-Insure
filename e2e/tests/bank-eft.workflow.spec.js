const { test, expect } = require("@playwright/test");
const { loginActor } = require("../support/actions");
const { closeActor, createActorContext } = require("../support/walletBridge");

const dateOnly = (date) => date.toISOString().slice(0, 10);

test.describe("@workflow quarterly bank EFT", () => {
  test.describe.configure({ mode: "serial" });

  test("policyholder mandate, bank approval, automatic debit, and manual OTP payment", async ({ browser }) => {
    const today = new Date();
    const tomorrow = new Date(today.getTime() + 24 * 60 * 60 * 1000);
    let policyId;
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
      const policyOptionCount = await policySelect.locator("option").count();
      await policySelect.selectOption({ index: policyOptionCount - 1 });
      policyId = await policySelect.inputValue();
      await userSession.page.getByLabel("Start date").fill(dateOnly(today));
      await userSession.page.getByRole("button", { name: "Send mandate to bank" }).click();
      const standingInstructions = userSession.page.getByRole("heading", { name: "Standing instructions" }).locator("..");
      await expect(
        standingInstructions.locator("tbody tr").filter({ hasText: `#${policyId}` }).filter({ hasText: "PENDING BANK APPROVAL" })
      ).toBeVisible();
    } finally {
      await closeActor(userSession);
    }

    const bankSession = await createActorContext(browser, "bank");
    try {
      await loginActor(bankSession.page, bankSession.actor);
      const mandateTable = bankSession.page.locator(".bank-mandates-card");
      const pendingRow = mandateTable
        .locator("tbody tr")
        .filter({ hasText: `#${policyId}` })
        .filter({ hasText: "PENDING BANK APPROVAL" });
      await expect(pendingRow).toBeVisible();
      const policyCellText = (await pendingRow.locator("td").nth(1).textContent())?.trim();
      expect(policyCellText).toMatch(/^#\d+$/);
      const mandateRow = mandateTable.locator("tbody tr").filter({ hasText: policyCellText });
      const approvalResponsePromise = bankSession.page.waitForResponse(
        (response) => response.request().method() === "POST" && /\/api\/banks\/mandates\/[^/]+\/approve$/.test(response.url())
      );
      await pendingRow.getByRole("button", { name: "Approve" }).click();
      const approvalResponse = await approvalResponsePromise;
      expect(approvalResponse.ok(), await approvalResponse.text()).toBe(true);
      await expect(mandateRow.getByText("ACTIVE", { exact: true })).toBeVisible();
      const fundedAccount = bankSession.page.locator(".bank-accounts-card tbody tr").filter({ hasText: "DEMO-5000" });
      const startingBalanceText = await fundedAccount.locator("td").nth(3).textContent();
      const startingBalance = Number(String(startingBalanceText).replace(/[^0-9.]/g, ""));
      expect(startingBalance).toBeGreaterThanOrEqual(1000);
      await bankSession.page.getByLabel("Automation reference date").fill(dateOnly(tomorrow));
      const automationResponsePromise = bankSession.page.waitForResponse(
        (response) => response.request().method() === "POST" && response.url().endsWith("/api/banks/automation/run")
      );
      await bankSession.page.getByRole("button", { name: "Run reminder and debit scan" }).click();
      const automationResponse = await automationResponsePromise;
      expect(automationResponse.ok(), await automationResponse.text()).toBe(true);
      const transferLedger = bankSession.page.getByRole("heading", { name: "Transfer ledger" }).locator("..");
      await expect(transferLedger.getByText("PAID", { exact: true }).first()).toBeVisible({ timeout: 60_000 });
      await expect(fundedAccount).toContainText(
        `${(startingBalance - 1000).toLocaleString("en-BD", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} BDT`
      );
    } finally {
      await closeActor(bankSession);
    }

    const paymentSession = await createActorContext(browser, "user");
    try {
      await loginActor(paymentSession.page, paymentSession.actor);
      await paymentSession.page.goto("/user/banking");
      await expect(paymentSession.page.getByText("Quarterly EFT", { exact: true }).first()).toBeVisible();
      await paymentSession.page.getByLabel("Source account").selectOption({ index: 1 });
      await paymentSession.page.locator(".banking-form select").nth(1).selectOption(policyId);
      await paymentSession.page.getByRole("button", { name: "Make a manual bank payment" }).click();
      const otpInput = paymentSession.page.getByLabel("Bank payment OTP");
      await expect(otpInput).toHaveValue(/^\d{6}$/);
      const issuedOtp = await otpInput.inputValue();
      await otpInput.fill(issuedOtp === "000000" ? "111111" : "000000");
      await paymentSession.page.getByRole("button", { name: "Confirm manual payment" }).click();
      await expect(paymentSession.page.locator(".app-toast.toast-error")).toContainText("Incorrect OTP");
      await otpInput.fill(issuedOtp);
      await paymentSession.page.getByRole("button", { name: "Confirm manual payment" }).click();
      await expect(paymentSession.page.getByText("Manual OTP", { exact: true }).first()).toBeVisible({ timeout: 60_000 });
      await paymentSession.page.goto("/user/payments");
      await expect(paymentSession.page.getByText("Quarterly bank EFT", { exact: true }).first()).toBeVisible();
      await expect(paymentSession.page.getByText("Manual bank payment (OTP)", { exact: true }).first()).toBeVisible();
    } finally {
      await closeActor(paymentSession);
    }
  });

  test("bank rejection is visible to the policyholder, who can replace and cancel the mandate", async ({ browser }) => {
    const userSession = await createActorContext(browser, "user");
    let policyId;
    try {
      await loginActor(userSession.page, userSession.actor);
      await userSession.page.goto("/user/policies/buy");
      await userSession.page.getByRole("checkbox", { name: /I have read and agree/ }).first().check();
      await userSession.page.getByRole("button", { name: "Buy Policy" }).first().click();
      await expect(userSession.page.locator(".success-text")).toContainText("policy purchased successfully");

      await userSession.page.goto("/user/banking");
      await userSession.page.getByLabel("Source account").selectOption({ index: 1 });
      const policySelect = userSession.page.locator(".banking-form select").nth(1);
      await expect.poll(() => policySelect.locator("option").count()).toBeGreaterThan(2);
      const policyOptionCount = await policySelect.locator("option").count();
      await policySelect.selectOption({ index: policyOptionCount - 1 });
      policyId = await policySelect.inputValue();
      await userSession.page.getByRole("button", { name: "Send mandate to bank" }).click();
      const standingInstructions = userSession.page.getByRole("heading", { name: "Standing instructions" }).locator("..");
      await expect(
        standingInstructions.locator("tbody tr").filter({ hasText: `#${policyId}` }).filter({ hasText: "PENDING BANK APPROVAL" })
      ).toBeVisible();
    } finally {
      await closeActor(userSession);
    }

    const bankSession = await createActorContext(browser, "bank");
    try {
      await loginActor(bankSession.page, bankSession.actor);
      const mandateTable = bankSession.page.locator(".bank-mandates-card");
      const policyRows = mandateTable.locator("tbody tr").filter({ hasText: `#${policyId}` });
      const pendingRow = policyRows.filter({ hasText: "PENDING BANK APPROVAL" });
      await expect(pendingRow).toBeVisible();
      const rejectionResponsePromise = bankSession.page.waitForResponse(
        (response) => response.request().method() === "POST" && /\/api\/banks\/mandates\/[^/]+\/reject$/.test(response.url())
      );
      await pendingRow.getByRole("button", { name: "Reject" }).click();
      const rejectionResponse = await rejectionResponsePromise;
      expect(rejectionResponse.ok(), await rejectionResponse.text()).toBe(true);
      await expect(policyRows.first().getByText("REJECTED", { exact: true })).toBeVisible();
    } finally {
      await closeActor(bankSession);
    }

    const cancellationSession = await createActorContext(browser, "user");
    try {
      await loginActor(cancellationSession.page, cancellationSession.actor);
      await cancellationSession.page.goto("/user/banking");
      const standingInstructions = cancellationSession.page.getByRole("heading", { name: "Standing instructions" }).locator("..");
      await expect(
        standingInstructions.locator("tbody tr").filter({ hasText: `#${policyId}` }).filter({ hasText: "REJECTED" })
      ).toBeVisible();

      await cancellationSession.page.getByLabel("Source account").selectOption({ index: 1 });
      await cancellationSession.page.locator(".banking-form select").nth(1).selectOption(policyId);
      await cancellationSession.page.getByRole("button", { name: "Send mandate to bank" }).click();
      const newestPolicyRow = standingInstructions.locator("tbody tr").filter({ hasText: `#${policyId}` }).first();
      await expect(newestPolicyRow).toContainText("PENDING BANK APPROVAL");
      const cancellationResponsePromise = cancellationSession.page.waitForResponse(
        (response) => response.request().method() === "PATCH" && /\/api\/banks\/user\/mandates\/[^/]+\/cancel$/.test(response.url())
      );
      await newestPolicyRow.getByRole("button", { name: "Cancel" }).click();
      const cancellationResponse = await cancellationResponsePromise;
      expect(cancellationResponse.ok(), await cancellationResponse.text()).toBe(true);
      await expect(newestPolicyRow).toContainText("CANCELLED");
    } finally {
      await closeActor(cancellationSession);
    }
  });
});
