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
      await hospital.page.getByLabel(/Authorized claimant wallets/).fill(user.wallet.address);
      await hospital.page.getByLabel("Diagnosis code", { exact: true }).fill("DEMO");
      for (const name of ["Admission date", "Discharge date", "Invoice date"]) await hospital.page.getByLabel(name, { exact: true }).fill(date);
      await hospital.page.getByLabel("Bill amount (ETH)", { exact: true }).fill("0.1");
      await hospital.page.getByRole("button", { name: "Create hospital record", exact: true }).click();
      const row = hospital.page.locator("tbody tr").filter({ hasText: invoice });
      await expect(row).toBeVisible();
      await expect(row.getByLabel(`Authorized claimants for ${invoice}`)).toHaveValue(user.wallet.address.toLowerCase());
      await expect(row.getByText("Publication pending", { exact: true })).toHaveCount(0, { timeout: 90000 });
    } finally {
      await closeActor(user);
      await closeActor(hospital);
    }
    const auditor = await createActorContext(browser, "auditor1");
    try {
      await loginActor(auditor.page, auditor.actor);
      await auditor.page.goto("/auditor/healthcare-registry");
      await expect(auditor.page.getByText("Roots Match", { exact: true })).toBeVisible({ timeout: 30000 });
    } finally { await closeActor(auditor); }
  });
  test("Hospital can update record and invoice status and restore the source record", async ({ browser }) => {
    const session = await createActorContext(browser, "hospital");
    try {
      await loginActor(session.page, session.actor);
      await session.page.goto("/hospital/records");
      const recordRow = session.page.locator("tbody tr").filter({ hasText: "INV-HOSP-001-001" });
      await expect(recordRow).toBeVisible();

      const recordStatus = recordRow.getByLabel("Record status for INV-HOSP-001-001");
      const invoiceStatus = recordRow.getByLabel("Invoice status for INV-HOSP-001-001");
      await expect(recordStatus).toHaveValue("VALID");
      await expect(invoiceStatus).toHaveValue("VALID");

      for (const [select, temporaryValue] of [
        [recordStatus, "INVALID"],
        [invoiceStatus, "SUSPICIOUS"],
      ]) {
        const updateResponsePromise = session.page.waitForResponse(
          (response) => response.request().method() === "PATCH" && /\/api\/hospitals\/records\/[^/]+$/.test(response.url())
        );
        await select.selectOption(temporaryValue);
        const updateResponse = await updateResponsePromise;
        expect(updateResponse.ok(), await updateResponse.text()).toBe(true);
        await expect(select).toHaveValue(temporaryValue);

        const restoreResponsePromise = session.page.waitForResponse(
          (response) => response.request().method() === "PATCH" && /\/api\/hospitals\/records\/[^/]+$/.test(response.url())
        );
        await select.selectOption("VALID");
        const restoreResponse = await restoreResponsePromise;
        expect(restoreResponse.ok(), await restoreResponse.text()).toBe(true);
        await expect(select).toHaveValue("VALID");
      }

      await session.page.reload();
      const restoredRow = session.page.locator("tbody tr").filter({ hasText: "INV-HOSP-001-001" });
      await expect(restoredRow.getByLabel("Record status for INV-HOSP-001-001")).toHaveValue("VALID");
      await expect(restoredRow.getByLabel("Invoice status for INV-HOSP-001-001")).toHaveValue("VALID");
      await expect(restoredRow.getByText("Publication pending", { exact: true })).toHaveCount(0, { timeout: 90000 });
    } finally {
      await closeActor(session);
    }

    const auditorSession = await createActorContext(browser, "auditor1");
    try {
      await loginActor(auditorSession.page, auditorSession.actor);
      await auditorSession.page.goto("/auditor/healthcare-registry");
      await expect(auditorSession.page.getByText("Roots Match", { exact: true })).toBeVisible();
    } finally {
      await closeActor(auditorSession);
    }
  });
});
