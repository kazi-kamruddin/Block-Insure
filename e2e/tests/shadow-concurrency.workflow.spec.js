const { test, expect } = require("@playwright/test");
const mongoose = require("../../backEnd/node_modules/mongoose");
const { createActorContext, closeActor } = require("../support/walletBridge");
const { loginActor, localDateTimeValue, syntheticPdfEvidenceFile } = require("../support/actions");
const { requireDisposableE2EMongoUri } = require("../support/environment");
test("@workflow simultaneous claimant submissions retain separate evidence and shadow identities", async ({ browser }) => {
  test.setTimeout(240000);
  const sessions = [];
  const mongo = await mongoose.createConnection(requireDisposableE2EMongoUri()).asPromise();
  try {
    for (const actor of ["user", "beneficiary", "hospital", "admin"]) {
      const session = await createActorContext(browser, actor); sessions.push(session); await loginActor(session.page, session.actor);
    }
    const [first, second, hospital, admin] = sessions;
    const users = [first, second], invoices = users.map((_, i) => `CONCURRENT-SHADOW-${Date.now()}-${i}`);
    const headers = async (session) => ({ Authorization: `Bearer ${await session.page.evaluate(() => sessionStorage.getItem("blockinsure_hospital_session") || localStorage.getItem("blockinsure_jwt"))}` });
    for (const user of users) {
      await user.page.goto("/user/policies/buy");
      await user.page.getByRole("checkbox", { name: /I have read and agree/ }).first().check();
      await user.page.getByRole("button", { name: "Buy Policy" }).first().click();
      await expect(user.page.locator(".success-text")).toContainText("policy purchased successfully");
    }
    const block = await first.provider.getBlock("latest");
    const instant = new Date(Number(block.timestamp) * 1000);
    for (let i = 0; i < users.length; i++) {
      const response = await hospital.context.request.post("http://localhost:5000/api/hospitals/records", { headers: await headers(hospital), data: {
        invoiceNumber: invoices[i], patientReference: `synthetic-concurrency-${i}`, authorizedClaimants: users[i].wallet.address,
        treatmentType: "HOSPITALIZATION", diagnosisCode: "DEMO", billAmount: "0.1",
        admissionDate: instant.toISOString(), dischargeDate: instant.toISOString(), invoiceDate: instant.toISOString(),
      } });
      expect(response.status(), await response.text()).toBe(201);
    }
    await expect.poll(async () => mongo.db.collection("mockhospitalrecords").countDocuments({ invoiceNumber: { $in: invoices }, publicationPending: false }),
      { timeout: 90000 }).toBe(2);
    for (let i = 0; i < users.length; i++) {
      const page = users[i].page;
      await page.goto("/user/claims/new");
      const policy = page.getByLabel("Policy", { exact: true });
      await expect.poll(() => policy.locator("option").count()).toBeGreaterThan(1);
      await policy.selectOption({ index: 1 });
      await page.getByLabel("Test data preset").selectOption({ label: "Valid HOSP-001 / HOSPITALIZATION / 0.1 ETH" });
      await page.getByLabel("Invoice number").fill(invoices[i]);
      const incident = page.getByLabel("Incident date/time"); await incident.evaluate((input) => input.setAttribute("step", "1"));
      await incident.fill(localDateTimeValue(instant));
      await page.getByLabel("Claim document").setInputFiles(syntheticPdfEvidenceFile());
    }
    await Promise.all(users.map((user) => user.page.getByRole("button", { name: "Submit Claim" }).click()));
    const ids = [];
    for (const user of users) {
      await expect(user.page.locator(".success-text")).toContainText("submitted and its encrypted evidence was reconciled successfully", { timeout: 120000 });
      ids.push((await user.page.locator(".success-text").textContent()).match(/Claim #(\d+)/)[1]);
    }
    expect(new Set(ids).size).toBe(2);
    const documents = await mongo.db.collection("files").find({ claimId: { $in: ids } }).toArray();
    expect(documents).toHaveLength(2);
    expect(new Set(documents.map((d) => d.claimId)).size).toBe(2);
    const read = async (id) => {
      // A pooled socket may close between polls. Retry only one ECONNRESET on
      // this idempotent GET; HTTP failures and scenario deadlines still fail.
      const response = await admin.context.request.get(`http://localhost:5000/api/claims/${id}/advisory`, {
        headers: await headers(admin), maxRetries: 1,
      });
      expect(response.status(), await response.text()).toBe(200);
      return (await response.json()).advisory;
    };
    const assessed = await Promise.all(ids.map(read));
    expect(assessed.every((a) => a.status === "AVAILABLE")).toBe(true);
    expect(new Set(assessed.map((a) => a.assessmentId)).size).toBe(2);
    for (const id of ids) {
      await admin.page.goto(`/admin/claims/${id}`);
      await admin.page.getByRole("button", { name: "Request Oracle Verification" }).click();
      await expect(admin.page.locator(".success-text")).toContainText("Oracle verification requested successfully");
    }
    for (const id of ids) {
      await expect.poll(async () => (await read(id)).workerShadow?.status, { timeout: 90000, intervals: [5000] }).toBe("MATCHED");
      expect((await read(id)).workerShadow.reports).toBe(2);
    }
  } finally {
    await mongo.close();
    for (const session of sessions.reverse()) await closeActor(session);
  }
});
