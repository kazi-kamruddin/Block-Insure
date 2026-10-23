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
    expect(await user.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    expect(errors).toEqual([]);
  } finally { await closeActor(user); }
});
