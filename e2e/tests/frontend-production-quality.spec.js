const { test, expect } = require("@playwright/test");

for (const scenario of [
  { role: "USER", route: "/user/claims/new", fields: [["Claim amount in ETH", "0.00002"]] },
  { role: "ADMIN", route: "/admin/policy-packages/new", fields: [
    ["Premium amount in ETH", "0.000001"], ["Coverage amount in ETH", "0.0001"],
    ["Deductible cap (ETH)", "0.000002"], ["Maximum claim (ETH)", "0.0001"],
  ] },
]) {
  test(`compact amounts remain valid in ${scenario.route}`, async ({ page }) => {
    // Native browser validation against the built UI; synthetic API session
    // fixtures isolate this regression from wallet/RPC integration acceptance.
    const walletAddress = "0x6575cbc8b95abc6ab6628e7aec176af5769580f9";
    const user = { role: scenario.role, walletAddress };
    await page.addInitScript(({ user }) => {
      localStorage.setItem("blockinsure_wallet", user.walletAddress);
      localStorage.setItem("blockinsure_user", JSON.stringify(user));
      localStorage.setItem("blockinsure_jwt", "synthetic-ui-test");
      window.ethereum = {
        request: async ({ method }) => {
          if (["eth_accounts", "eth_requestAccounts"].includes(method)) return [user.walletAddress];
          if (method === "eth_chainId") return "0x7a69";
          throw new Error("This UI fixture does not authorize wallet writes");
        },
        on() {}, removeListener() {},
      };
    }, { user });
    await page.route("**/api/**", (route) => route.fulfill({ json: {
      success: true, user, policies: [], hospitals: [], packages: [],
      attempts: [], pendingAttempts: [], limit: { remaining: 5 },
    } }));
    await page.goto(scenario.route);
    for (const [label, value] of scenario.fields) {
      const input = page.getByLabel(label, { exact: true });
      await input.fill(value);
      expect(await input.evaluate((element) => element.validity.valid)).toBe(true);
      await input.fill("-0.000001");
      expect(await input.evaluate((element) => element.validity.valid)).toBe(false);
    }
  });
}

test("hospital form accepts compact ETH invoices and blocks zero or negative amounts", async ({ page }) => {
  // UI regression against a real production build; API fixtures isolate native
  // form validation. This is separate from hosted hospital/contract acceptance.
  await page.addInitScript(() => sessionStorage.setItem("blockinsure_hospital_session", "synthetic-ui-test"));
  let submitted;
  await page.route("**/api/**", async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === "/api/hospital-staff/session") return route.fulfill({ json: {
      success: true, staff: { displayName: "Synthetic staff", hospitalId: "HOSP-001" },
    } });
    if (pathname === "/api/hospitals/records" && route.request().method() === "POST") {
      submitted = route.request().postDataJSON();
      return route.fulfill({ status: 201, json: { success: true, message: "Synthetic UI fixture accepted" } });
    }
    if (pathname === "/api/hospitals/records") return route.fulfill({ json: { success: true, records: [] } });
    return route.fulfill({ json: { success: true, count: 0, packages: [] } });
  });
  await page.goto("/hospital/records");
  await page.getByLabel(/Patient reference/).fill("SYNTHETIC-COMPACT");
  await page.getByLabel("Invoice number", { exact: true }).fill("UI-COMPACT-001");
  await page.getByLabel(/Authorized claimant wallets/).fill("0x6575cBC8B95aBc6aB6628e7AeC176aF5769580F9");
  await page.getByLabel("Diagnosis code", { exact: true }).fill("GEN-001");
  for (const label of ["Admission date", "Discharge date", "Invoice date"]) await page.getByLabel(label, { exact: true }).fill("2026-11-02");
  const amount = page.getByLabel("Bill amount (ETH)", { exact: true });
  for (const invalid of ["0", "-0.00002"]) {
    await amount.fill(invalid);
    await page.getByRole("button", { name: "Create hospital record", exact: true }).click();
    expect(await amount.evaluate((input) => input.validity.valid)).toBe(false);
    expect(submitted).toBeUndefined();
  }
  for (const valid of ["0.000000000000000001", "0.00002", "0.1"]) {
    await amount.fill(valid);
    expect(await amount.evaluate((input) => input.validity.valid)).toBe(true);
  }
  await amount.fill("0.00002");
  await page.getByRole("button", { name: "Create hospital record", exact: true }).click();
  await expect.poll(() => submitted?.billAmount).toBe("0.00002");
});

test("built release metadata exposes only the allowlisted public deployment configuration", async ({ request }) => {
  const response = await request.get("/release-config.json");
  expect(response.ok()).toBe(true);
  const body = await response.json();
  expect(Object.keys(body).sort()).toEqual(["schema", "chainId", "apiOrigin", "managerAddress", "economicsAddress", "evidenceRegistryAddress", "benefitsAddress"].sort());
  expect(body.schema).toBe("block-insure-public-release-v1");
  expect(Number.isSafeInteger(Number(body.chainId))).toBe(true);
});

const viewports = [
  { name: "minimum mobile", width: 320, height: 800 },
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
      const pdfRequests = [];
      page.on("request", (request) => { if (/pdf-preview|pdf\.worker/.test(request.url())) pdfRequests.push(request.url()); });
      const startedAt = Date.now();
      await page.goto("/", { waitUntil: "networkidle" });
      const durationMs = Date.now() - startedAt;

      await expect(page.getByRole("heading", {
        name: "Insurance decisions that leave an evidence trail.",
      })).toBeVisible();
      await expect(page.getByLabel("Configured network")).toContainText("Hardhat 31337");
      await expect(page.getByRole("link", { name: "Block-Insure home" }).first()).toBeVisible();
      await expectAccessibleDocument(page);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
      expect(await page.locator(".app-shell").evaluate((element) =>
        getComputedStyle(element).overflowX
      )).toBe("clip");
      expect(durationMs).toBeLessThan(5_000);
      expect(failures).toEqual([]);
      expect(pdfRequests, "PDF rendering must stay out of the initial homepage load").toEqual([]);

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
