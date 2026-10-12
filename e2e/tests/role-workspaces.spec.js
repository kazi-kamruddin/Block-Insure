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

  test("Hospital signs in to an independently scoped provider workspace", async ({ browser }) => {
    const session = await createActorContext(browser, "hospital");
    try {
      await loginActor(session.page, session.actor);
      await expect(
        session.page.getByRole("heading", { name: "Dhaka Central Medical Hospital" })
      ).toBeVisible();
      await expect(
        session.page.getByRole("navigation", { name: "Hospital navigation" })
      ).toBeVisible();
      await expect(session.page.getByText("Independent hospital verification active")).toBeVisible();
      await expect(session.page.getByText("HOSP-001", { exact: true })).toBeVisible();
      await expect(session.page.getByText("INV-HOSP-001-001", { exact: true })).toBeVisible();

      await session.page.goto("/hospital/records");
      await expect(session.page.getByRole("heading", { name: "Patient and Invoice Records" })).toBeVisible();
      await session.page.goto("/hospital/claims");
      await expect(session.page.getByRole("heading", { name: "Claim Verification Requests" })).toBeVisible();

      await session.page.goto("/admin/dashboard");
      await expect(session.page).toHaveURL(/\/hospital\/dashboard$/);
    } finally {
      await closeActor(session);
    }
  });

  test("Bank signs in to an independently scoped account workspace", async ({ browser }) => {
    const session = await createActorContext(browser, "bank");
    try {
      await loginActor(session.page, session.actor);
      await expect(
        session.page.getByRole("heading", { name: "Bangladesh Demo Commercial Bank" })
      ).toBeVisible();
      await expect(
        session.page.getByRole("navigation", { name: "Bank navigation" })
      ).toBeVisible();
      await expect(session.page.getByText("Quarterly bank automation active")).toBeVisible();
      await expect(session.page.getByText("BANK-001", { exact: true })).toBeVisible();
      const accountRows = session.page.locator(".bank-accounts-card tbody tr");
      await expect(accountRows).toHaveCount(3);
      for (const accountReference of ["DEMO-5000", "DEMO-7000", "DEMO-10000"]) {
        const accountRow = accountRows.filter({ hasText: accountReference });
        await expect(accountRow).toContainText("ACTIVE");
        await expect(accountRow.locator("td").nth(3)).toHaveText(/^\d[\d,]*\.\d{2} BDT$/);
      }

      await session.page.goto("/admin/dashboard");
      await expect(session.page).toHaveURL(/\/bank\/dashboard$/);
    } finally {
      await closeActor(session);
    }
  });

  test("Auditor tools load and privileged route isolation is enforced", async ({ browser }) => {
    const session = await createActorContext(browser, "auditor1");
    try {
      await loginActor(session.page, session.actor);

      await session.page.goto("/auditor/healthcare-registry");
      await expect(
        session.page.getByRole("heading", { name: "Hybrid External Registry" })
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
