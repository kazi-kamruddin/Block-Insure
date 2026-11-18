const { test, expect } = require("@playwright/test");
const { loginActor, localDateTimeValue, syntheticPdfEvidenceFile } = require("../support/actions");
const { prepareEpisode, selectEpisode } = require("../support/intakeEpisode");
const { closeActor, createActorContext } = require("../support/walletBridge");

test("@workflow claimant answers a clarification, reconciles evidence and receives a fresh Oracle decision", async ({ browser }) => {
  test.skip(process.env.CLAIM_WORKFLOW_PROFILE !== "V6", "Uses the deployment profile that supports clarification");
  test.setTimeout(600000);
  const user = await createActorContext(browser, "user");
  const admin = await createActorContext(browser, "admin");
  try {
    await loginActor(user.page, user.actor);
    await user.page.goto("/user/policies/buy");
    await user.page.getByRole("checkbox", { name: /I have read and agree/ }).first().check();
    await user.page.getByRole("button", { name: "Buy Policy" }).first().click();
    await expect(user.page.locator(".success-text")).toContainText("policy purchased successfully");
    const episode = await prepareEpisode(user);
    await user.page.goto("/user/claims/new");
    const policy = user.page.getByLabel("Policy", { exact: true });
    await expect.poll(() => policy.locator("option").count()).toBeGreaterThan(1);
    await policy.selectOption({ index: 1 });
    await selectEpisode(user.page, episode.invoiceNumber);
    const block = await user.provider.getBlock("latest");
    await user.page.getByLabel("Incident date/time").fill(localDateTimeValue(new Date(Number(block.timestamp) * 1000)));
    await user.page.getByLabel("Claim document").setInputFiles(syntheticPdfEvidenceFile());
    await user.page.getByRole("button", { name: "Submit Claim", exact: true }).click();
    const confirmation = user.page.locator(".success-text");
    await expect(confirmation).toContainText("encrypted evidence was reconciled", { timeout: 120000 });
    const claimId = (await confirmation.textContent()).match(/Claim #(\d+)/)[1];
    await loginActor(admin.page, admin.actor);
    await episode.revoke(admin);
    await admin.page.goto(`/admin/claims/${claimId}`);
    const request = admin.page.getByRole("button", { name: "Request Oracle Verification", exact: true });
    await request.click();
    const question = admin.page.getByLabel("Question for the claimant");
    await expect(question).toBeVisible({ timeout: 120000 });
    await question.fill("Please attach the receipt that identifies the patient on this episode.");
    await admin.page.getByRole("button", { name: "Request clarification" }).click();
    await expect(admin.page.getByRole("button", { name: "Send to Manual Review" })).toBeDisabled();
    await episode.restore(admin);
    await user.page.goto(`/user/claims/${claimId}`);
    await user.page.getByLabel("Supporting document").setInputFiles(syntheticPdfEvidenceFile());
    await user.page.getByRole("button", { name: "Submit clarification" }).click();
    await expect(user.page.getByText("The updated evidence is ready for fresh Oracle verification.")).toBeVisible({ timeout: 120000 });
    await admin.page.reload();
    await request.click();
    await expect(admin.page.locator(".admin-claim-sidebar p strong").first()).toHaveText("PAYOUT_READY", { timeout: 120000 });
    await user.page.reload();
    await user.page.getByRole("button", { name: "Withdraw Payment" }).click();
    await expect(user.page.getByText("SETTLED", { exact: true })).toBeVisible({ timeout: 90000 });
    await user.page.goto("/user/policies");
    await expect(user.page.getByRole("button", { name: "Pay Premium", exact: true }).first()).toBeDisabled();
  } finally {
    await closeActor(admin);
    await closeActor(user);
  }
});
