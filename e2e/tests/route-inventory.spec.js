const { test, expect } = require("@playwright/test");
const { loginActor } = require("../support/actions");
const { closeActor, createActorContext } = require("../support/walletBridge");

const roleRoutes = {
  user: [
    ["/user/profile", "My profile"],
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
    for (const width of [1366, 320]) {
      test(`${actorName} can render every top-level workspace route without server errors at ${width}px`, async ({ browser }, testInfo) => {
        const session = await createActorContext(browser, actorName, { viewport: { width, height: 900 } });
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
            await expect(session.page.getByRole("heading", { name: heading })).toBeInViewport();
            expect(await session.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${route} must fit ${width}px`).toBe(true);
            if (actorName === "bank" && width === 320) {
              const date = await session.page.getByLabel("Automation reference date").boundingBox();
              const scan = await session.page.getByRole("button", { name: "Run reminder and debit scan" }).boundingBox();
              expect(scan.y).toBeGreaterThanOrEqual(date.y + date.height);
              expect(scan.width).toBeGreaterThanOrEqual(160);
              expect(scan.height).toBeGreaterThanOrEqual(44);
              expect(scan.height).toBeLessThanOrEqual(88);
            }
            await testInfo.attach(`${actorName}-${width}-${route.split("/").filter(Boolean).join("-")}.png`, {
              body: await session.page.screenshot({ fullPage: true, animations: "disabled" }), contentType: "image/png",
            });
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
  }
});
