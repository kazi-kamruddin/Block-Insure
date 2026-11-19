const { test, expect } = require("@playwright/test");
const { loginActor } = require("../support/actions");
const { closeActor, createActorContext } = require("../support/walletBridge");

test.describe("@maintenance hospital-owned records", () => {
  test("hospital creates a patient-bound invoice and publishes both worker snapshots automatically", async ({ browser }) => {
    const hospital = await createActorContext(browser, "hospital");
    const user = await createActorContext(browser, "user");
    try {
      await loginActor(hospital.page, hospital.actor);
      await hospital.page.goto("/hospital/records");
      const block = await hospital.provider.getBlock("latest");
      const date = new Date(Number(block.timestamp) * 1000).toISOString().slice(0, 10);
      const invoice = `DEMO-PUBLISHED-${Date.now()}`;
      await hospital.page.getByLabel("Patient reference", { exact: false }).fill("SYNTHETIC-PATIENT-ONLY");
      await hospital.page.getByLabel("Invoice number", { exact: true }).fill(invoice);
      await expect(hospital.page.getByLabel(/Authorized claimant wallets/)).toHaveCount(0);
      await hospital.page.getByLabel("Diagnosis code", { exact: true }).fill("DEMO");
      for (const name of ["Admission date", "Discharge date", "Invoice date"]) await hospital.page.getByLabel(name, { exact: true }).fill(date);
      await hospital.page.getByLabel("Bill amount (ETH)", { exact: true }).fill("0.1");
      await hospital.page.getByRole("button", { name: "Create hospital record", exact: true }).click();
      const row = hospital.page.locator("tbody tr").filter({ hasText: invoice });
      await expect(row).toBeVisible();
      await expect(row.getByLabel(`Authorized claimants for ${invoice}`)).toHaveCount(0);
      await expect(row.getByText("Publication pending", { exact: true })).toHaveCount(0, { timeout: 90000 });
    } finally {
      await closeActor(user);
      await closeActor(hospital);
    }
    const auditor = await createActorContext(browser, "admin");
    try {
      await loginActor(auditor.page, auditor.actor);
      await auditor.page.goto("/admin/healthcare-registry");
      await expect(auditor.page.getByText("Roots Match", { exact: true })).toBeVisible({ timeout: 30000 });
    } finally { await closeActor(auditor); }
  });
  test("Hospital can correct and restore a bill while classification controls remain unavailable", async ({ browser }) => {
    const session = await createActorContext(browser, "hospital");
    try {
      await loginActor(session.page, session.actor);
      await session.page.goto("/hospital/records");
      const recordRow = session.page.locator("tbody tr").filter({ hasText: "INV-HOSP-001-001" });
      await expect(recordRow).toBeVisible();

      const bill = recordRow.getByLabel("Correct bill for INV-HOSP-001-001");
      const original = await bill.inputValue();
      await expect(recordRow.getByLabel(/invoice status/i)).toHaveCount(0);
      for (const value of ["0.11", original]) {
        await bill.fill(value);
        const saved = session.page.waitForResponse(response => response.request().method() === "PATCH" && response.url().includes("/hospitals/records/"));
        await recordRow.getByRole("button", { name: "Save correction" }).click();
        expect((await saved).ok()).toBe(true);
      }
      await session.page.reload();
      const restoredRow = recordRow;
      await expect(bill).toHaveValue(original);
      await expect(restoredRow.getByText("Publication pending", { exact: true })).toHaveCount(0, { timeout: 90000 });
    } finally {
      await closeActor(session);
    }

    const auditorSession = await createActorContext(browser, "admin");
    try {
      await loginActor(auditorSession.page, auditorSession.actor);
      await auditorSession.page.goto("/admin/healthcare-registry");
      await expect(auditorSession.page.getByText("Roots Match", { exact: true })).toBeVisible();
    } finally {
      await closeActor(auditorSession);
    }
  });
});
