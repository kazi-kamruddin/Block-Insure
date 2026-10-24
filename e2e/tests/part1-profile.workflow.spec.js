const { test, expect } = require("@playwright/test");
const { loginActor } = require("../support/actions");
const { createActorContext, closeActor } = require("../support/walletBridge");

test("@workflow profile remains optional, validates fields and works at 320px", async ({ browser }) => {
  const user = await createActorContext(browser, "user", { viewport: { width: 320, height: 800 } });
  const errors = [];
  user.page.on("pageerror", (error) => errors.push(error.message));
  try {
    await loginActor(user.page, user.actor);
    await user.page.goto("/user/profile");
    await expect(user.page.getByRole("heading", { name: "My profile" })).toBeVisible();
    await user.page.getByLabel("Display name").fill("Demo Policyholder");
    await user.page.getByLabel("Email", { exact: true }).fill("not-an-email");
    await user.page.getByRole("button", { name: "Save profile" }).click();
    expect(await user.page.getByLabel("Email", { exact: true }).evaluate((input) => input.checkValidity())).toBe(false);
    await expect(user.page.getByText("Profile saved.", { exact: true })).toHaveCount(0);
    await user.page.getByLabel("Email", { exact: true }).fill("demo@example.test");
    await user.page.getByRole("button", { name: "Save profile" }).click();
    await expect(user.page.getByRole("status").filter({ hasText: "Profile saved" })).toBeVisible();
    await user.page.reload();
    await expect(user.page.getByLabel("Display name")).toHaveValue("Demo Policyholder");
    await user.page.getByRole("button", { name: "Request email verification code" }).click();
    await expect(user.page.getByText(/Simulated code:/)).toBeVisible();
    await user.page.getByRole("button", { name: "Confirm email code" }).click();
    await expect(user.page.getByText("Simulation completed. Mailbox ownership was not verified.")).toBeVisible();
    await user.page.getByRole("button", { name: "Check evidence recovery" }).click();
    await expect(user.page.getByText(/No identity in this browser/)).toBeVisible();
    await expect(user.page.getByRole("button", { name: "Restore evidence access" })).toBeDisabled();
    expect(await user.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    expect(errors).toEqual([]);
    await user.page.evaluate(() => window.scrollTo({ top: 0, left: 0, behavior: "instant" }));
    await user.page.waitForFunction(() => window.scrollY === 0);
    await user.page.screenshot({ path: "output/playwright/prototype-profile-320.png", fullPage: true, animations: "disabled" });
  } finally { await closeActor(user); }
});
