const { expect } = require("@playwright/test");
const { Contract } = require("../../backEnd/node_modules/ethers");
const { createActorContext, closeActor } = require("./walletBridge");
const { loginActor } = require("./actions");
const { getE2EConfig } = require("./environment");
async function prepareReviewerIdentities(browser) {
  for (const name of ["auditor1", "auditor2", "auditor3", "auditor4"]) {
    const session = await createActorContext(browser, name);
    try {
      await loginActor(session.page, session.actor);
      await session.page.goto("/auditor/votes");
      const keyPath = "/api/documents/encryption-key";
      const token = await session.page.evaluate(() => localStorage.getItem("blockinsure_jwt"));
      const existing = await session.page.request.get(getE2EConfig().apiUrl + keyPath, {
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(existing.ok(), "The API must confirm whether this reviewer has a registered key").toBe(true);
      const { key } = await existing.json();
      const prepare = session.page.getByRole("button", { name: "Prepare encrypted evidence access" });
      if (key.registered) {
        await Promise.all([
          expect(session.page.getByText("Your client-side evidence identity is ready.", { exact: true }))
            .toBeVisible({ timeout: 60000 }),
          prepare.click(),
        ]);
      } else {
        const [confirmation] = await Promise.all([
          session.page.waitForResponse((response) => response.request().method() === "POST" &&
            new URL(response.url()).pathname === keyPath, { timeout: 60000 }),
          prepare.click(),
        ]);
        expect(confirmation.ok(), "Evidence identity must be saved by the API").toBe(true);
      }
      const registry = new Contract(process.env.EVIDENCE_REGISTRY_ADDRESS || process.env.VITE_EVIDENCE_REGISTRY_ADDRESS,
        require("../../backEnd/abi/EvidenceRegistry.json").abi, session.provider);
      const identity = await registry.getEncryptionIdentity(session.wallet.address);
      expect(identity.version > 0n && identity.revokedAt === 0n).toBe(true);
    } finally { await closeActor(session); }
  }
}
async function authorizeReview(page, claimId) {
  await page.goto(`/user/claims/${claimId}`);
  const panel = page.getByRole("region", { name: "Evidence access preparation" });
  const button = panel.getByRole("button", { name: /Authorize assigned reviewers|Resume stored reviewer authorization/ });
  await expect(button).toBeEnabled({ timeout: 30000 });
  await button.click();
  await expect(panel.getByRole("status")).toContainText("ACTIVE", { timeout: 60000 });
}
module.exports = { prepareReviewerIdentities, authorizeReview };
