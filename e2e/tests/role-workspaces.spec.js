const { test, expect } = require("@playwright/test");
const { loginActor } = require("../support/actions");
const { closeActor, createActorContext } = require("../support/walletBridge");

test.describe("@smoke role workspaces", () => {
  test("User signs in, sees policyholder pages, and cannot enter Admin", async ({ browser }) => {
    const session = await createActorContext(browser, "user");
    try {
      await loginActor(session.page, session.actor);
      await expect(
        session.page.getByRole("heading", { name: "Coverage and claims overview" })
      ).toBeVisible();
      await expect(
        session.page.getByRole("navigation", { name: "Policyholder navigation" })
      ).toBeVisible();

      await session.page.goto("/user/policies/buy");
      await expect(session.page.getByRole("heading", { name: "Buy Policy" })).toBeVisible();

      await session.page.goto("/admin/dashboard");
      await expect(session.page).toHaveURL(/\/user\/dashboard$/);
    } finally {
      await closeActor(session);
    }
  });

  test("Admin signs in and role synchronization is healthy", async ({ browser }) => {
    const session = await createActorContext(browser, "admin");
    try {
      await loginActor(session.page, session.actor);
      await expect(
        session.page.getByRole("heading", { name: "Portfolio oversight" })
      ).toBeVisible();
      await expect(
        session.page.getByRole("navigation", { name: "Administration navigation" })
      ).toBeVisible();

      await session.page.goto("/admin/role-health");
      await expect(session.page.getByRole("heading", { name: "Role Sync Health" })).toBeVisible();
      await expect(session.page.getByText("Status: Healthy")).toBeVisible();
      await expect(session.page.getByText("Mismatches: 0")).toBeVisible();

      await session.page.goto("/admin/policy-packages");
      await expect(
        session.page.getByRole("heading", { name: "Admin Policy Packages" })
      ).toBeVisible();

      await session.page.goto("/user/dashboard");
      await expect(session.page).toHaveURL(/\/admin\/dashboard$/);
    } finally {
      await closeActor(session);
    }
  });

  test("all four Auditor wallets sign in with the Auditor role", async ({ browser }) => {
    for (const actorName of ["auditor1", "auditor2", "auditor3", "auditor4"]) {
      const session = await createActorContext(browser, actorName);
      try {
        await loginActor(session.page, session.actor);
        await expect(
          session.page.getByRole("heading", { name: "Claim audit and evidence review" })
        ).toBeVisible();
        await expect(
          session.page.getByRole("navigation", { name: "Auditor navigation" })
        ).toBeVisible();
      } finally {
        await closeActor(session);
      }
    }
  });

  test("Auditor tools load and privileged route isolation is enforced", async ({ browser }) => {
    const session = await createActorContext(browser, "auditor1");
    try {
      await loginActor(session.page, session.actor);

      await session.page.goto("/auditor/healthcare-registry");
      await expect(
        session.page.getByRole("heading", { name: "Synthetic External Registry" })
      ).toBeVisible();
      await expect(session.page.getByText("Auditor registry view")).toBeVisible();

      await session.page.goto("/auditor/votes");
      await expect(session.page.getByRole("heading", { name: "Voting Queue" })).toBeVisible();

      await session.page.goto("/auditor/verify-document");
      await expect(
        session.page.getByRole("heading", { name: "Document Integrity Verification" })
      ).toBeVisible();
      await expect(session.page.getByRole("button", { name: "Verify Integrity" })).toBeVisible();

      await session.page.goto("/admin/dashboard");
      await expect(session.page).toHaveURL(/\/auditor\/dashboard$/);
    } finally {
      await closeActor(session);
    }
  });
});
