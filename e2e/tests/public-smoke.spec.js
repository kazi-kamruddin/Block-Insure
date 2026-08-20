const { test, expect } = require("@playwright/test");
const { getE2EConfig } = require("../support/environment");

test.describe("@smoke public application", () => {
  test("landing page and backend health are available", async ({ page, request }) => {
    const environment = getE2EConfig();

    const healthResponse = await request.get(`${environment.apiUrl}/health`);
    expect(healthResponse.ok()).toBeTruthy();
    const health = await healthResponse.json();
    expect(health).toMatchObject({
      success: true,
      message: "Backend is healthy",
      services: {
        database: "connected",
        blockchainRpc: "configured",
        contract: "configured",
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
  });
});
