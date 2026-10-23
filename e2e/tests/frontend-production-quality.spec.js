const { test, expect } = require("@playwright/test");

const viewports = [
  { name: "mobile", width: 360, height: 800 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "laptop", width: 1366, height: 768 },
  { name: "desktop", width: 1920, height: 1080 },
];

function monitorPage(page) {
  const failures = [];
  page.on("pageerror", (error) => failures.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") failures.push(`console: ${message.text()}`);
  });
  page.on("requestfailed", (request) => {
    if (new URL(request.url()).origin === "http://127.0.0.1:4173") {
      failures.push(`requestfailed: ${request.method()} ${request.url()}`);
    }
  });
  page.on("response", (response) => {
    if (
      new URL(response.url()).origin === "http://127.0.0.1:4173" &&
      response.status() >= 500
    ) {
      failures.push(`response: ${response.status()} ${response.url()}`);
    }
  });
  return failures;
}

async function expectAccessibleDocument(page) {
  await expect(page.locator("main#main-content")).toHaveCount(1);
  await expect(page.getByRole("navigation", { name: "Primary navigation" })).toBeVisible();
  await expect(page.locator("h1")).toHaveCount(1);
  expect(await page.locator("[id]").evaluateAll((nodes) => {
    const ids = nodes.map((node) => node.id).filter(Boolean);
    return ids.length - new Set(ids).size;
  })).toBe(0);
  expect(await page.getByRole("button").evaluateAll((buttons) =>
    buttons.filter((button) => !(button.getAttribute("aria-label") || button.textContent.trim())).length
  )).toBe(0);
}

test.describe("@frontend-production public quality", () => {
  for (const viewport of viewports) {
    test(`${viewport.name} landing page is responsive and free of browser failures`, async ({ browser }, testInfo) => {
      const page = await browser.newPage({ viewport });
      const failures = monitorPage(page);
      const startedAt = Date.now();
      await page.goto("/", { waitUntil: "networkidle" });
      const durationMs = Date.now() - startedAt;

      await expect(page.getByRole("heading", {
        name: "Insurance decisions that leave an evidence trail.",
      })).toBeVisible();
      await expect(page.getByLabel("Local protocol status")).toContainText("Hardhat 31337");
      await expect(page.getByRole("link", { name: "Block-Insure home" }).first()).toBeVisible();
      await expectAccessibleDocument(page);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
      expect(await page.locator(".app-shell").evaluate((element) =>
        getComputedStyle(element).overflowX
      )).toBe("clip");
      expect(durationMs).toBeLessThan(5_000);
      expect(failures).toEqual([]);

      await testInfo.attach(`${viewport.name}-metrics.json`, {
        body: Buffer.from(JSON.stringify({ viewport, durationMs }, null, 2)),
        contentType: "application/json",
      });
      await testInfo.attach(`${viewport.name}-landing.png`, {
        body: await page.screenshot({ fullPage: true }),
        contentType: "image/png",
      });
      await page.close();
    });
  }

  test("login alias, refresh, not-found route, skip link, and focus indicator work", async ({ page }) => {
    const failures = monitorPage(page);
    await page.goto("/login", { waitUntil: "networkidle" });
    await expect(page.getByRole("heading", {
      name: "Insurance decisions that leave an evidence trail.",
    })).toBeVisible();
    await page.reload({ waitUntil: "networkidle" });

    await page.keyboard.press("Tab");
    const skipLink = page.getByRole("link", { name: "Skip to main content" });
    await expect(skipLink).toBeFocused();
    expect(await skipLink.evaluate((element) => getComputedStyle(element).outlineStyle)).not.toBe("none");
    await page.keyboard.press("Enter");
    await expect(page.locator("main#main-content")).toBeFocused();

    await page.goto("/definitely-not-a-route", { waitUntil: "networkidle" });
    await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
    await expectAccessibleDocument(page);
    expect(failures).toEqual([]);
  });

  test("theme toggle switches between Spruce Noir dark mode and Norway Sage light mode with persistence", async ({ page }) => {
    const failures = monitorPage(page);
    await page.goto("/", { waitUntil: "networkidle" });

    // Initial state: dark mode default
    const htmlTheme = await page.evaluate(() => ({
      classList: Array.from(document.documentElement.classList),
      dataTheme: document.documentElement.getAttribute("data-theme"),
    }));
    expect(htmlTheme.classList).toContain("dark");
    expect(htmlTheme.dataTheme).toBe("dark");

    const toggleBtn = page.getByRole("button", { name: /switch to light mode/i });
    await expect(toggleBtn).toBeVisible();

    // Switch to light mode
    await toggleBtn.click();
    const lightTheme = await page.evaluate(() => ({
      classList: Array.from(document.documentElement.classList),
      dataTheme: document.documentElement.getAttribute("data-theme"),
      savedTheme: localStorage.getItem("block-insure-theme"),
    }));
    expect(lightTheme.classList).not.toContain("dark");
    expect(lightTheme.dataTheme).toBe("light");
    expect(lightTheme.savedTheme).toBe("light");

    // Check that button aria-label changed to "Switch to dark mode"
    const toggleToDarkBtn = page.getByRole("button", { name: /switch to dark mode/i });
    await expect(toggleToDarkBtn).toBeVisible();

    // Reload page to verify persistence
    await page.reload({ waitUntil: "networkidle" });
    const persistedLightTheme = await page.evaluate(() => ({
      classList: Array.from(document.documentElement.classList),
      dataTheme: document.documentElement.getAttribute("data-theme"),
    }));
    expect(persistedLightTheme.classList).not.toContain("dark");
    expect(persistedLightTheme.dataTheme).toBe("light");

    // Switch back to dark mode
    await page.getByRole("button", { name: /switch to dark mode/i }).click();
    const backToDark = await page.evaluate(() => ({
      classList: Array.from(document.documentElement.classList),
      dataTheme: document.documentElement.getAttribute("data-theme"),
      savedTheme: localStorage.getItem("block-insure-theme"),
    }));
    expect(backToDark.classList).toContain("dark");
    expect(backToDark.dataTheme).toBe("dark");
    expect(backToDark.savedTheme).toBe("dark");

    expect(failures).toEqual([]);
  });
});
