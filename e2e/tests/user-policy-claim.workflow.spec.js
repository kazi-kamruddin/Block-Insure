const { test, expect } = require("@playwright/test");
const {
  localDateTimeValue,
  loginActor,
  uniqueEvidenceFile,
} = require("../support/actions");
const { closeActor, createActorContext } = require("../support/walletBridge");

test.describe("@workflow policyholder transaction journey", () => {
  test("User buys a policy and submits uniquely encrypted claim evidence", async ({ browser }) => {
    const session = await createActorContext(browser, "user");
    try {
      await loginActor(session.page, session.actor);

      await session.page.goto("/user/policies/buy");
      await expect(session.page.getByRole("heading", { name: "Buy Policy" })).toBeVisible();
      await session.page.getByRole("button", { name: "Buy Policy" }).first().click();
      await expect(session.page.locator(".success-text")).toContainText(
        "policy purchased successfully"
      );

      await session.page.goto("/user/policies");
      await expect(session.page.getByRole("heading", { name: "My Policies" })).toBeVisible();
      await expect(session.page.locator(".card-row .card").first()).toBeVisible();

      await session.page.goto("/user/claims/new");
      await expect(session.page.getByRole("heading", { name: "Submit Claim" })).toBeVisible();

      const policySelect = session.page.getByLabel("Policy");
      await expect
        .poll(() => policySelect.locator("option").count())
        .toBeGreaterThan(1);
      await policySelect.selectOption({ index: 1 });

      await session.page.getByLabel("Claim amount in ETH").fill("0.1");
      const incidentInput = session.page.getByLabel("Incident date/time");
      await incidentInput.evaluate((input) => input.setAttribute("step", "1"));
      await incidentInput.fill(localDateTimeValue(new Date(Date.now() - 2_000)));
      await session.page.getByLabel("Claim type").fill("HOSPITALIZATION");
      await session.page.getByLabel("Hospital ID").fill("HOSP-001");
      await session.page
        .getByLabel("Invoice number")
        .fill(`E2E-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`);
      await session.page.getByLabel("Claim document").setInputFiles(uniqueEvidenceFile());

      await session.page.getByRole("button", { name: "Submit Claim" }).click();
      await expect(session.page.locator(".success-text")).toContainText(
        "submitted and its encrypted evidence was reconciled successfully",
        { timeout: 120_000 }
      );
      const uploadedDocument = session.page
        .getByRole("heading", { name: "Uploaded Document" })
        .locator("..");
      await expect(uploadedDocument).toBeVisible();
      await expect(uploadedDocument).toContainText("AES-256-GCM");
    } finally {
      await closeActor(session);
    }
  });
});
