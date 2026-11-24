const { expect } = require("@playwright/test");
const { randomUUID } = require("node:crypto");
const { loginActor } = require("./actions");
const { createActorContext, closeActor } = require("./walletBridge");
const { getE2EConfig } = require("./environment");

async function selectEpisode(page, invoice = "INV-HOSP-001-001") {
  const picker = page.getByLabel("Authorized episode");
  const option = picker.locator("option").filter({ hasText: invoice });
  await expect(option).toHaveCount(1);
  await picker.selectOption(await option.getAttribute("value"));
}

// Create an eligible episode. In manual-review scenarios the insurer corrects
// its patient association AFTER filing, before the workers verify ownership.
async function prepareEpisode(user, { billAmount = "0.1", treatmentType = "HOSPITALIZATION",
  invoiceNumber = "INTAKE-" + randomUUID(), patientReference = randomUUID(), publishExplicitly = false } = {}) {
  const browser = user.context.browser();
  const hospital = await createActorContext(browser, "hospital");
  const admin = await createActorContext(browser, "admin");
  const api = getE2EConfig().apiUrl + "/api/hospitals";
  const headers = async actor => ({ Authorization: "Bearer " + await actor.page.evaluate(() =>
    sessionStorage.getItem("blockinsure_hospital_session") || localStorage.getItem("blockinsure_jwt")) });
  const associate = async (actor, revision, wallet) => {
    const response = await actor.page.request.put(api + "/insurer/association", { headers: await headers(actor),
      data: { hospitalId: "HOSP-001", invoiceNumber, patientReference, revision, wallet,
        reason: wallet ? "Synthetic enrollment verified" : "Officer corrected an enrollment after filing" } });
    expect(response.ok(), await response.text()).toBe(true);
    const updatedRevision = (await response.json()).revision;
    const authorization = await headers(actor);
    await expect.poll(async () => {
      if (publishExplicitly) {
        const result = await actor.page.request.post(api + "/insurer/publish", { headers: authorization, timeout: 20000 });
        expect(result.ok(), "Explicit publication must succeed through the insurer API").toBe(true);
      }
      const status = await actor.page.request.get(api + "/insurer/publication-status", {
        headers: authorization, params: { hospitalId: "HOSP-001", invoiceNumber }, maxRetries: 1 });
      const result = await status.json();
      return result.revision === updatedRevision && result.pending === false;
    }, { timeout: 120000 }).toBe(true);
    return updatedRevision;
  };
  try {
    await loginActor(hospital.page, hospital.actor);
    await loginActor(admin.page, admin.actor);
    const date = new Date(Number((await user.provider.getBlock("latest")).timestamp) * 1000).toISOString().slice(0, 10);
    const created = await hospital.page.request.post(api + "/records", { headers: await headers(hospital),
      data: { invoiceNumber, patientReference, admissionDate: date, dischargeDate: date, invoiceDate: date,
        billAmount, treatmentType, diagnosisCode: "DEMO" } });
    expect(created.status(), await created.text()).toBe(201);
    const { record } = await created.json();
    let revision = await associate(admin, record.revision, user.wallet.address);
    await expect.poll(async () => {
      const response = await user.page.request.get(api + "/my-episodes", { headers: await headers(user), maxRetries: 1 });
      return (await response.json()).records.some(row => row.invoiceNumber === invoiceNumber);
    }, { timeout: 90000 }).toBe(true);
    return { invoiceNumber, invoiceHash: record.invoiceHash, revoke: async actor => { revision = await associate(actor, revision, null); },
      restore: async actor => { revision = await associate(actor, revision, user.wallet.address); } };
  } finally {
    await closeActor(admin);
    await closeActor(hospital);
  }
}

module.exports = { selectEpisode, prepareEpisode };
