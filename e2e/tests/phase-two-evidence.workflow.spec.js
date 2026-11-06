const { test, expect } = require("@playwright/test");
const fs = require("node:fs");
const mongoose = require("../../backEnd/node_modules/mongoose");
const { Contract } = require("../../backEnd/node_modules/ethers");
const { createActorContext, closeActor } = require("../support/walletBridge");
const { loginActor, resetLocalClaimSubmissionLimit, syntheticPdfEvidenceFile, uniqueEvidenceFile, localDateTimeValue } = require("../support/actions");
const { prepareReviewerIdentities, authorizeReview } = require("../support/reviewPreparation");
const { requireDisposableE2EMongoUri } = require("../support/environment");

async function buyAndFill(session) {
  const page = session.page;
  await loginActor(page, session.actor); await resetLocalClaimSubmissionLimit(page);
  await page.goto("/user/policies/buy");
  await page.getByRole("checkbox", { name: /I have read and agree/ }).first().check();
  await page.getByRole("button", { name: "Buy Policy" }).first().click();
  await expect(page.locator(".success-text")).toContainText("policy purchased successfully");
  await page.goto("/user/claims/new");
  const policy = page.getByLabel("Policy", { exact: true });
  await expect.poll(() => policy.locator("option").count()).toBeGreaterThan(1);
  await policy.selectOption({ index: (await policy.locator("option").count()) - 1 });
  await page.getByLabel("Test data preset").selectOption({ label: "Valid HOSP-001 / HOSPITALIZATION / 0.1 ETH" });
  const correctedInvoice = await page.getByLabel("Invoice number").inputValue();
  const incident = page.getByLabel("Incident date/time"); await incident.evaluate((input) => input.setAttribute("step", "1"));
  await incident.fill(localDateTimeValue(new Date(Number((await session.provider.getBlock("latest")).timestamp) * 1000)));
  await page.getByLabel("Invoice number").fill(`MANUAL-${Date.now()}`);
  return correctedInvoice;
}
async function openReview(browser, claimId) {
  const admin = await createActorContext(browser, "admin");
  try {
    await loginActor(admin.page, admin.actor); await admin.page.goto(`/admin/claims/${claimId}`);
    await admin.page.getByRole("button", { name: "Request Oracle Verification" }).click();
    const status = admin.page.locator(".admin-claim-sidebar p strong").first();
    await expect.poll(async () => { await admin.page.getByRole("button", { name: "Refresh Claim" }).click(); return (await status.textContent()).trim(); }, { timeout: 90000, intervals: [1000, 3000] }).toBe("ORACLE_FAILED");
    await admin.page.getByRole("button", { name: "Send to Manual Review" }).click();
    // Wait for the signed transaction, API audit confirmation and claim refresh.
    // Their completion can exceed the default text assertion timeout under load.
    await expect(admin.page.locator(".success-text")).toContainText("Claim sent to manual review successfully.", { timeout: 60000 });
    await expect(status).toHaveText("MANUAL_REVIEW", { timeout: 60000 });
  } finally { await closeActor(admin); }
}
const claimIdFrom = async (page) => {
  const message = page.locator(".success-text");
  await expect(message).toContainText("encrypted evidence was reconciled successfully", { timeout: 120000 });
  return (await message.textContent()).match(/Claim #(\d+)/)[1];
};
async function chain(session) {
  const manager = new Contract(process.env.CONTRACT_ADDRESS || process.env.VITE_CONTRACT_ADDRESS, require("../../backEnd/abi/InsuranceManager.json").abi, session.wallet);
  return { manager, adjudicator: new Contract(await manager.claimAdjudicator(), require("../../backEnd/abi/ClaimAdjudicator.json").abi, session.provider) };
}

test.describe("@workflow phase two evidence and review recovery", () => {
  test.describe.configure({ mode: "serial" });
  test("partial bundle recovery, batch authorization, owner-offline decryption and quorum withdrawal", async ({ browser }, testInfo) => {
    test.setTimeout(420000);
    const user = await createActorContext(browser, "user", { viewport: { width: 320, height: 900 } });
    const primary = syntheticPdfEvidenceFile(), supporting = uniqueEvidenceFile();
    let claimantClosed = false;
    const mongo = await mongoose.createConnection(requireDisposableE2EMongoUri()).asPromise();
    try {
      await buyAndFill(user);
      await user.page.getByLabel("Claim document", { exact: true }).setInputFiles(primary);
      await user.page.getByLabel("Supporting evidence (optional)").setInputFiles(supporting);
      let interrupted = false;
      await user.page.route("**/api/documents/upload", async (route) => {
        if (!interrupted && route.request().postDataBuffer()?.includes(Buffer.from("SUPPORTING_DOCUMENT"))) {
          interrupted = true; return route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ success: false, message: "Synthetic interrupted supporting upload" }) });
        }
        return route.continue();
      });
      await user.page.getByRole("button", { name: "Submit Claim", exact: true }).click();
      const recovery = user.page.getByRole("region", { name: "Claim submission recovery" });
      await expect(recovery).toContainText("1/2 selected files uploaded", { timeout: 60000 });
      expect(interrupted).toBe(true);
      await user.page.unroute("**/api/documents/upload");
      await user.page.reload();
      await recovery.getByRole("button", { name: "Resume evidence uploads" }).click();
      await user.page.getByLabel("Supporting file slot 2").setInputFiles(supporting);
      await user.page.getByRole("button", { name: "Submit Claim", exact: true }).click();
      const claimId = await claimIdFrom(user.page);
      const files = await mongo.db.collection("files").find({ claimId }).sort({ uploadSlot: 1 }).toArray();
      expect(files).toHaveLength(2); expect(new Set(files.map((file) => file.associatedDataHash)).size).toBe(2);
      expect(await mongo.db.collection("claimsubmissionattempts").countDocuments({ claimId })).toBe(1);
      await user.page.goto(`/user/claims/${claimId}`);
      const ownerFiles = user.page.locator(".evidence-chain-item");
      await expect(ownerFiles).toHaveCount(2);
      for (const [index, original] of [primary, supporting].entries()) {
        const downloaded = user.page.waitForEvent("download");
        await ownerFiles.nth(index).getByRole("button", { name: "Download decrypted" }).click();
        const download = await downloaded;
        expect(fs.readFileSync(await download.path()).equals(original.buffer)).toBe(true);
      }
      await testInfo.attach("owner-decryption-verified", { body: "Both original plaintext files matched after browser decryption", contentType: "text/plain" });
      await openReview(browser, claimId);
      const { manager, adjudicator } = await chain(user);
      expect((await adjudicator.getReview(claimId, 1)).deadline).toBe(0n);
      await prepareReviewerIdentities(browser);
      const unauthorized = await createActorContext(browser, "beneficiary");
      try {
        await loginActor(unauthorized.page, unauthorized.actor);
        const denial = await unauthorized.page.evaluate(async (id) => (await fetch(`http://localhost:5000/api/documents/${id}/decryption-key`, { headers: { Authorization: `Bearer ${localStorage.getItem("blockinsure_jwt")}` } })).status, String(files[0]._id));
        expect(denial).toBe(403);
      } finally { await closeActor(unauthorized); }
      await authorizeReview(user.page, claimId);
      const originalDeadline = (await adjudicator.getReview(claimId, 1)).deadline;
      const probe = await createActorContext(browser, "auditor1");
      try {
        await loginActor(probe.page, probe.actor);
        const readCapsule = () => probe.page.evaluate(async (id) => (await fetch(`http://localhost:5000/api/documents/${id}/decryption-key`, {
          headers: { Authorization: `Bearer ${localStorage.getItem("blockinsure_jwt")}` },
        })).status, String(files[0]._id));
        expect(await readCapsule()).toBe(200);
        const revoked = await user.page.evaluate(async ({ id, wallet }) => (await fetch(`http://localhost:5000/api/documents/${id}/grants`, {
          method: "DELETE", headers: { "content-type": "application/json", Authorization: `Bearer ${localStorage.getItem("blockinsure_jwt")}` }, body: JSON.stringify({ granteeWallet: wallet }),
        })).status, { id: String(files[0]._id), wallet: probe.wallet.address.toLowerCase() });
        expect(revoked).toBe(200);
        expect(await readCapsule()).toBe(403);
        await expect(user.page.getByRole("region", { name: "Evidence access preparation" })).toContainText("A grant or registered key changed", { timeout: 10000 });
        const resumed = await user.page.evaluate(async (id) => (await fetch(`http://localhost:5000/api/claims/${id}/review-access/resume`, {
          method: "POST", headers: { Authorization: `Bearer ${localStorage.getItem("blockinsure_jwt")}` },
        })).status, claimId);
        expect(resumed).toBe(202); expect(await readCapsule()).toBe(200);
        expect((await adjudicator.getReview(claimId, 1)).deadline).toBe(originalDeadline);
      } finally { await closeActor(probe); }
      expect(await user.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
      await testInfo.attach("prepared-review-320", { body: await user.page.screenshot({ fullPage: true }), contentType: "image/png" });
      await closeActor(user); claimantClosed = true;
      for (const name of ["auditor1", "auditor2", "auditor3"]) {
        const auditor = await createActorContext(browser, name, { acceptDownloads: true });
        try {
          await loginActor(auditor.page, auditor.actor);
          // A fresh browser recovers the original auditor encryption identity.
          await auditor.page.goto("/auditor/votes");
          await auditor.page.getByRole("button", { name: "Prepare encrypted evidence access" }).click();
          await expect(auditor.page.locator(".app-toast")).toContainText("evidence identity is ready", { timeout: 60000 });
          await auditor.page.goto(`/auditor/vote/${claimId}`);
          const items = auditor.page.locator(".evidence-chain-item"); await expect(items).toHaveCount(2);
          for (let index = 0; index < 2; index++) {
            const download = auditor.page.waitForEvent("download");
            await items.nth(index).getByRole("button", { name: "Download decrypted" }).click();
            expect(fs.readFileSync(await (await download).path())).toEqual(index ? supporting.buffer : primary.buffer);
          }
          await items.nth(1).getByRole("button", { name: "Preview decrypted" }).click();
          await expect(auditor.page.getByRole("dialog", { name: "Decrypted evidence preview" }).getByRole("img", { name: "Decrypted claim evidence" })).toBeVisible();
          await auditor.page.keyboard.press("Escape");
          await auditor.page.getByRole("button", { name: "Valid Claim", exact: true }).click();
          await expect(auditor.page.locator(".success-text")).toContainText("Valid Claim vote recorded on-chain", { timeout: 60000 });
        } finally { await closeActor(auditor); }
      }
      const returning = await createActorContext(browser, "user");
      try {
        await loginActor(returning.page, returning.actor); await returning.page.goto(`/user/claims/${claimId}`);
        await returning.page.getByRole("button", { name: "Withdraw Payment" }).click();
        await expect(returning.page.getByText("SETTLED", { exact: true })).toBeVisible();
        const read = new Contract(manager.target, manager.interface, returning.provider);
        expect(Number((await read.getClaim(claimId)).status)).toBe(9);
      } finally { await closeActor(returning); }
      expect(await mongo.db.collection("evidencegrants").countDocuments({ claimId, revokedAt: null })).toBe(8);
    } finally { if (!claimantClosed) await closeActor(user); await mongo.close(); }
  });

  test("preparation expiry and a mined appeal recover after lost registration without another round", async ({ browser }) => {
    test.setTimeout(300000);
    const user = await createActorContext(browser, "user");
    const mongo = await mongoose.createConnection(requireDisposableE2EMongoUri()).asPromise();
    try {
      const correctedInvoice = await buyAndFill(user);
      await user.page.getByLabel("Claim document", { exact: true }).setInputFiles(syntheticPdfEvidenceFile());
      await user.page.getByRole("button", { name: "Submit Claim", exact: true }).click();
      const claimId = await claimIdFrom(user.page); await openReview(browser, claimId);
      const { manager, adjudicator } = await chain(user);
      const preparation = await adjudicator.getPreparation(claimId, 1);
      await user.provider.send("evm_setNextBlockTimestamp", [Number(preparation.deadline) + 1]); await user.provider.send("evm_mine", []);
      await user.page.goto(`/user/claims/${claimId}`);
      await user.page.getByRole("button", { name: "Close incomplete preparation" }).click();
      await expect(user.page.getByText("REJECTED", { exact: true })).toBeVisible();
      await expect(user.page.getByText(/This is not a fraud verdict/)).toBeVisible();
      await user.page.getByLabel("Appeal reason", { exact: true }).fill("Recover missed access authorization and correct invoice reference");
      await user.page.getByLabel("Correct invoice number").fill(correctedInvoice);
      await user.page.getByLabel("Additional document").setInputFiles(uniqueEvidenceFile());
      let lost = false;
      await user.page.route("**/api/appeals/attempts/*/transaction", (route) => { lost = true; return route.abort("connectionreset"); });
      await user.page.getByRole("button", { name: "Appeal This Decision" }).click();
      await expect.poll(() => lost).toBe(true);
      await expect.poll(async () => Number(await manager.claimVersion(claimId))).toBe(2);
      expect(await adjudicator.appealRound(claimId)).toBe(0n);
      await user.page.unroute("**/api/appeals/attempts/*/transaction");
      await user.page.reload();
      await user.page.getByRole("button", { name: "Recover appeal registration" }).click();
      await expect(user.page.locator(".appeal-status")).toContainText("Recover missed access authorization", { timeout: 60000 });
      expect(await mongo.db.collection("appeals").countDocuments({ claimId, claimVersion: 2 })).toBe(1);
      const bundle = await mongo.db.collection("evidencebundles").findOne({ claimId, claimVersion: 2 });
      expect(bundle.documentIds).toHaveLength(2);
      expect(await manager.claimVersion(claimId)).toBe(2n);
      const admin = await createActorContext(browser, "admin");
      try {
        await loginActor(admin.page, admin.actor); await admin.page.goto(`/admin/claims/${claimId}`);
        await admin.page.getByRole("button", { name: "Request Oracle Verification" }).click();
        await expect.poll(async () => Number((await manager.getClaim(claimId)).status), { timeout: 120000, intervals: [2000] }).toBe(7);
      } finally { await closeActor(admin); }
      await user.page.reload(); await user.page.getByRole("button", { name: "Withdraw Payment" }).click();
      await expect(user.page.getByText("SETTLED", { exact: true })).toBeVisible();
    } finally { await closeActor(user); await mongo.close(); }
  });
});
