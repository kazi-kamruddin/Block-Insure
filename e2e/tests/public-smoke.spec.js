const { test, expect } = require("@playwright/test");
const { getE2EConfig } = require("../support/environment");

test.describe("@smoke public application", () => {
  test("landing page and backend health are available", async ({ page, request }) => {
    const environment = getE2EConfig();

    const healthResponse = await request.get(`${environment.apiUrl}/health/ready`);
    expect(healthResponse.ok()).toBeTruthy();
    const health = await healthResponse.json();
    expect(health).toMatchObject({
      success: true,
      status: "ready",
      message: "Backend is ready",
      services: {
        database: "connected",
        blockchainRpc: "connected",
        contract: "deployed",
        chainId: 31337,
        expectedChainId: 31337,
      },
    });

    await page.goto("/");
    await expect(
      page.getByRole("heading", {
        name: "Insurance decisions that leave an evidence trail.",
      })
    ).toBeVisible();
    await expect(page.getByRole("button", { name: /connect wallet/i }).first()).toBeVisible();
    await expect(page.getByText("Role-isolated workspaces")).toBeVisible();

    await page.getByRole("link", { name: "Policies", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Policy Catalog" })).toBeVisible();
    await page.getByRole("link", { name: "View Full Policy" }).first().click();
    await expect(page.getByText("Full digital policy document")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Coverage and Waiting Periods" })).toBeVisible();
    await expect(page.getByText("Browse the complete policy text")).toBeVisible();
  });
});
