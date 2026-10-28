const { expect } = require("@playwright/test");
const { createActorContext, closeActor } = require("./walletBridge");
const { loginActor } = require("./actions");
async function prepareReviewerIdentities(browser) {
  for (const name of ["auditor1", "auditor2", "auditor3", "auditor4"]) {
    const session = await createActorContext(browser, name);
    try {
      await loginActor(session.page, session.actor);
      await session.page.goto("/auditor/votes");
      await session.page.getByRole("button", { name: "Prepare encrypted evidence access" }).click();
      await expect(session.page.locator(".app-toast")).toContainText("evidence identity is ready", { timeout: 60000 });
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
