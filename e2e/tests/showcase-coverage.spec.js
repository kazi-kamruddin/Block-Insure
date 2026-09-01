const { test, expect } = require("@playwright/test");
const { loginActor } = require("../support/actions");
const { closeActor, createActorContext } = require("../support/walletBridge");

test.describe("@showcase expanded supervisor demonstration coverage", () => {
  test.describe.configure({ mode: "serial" });

  test("Policyholder can inspect pricing, policy benefits, settled claims, and notifications", async ({ browser }) => {
    const session = await createActorContext(browser, "user");
    try {
      await loginActor(session.page, session.actor);
      await expect(
        session.page.getByRole("heading", { name: "Coverage and claims overview" })
      ).toBeVisible();
      await expect(session.page.getByRole("heading", { name: "Purchased Policies" })).toBeVisible();
      await expect(session.page.getByRole("heading", { name: "Total Claims" })).toBeVisible();

      await session.page.goto("/user/policies/buy");
      await expect(session.page.getByRole("heading", { name: "Buy Policy" })).toBeVisible();
      await expect(
        session.page.getByRole("heading", { name: "Premium Simulation — Not Applied at Checkout" })
      ).toBeVisible();
      await expect(
        session.page.getByRole("heading", { name: "Historical Policy Scenario Simulator" })
      ).toBeVisible();
      await session.page.getByLabel("Synthetic case").selectOption({
        label: "Emergency appendicitis after waiting period",
      });
      await session.page.getByRole("button", { name: "Evaluate Scenario" }).click();
      await expect(session.page.getByRole("heading", { name: "Scenario outcome" })).toBeVisible();
      await expect(session.page.getByText("Estimated benefit:")).toBeVisible();

      await session.page.goto("/user/policies");
      await expect(session.page.getByRole("heading", { name: "My Policies" })).toBeVisible();
      const policyCards = session.page.locator(".policy-lifecycle-card");
      await expect(policyCards.first()).toBeVisible();
      expect(await policyCards.count()).toBeGreaterThanOrEqual(2);
      const firstPolicyText = await policyCards.first().textContent();
      const policyId = firstPolicyText?.match(/Policy #(\d+)/)?.[1];
      expect(policyId, "A purchased policy ID should be visible").toBeTruthy();
      await policyCards.first().getByText("Beneficiaries and additional benefits").click();
      await expect(policyCards.first().getByRole("heading", { name: "Current beneficiaries" })).toBeVisible();
      await expect(policyCards.first().getByRole("button", { name: "Download Policy Terms" })).toBeVisible();

      await session.page.goto("/user/claims");
      await expect(session.page.getByRole("heading", { name: "My Claims" })).toBeVisible();
      const claimCards = session.page.locator(".claim-summary-card");
      await expect(claimCards.first()).toBeVisible();
      expect(await claimCards.count()).toBeGreaterThanOrEqual(2);
      await claimCards.first().getByRole("link", { name: "Open Claim" }).click();
      await expect(session.page.getByRole("heading", { name: "Claim Detail" })).toBeVisible();
      await expect(session.page.locator(".status-badge", { hasText: "SETTLED" }).first()).toBeVisible();
      await expect(session.page.getByRole("heading", { name: "Evidence", exact: true })).toBeVisible();
      await expect(session.page.getByRole("heading", { name: "Oracle Results" })).toBeVisible();

      await session.page.goto("/user/benefits");
      await expect(
        session.page.getByRole("heading", { name: "Beneficiary Benefit Request" })
      ).toBeVisible();
      await session.page.getByLabel("Policy ID").fill(policyId);
      await session.page.getByRole("button", { name: "Check Beneficiary Access" }).click();
      await expect(session.page.getByText(`Policy #${policyId}`, { exact: true })).toBeVisible();
      await expect(session.page.getByRole("button", { name: "Download Terms" })).toBeVisible();

      await session.page.goto("/user/notifications");
      await expect(session.page.getByRole("heading", { name: "Notifications" })).toBeVisible();
      await expect(session.page.getByRole("button", { name: /Show Unread Only|Showing Unread/ })).toBeVisible();
      await expect(session.page.locator(".notification-item").first()).toBeVisible();

      await session.page.goto("/user/claims/new");
      await expect(session.page.getByRole("heading", { name: "Submit Claim" })).toBeVisible();
      await expect(session.page.getByRole("heading", { name: "Document Privacy" })).toBeVisible();
      await expect(session.page.getByLabel("Test data preset")).toBeVisible();
    } finally {
      await closeActor(session);
    }
  });

  test("Admin can operate package lifecycle and inspect protocol health and research views", async ({ browser }) => {
    const session = await createActorContext(browser, "admin");
    const packagePrefix = "Supervisor Demo Health";
    try {
      await loginActor(session.page, session.actor);
      await expect(session.page.getByRole("heading", { name: "Portfolio oversight" })).toBeVisible();
      for (const heading of [
        "Contract Reserve",
        "Open Exposure",
        "Premium Collected",
        "Settlements Paid",
        "Role Sync",
        "Oracle Health",
        "Oracle Identity and Independence",
      ]) {
        await expect(session.page.getByRole("heading", { name: heading })).toBeVisible();
      }

      await session.page.goto("/admin/policy-packages");
      await expect(session.page.getByRole("heading", { name: "Admin Policy Packages" })).toBeVisible();
      await expect(session.page.locator(".card").first()).toBeVisible();
      let createdPackage = session.page.locator(".card", { hasText: packagePrefix }).first();
      if ((await createdPackage.count()) === 0) {
        await session.page.goto("/admin/policy-packages/new");
        await expect(session.page.getByRole("heading", { name: "Create Policy Package" })).toBeVisible();
        await session.page.getByLabel("Quick preset").selectOption({ label: "Health Plus" });
        await session.page.getByLabel("Package name").fill(`${packagePrefix} ${Date.now()}`);
        await session.page.getByRole("button", { name: "Create Package" }).click();
        await expect(session.page.locator(".success-text")).toContainText(
          "Policy package created successfully"
        );
        await session.page.goto("/admin/policy-packages");
        createdPackage = session.page.locator(".card", { hasText: packagePrefix }).first();
      }
      await expect(createdPackage).toBeVisible();
      await expect(createdPackage).toContainText("Active: true");

      await session.page.goto("/admin/benefits");
      await expect(
        session.page.getByRole("heading", { name: "Policy Benefits Administration" })
      ).toBeVisible();
      await expect(session.page.getByRole("heading", { name: "Publish Benefit Schedule" })).toBeVisible();
      await expect(session.page.getByRole("heading", { name: "Benefit Requests" })).toBeVisible();

      await session.page.goto("/admin/healthcare-registry");
      await expect(session.page.getByRole("heading", { name: "Hybrid External Registry" })).toBeVisible();
      await expect(session.page.getByText("Admin registry view")).toBeVisible();
      await expect(session.page.getByText("Roots Match", { exact: true })).toBeVisible();
      const invoiceHash = (await session.page.locator(".registry-hash").first().textContent())?.trim();
      expect(invoiceHash, "The registry should expose an invoice hash").toMatch(/^0x[0-9a-f]{64}$/i);
      await session.page.getByLabel("Invoice hash").fill(invoiceHash);
      await session.page.getByRole("button", { name: "Verify Proof" }).click();
      await expect(
        session.page.locator(".registry-commitment-grid").getByText("Valid", { exact: true })
      ).toBeVisible();

      await session.page.goto("/admin/role-health");
      await expect(session.page.getByRole("heading", { name: "Role Sync Health" })).toBeVisible();
      await expect(session.page.getByText("Status: Healthy")).toBeVisible();
      await expect(session.page.getByText("Mismatches: 0")).toBeVisible();
      expect(await session.page.locator("tbody tr").count()).toBeGreaterThanOrEqual(7);

      await session.page.goto("/admin/audit-actions");
      await expect(session.page.getByRole("heading", { name: "Admin Action Audit" })).toBeVisible();
      await expect(session.page.getByRole("heading", { name: "Logs" })).toBeVisible();
      await expect(session.page.getByText(/^[1-9]\d* matching actions$/)).toBeVisible();
      await expect(session.page.locator("tbody tr").first()).toBeVisible();

      await session.page.goto("/admin/claims");
      await expect(session.page.getByRole("heading", { name: "Admin Claims" })).toBeVisible();
      await session.page.getByRole("link", { name: "Review Claim" }).first().click();
      await expect(session.page.getByRole("heading", { name: "Admin Claim Detail" })).toBeVisible();
      await expect(session.page.getByRole("heading", { name: "On-Chain Settlement Breakdown" })).toBeVisible();
      await expect(session.page.getByText(/Approval, rejection, payout allocation/)).toBeVisible();
      await expect(session.page.getByRole("button", { name: /Approve Claim|Reject Claim|Settle Claim/ })).toHaveCount(0);

      await session.page.goto("/admin/thesis-dashboard");
      await expect(session.page.getByRole("heading", { name: "Thesis Results Dashboard" })).toBeVisible();
      for (const heading of [
        "Defense Mode Summary",
        "Reserve Adequacy Simulation",
        "Confidential Evidence Lifecycle",
        "Hybrid Real + Controlled Evaluation",
        "Fraud Decision Support",
        "Claim Throughput and Latency",
        "Auditor Reputation Validation",
        "Gas Cost Comparison",
        "Oracle Performance",
        "Reserve Health",
        "Registry Merkle Commitment",
      ]) {
        await expect(session.page.getByRole("heading", { name: heading })).toBeVisible();
      }
      await expect(session.page.getByText("Root stored on-chain")).toBeVisible();
    } finally {
      await closeActor(session);
    }
  });

  test("Auditor can inspect claim timelines, export history, verify integrity, and registry state", async ({ browser }) => {
    const session = await createActorContext(browser, "auditor1");
    try {
      await loginActor(session.page, session.actor);
      await expect(
        session.page.getByRole("heading", { name: "Claim audit and evidence review" })
      ).toBeVisible();
      await expect(session.page.getByRole("heading", { name: "Claim Timeline Audit" })).toBeVisible();
      await expect(session.page.getByRole("heading", { name: "Document Integrity" })).toBeVisible();
      await expect(session.page.getByRole("heading", { name: "Weighted Voting" })).toBeVisible();

      await session.page.goto("/auditor/claims");
      await expect(session.page.getByRole("heading", { name: "Claim Audit Timelines" })).toBeVisible();
      const assignedClaimCard = session.page.locator(".auditor-claim-card", {
        hasText: "HOSP-NOT-REGISTERED",
      });
      const assignedTimelineLink = assignedClaimCard.getByRole("link", {
        name: "View Audit Timeline",
      });
      await expect(assignedTimelineLink).toBeVisible();
      const timelineHref = await assignedTimelineLink.getAttribute("href");
      const claimId = timelineHref?.match(/claims\/(\d+)\/history/)?.[1];
      expect(claimId, "A claim ID should be present in the timeline link").toBeTruthy();
      await assignedTimelineLink.click();
      await expect(session.page.getByRole("heading", { name: "Auditor Claim History" })).toBeVisible();
      await expect(session.page.getByRole("heading", { name: "Evidence Hash Chain" })).toBeVisible();
      await expect(session.page.getByRole("heading", { name: "Oracle Registry Comparison" })).toBeVisible();
      const downloadPromise = session.page.waitForEvent("download");
      await session.page.getByRole("button", { name: "Export JSON" }).click();
      const download = await downloadPromise;
      expect(await download.suggestedFilename()).toMatch(/claim.*\.json$/i);

      await session.page.goto("/auditor/verify-document");
      await expect(
        session.page.getByRole("heading", { name: "Document Integrity Verification" })
      ).toBeVisible();
      await session.page.getByLabel("Upload claim document").setInputFiles({
        name: "intentional-mismatch.txt",
        mimeType: "text/plain",
        buffer: Buffer.from("intentional mismatch used by the showcase integrity test"),
      });
      await session.page.getByLabel("Claim ID").fill(claimId);
      await session.page.getByRole("button", { name: "Verify Integrity" }).click();
      await expect(
        session.page.getByRole("heading", { name: "Hash Mismatch - Document May Have Been Tampered" })
      ).toBeVisible();

      await session.page.goto("/auditor/votes");
      await expect(session.page.getByRole("heading", { name: "Voting Queue" })).toBeVisible();
      await expect(session.page.getByRole("heading", { name: "No vote-ready claims" })).toBeVisible();

      await session.page.goto("/auditor/healthcare-registry");
      await expect(session.page.getByRole("heading", { name: "Hybrid External Registry" })).toBeVisible();
      await expect(session.page.getByText("Auditor registry view")).toBeVisible();
      await expect(session.page.getByText("Roots Match", { exact: true })).toBeVisible();
    } finally {
      await closeActor(session);
    }
  });

  test("Auditor reputation roster lists the four active on-chain auditors", async ({ browser }) => {
    const session = await createActorContext(browser, "auditor1");
    try {
      await loginActor(session.page, session.actor);
      await session.page.goto("/auditor/reputation");
      await expect(session.page.getByRole("heading", { name: "Auditor Reputation" })).toBeVisible();
      await expect(session.page.locator("tbody tr")).toHaveCount(4);
      await expect(session.page.locator(".reliability-pill")).toHaveCount(4);
    } finally {
      await closeActor(session);
    }
  });
});
