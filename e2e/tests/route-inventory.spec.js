const { test, expect } = require("@playwright/test");
const { loginActor } = require("../support/actions");
const { closeActor, createActorContext } = require("../support/walletBridge");

const roleRoutes = {
  user: [
    ["/user/dashboard", "Coverage and claims overview"],
    ["/user/policies/buy", "Buy Policy"],
    ["/user/policies", "My Policies"],
    ["/user/payments", "Payments and Statements"],
    ["/user/banking", "Premium payments and standing EFT instructions"],
    ["/user/claims", "My Claims"],
    ["/user/claims/new", "Submit Claim"],
    ["/user/benefits", "Beneficiary Benefit Request"],
    ["/user/notifications", "Notifications"],
  ],
  admin: [
    ["/admin/dashboard", "Portfolio oversight"],
    ["/admin/policy-packages", "Admin Policy Packages"],
    ["/admin/policy-packages/new", "Create Policy Package"],
    ["/admin/benefits", "Policy Benefits Administration"],
    ["/admin/healthcare-registry", "Hybrid External Registry"],
    ["/admin/thesis-dashboard", "Thesis Results Dashboard"],
    ["/admin/audit-actions", "Admin Action Audit"],
    ["/admin/role-health", "Role Sync Health"],
    ["/admin/claims", "Admin Claims"],
    ["/admin/notifications", "Notifications"],
  ],
  auditor1: [
    ["/auditor/dashboard", "Claim audit and evidence review"],
    ["/auditor/healthcare-registry", "Hybrid External Registry"],
    ["/auditor/claims", "Claim Audit Timelines"],
    ["/auditor/votes", "Voting Queue"],
    ["/auditor/verify-document", "Document Integrity Verification"],
    ["/auditor/reputation", "Auditor Reputation"],
  ],
  hospital: [
    ["/hospital/dashboard", "Dhaka Central Medical Hospital"],
    ["/hospital/records", "Patient and Invoice Records"],
    ["/hospital/claims", "Claim Verification Requests"],
  ],
  bank: [["/bank/dashboard", "Bangladesh Demo Commercial Bank"]],
};

const workspaceRoots = ["/user/dashboard", "/admin/dashboard", "/auditor/dashboard", "/hospital/dashboard", "/bank/dashboard"];

test.describe("@smoke complete route inventory", () => {
  test("public catalog, policy detail, login alias, and not-found routes render", async ({ page }) => {
    const serverErrors = [];
    page.on("response", (response) => {
      if (response.url().includes("/api/") && response.status() >= 500) {
        serverErrors.push(`${response.status()} ${response.url()}`);
      }
    });

    for (const [route, heading] of [
      ["/", "Insurance decisions that leave an evidence trail."],
      ["/login", "Insurance decisions that leave an evidence trail."],
      ["/policies", "Policy Catalog"],
      ["/policies/1", "Policy Schedule"],
      ["/definitely-not-a-route", "Page not found"],
    ]) {
      await page.goto(route);
      await expect(page.getByRole("heading", { name: heading })).toBeVisible();
    }

    expect(serverErrors).toEqual([]);
  });

  for (const [actorName, routes] of Object.entries(roleRoutes)) {
    test(`${actorName} can render every top-level workspace route without server errors`, async ({ browser }) => {
      const session = await createActorContext(browser, actorName);
      const serverErrors = [];
      const pageErrors = [];
      session.page.on("response", (response) => {
        if (response.url().includes("/api/") && response.status() >= 500) {
          serverErrors.push(`${response.status()} ${response.url()}`);
        }
      });
      session.page.on("pageerror", (error) => pageErrors.push(error.message));

      try {
        await loginActor(session.page, session.actor);
        for (const [route, heading] of routes) {
          await session.page.goto(route);
          await expect(session.page.getByRole("heading", { name: heading })).toBeVisible();
        }

        for (const foreignRoot of workspaceRoots.filter((route) => route !== session.actor.home)) {
          await session.page.goto(foreignRoot);
          await expect(session.page).toHaveURL(new RegExp(`${session.actor.home.replaceAll("/", "\\/")}$`));
        }

        expect(serverErrors).toEqual([]);
        expect(pageErrors).toEqual([]);
      } finally {
        await closeActor(session);
      }
    });
  }
});
