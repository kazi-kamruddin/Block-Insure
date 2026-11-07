const { test, expect } = require("@playwright/test");

for (const firstReadFails of [false, true]) test(`collapsed refund panels stop background polling and refresh when opened${firstReadFails ? " after provider failure" : ""}`, async ({ page }) => {
  const user = { role: "USER", walletAddress: "0x1111111111111111111111111111111111111111" };
  await page.clock.install();
  await page.addInitScript(({ user }) => {
    localStorage.setItem("blockinsure_wallet", user.walletAddress);
    localStorage.setItem("blockinsure_user", JSON.stringify(user));
    localStorage.setItem("blockinsure_jwt", "synthetic-ui-test");
    window.ethereum = { request: async ({ method }) => {
      if (["eth_accounts", "eth_requestAccounts"].includes(method)) return [user.walletAddress];
      if (method === "eth_chainId") return "0x7a69";
      throw Error("Read-only component fixture forbids wallet operations");
    }, on() {}, removeListener() {} };
  }, { user });
  let benefitReads = 0;
  const errors = []; page.on("pageerror", error => errors.push(error.message));
  await page.route("**/api/**", route => {
    if (route.request().url().includes("/api/policy-benefits/policies/")) {
      benefitReads++;
      if (firstReadFails && benefitReads === 1) return route.fulfill({ status: 503, json: { success: false, message: "Synthetic provider outage" } });
    }
    return route.fulfill({ json: { success: true, user,
      policies: [{ policyId: "1", packageName: "Synthetic health", status: { code: 4, label: "CANCELLED" },
        startDate: "1", endDate: "31536001", premiumInterval: "7776000", installmentsPaid: "1", coverageAmountEth: "0.0001", premiumAmountEth: "0.000001", totalPremiumPaidEth: "0.000001" }],
      terms: { configured: false, minimumSurrenderInstallments: 2 }, projections: { surrender: { eth: "0" } },
      requests: [], claimable: { wei: "0" },
    } });
  });
  await page.goto("/user/policies");
  const panel = page.locator(".policy-benefits-panel");
  await expect(panel.locator("summary")).toHaveText("Cancellation refund");
  expect(benefitReads).toBe(0);
  await page.clock.runFor(11000);
  expect(benefitReads).toBe(0);
  await panel.locator("summary").click();
  await expect.poll(() => benefitReads).toBe(1);
  if (firstReadFails) {
    await expect(panel.getByRole("alert")).toContainText("Refund schedule is unavailable");
    await panel.getByRole("button", { name: "Retry refund schedule", exact: true }).click();
    await expect.poll(() => benefitReads).toBe(2);
  }
  await expect(panel.getByText("This policy does not offer a cancellation refund.")).toBeVisible();
  await page.clock.runFor(5500);
  await expect.poll(() => benefitReads).toBe(firstReadFails ? 3 : 2);
  await panel.locator("summary").click();
  await expect(panel).not.toHaveAttribute("open");
  const closedCount = benefitReads;
  await page.clock.runFor(11000);
  expect(benefitReads).toBe(closedCount);
  await panel.locator("summary").click();
  await expect.poll(() => benefitReads).toBe(closedCount + 1);
  expect(errors).toEqual([]);
});

for (const [code, label, manual] of [[2, "FRAUD_FLAGGED", true], [5, "ORACLE_FAILED", true], [1, "DUPLICATE_CHECKED", false], [9, "SETTLED", false]]) {
  test(`admin manual-review action follows contract state ${label}`, async ({ page }) => {
    // Built component regression; no wallet writes or live API substitution.
    const user = { role: "ADMIN", walletAddress: "0xd388bb1572cdb7f7db2bb485a1051749f9b1ff1e" };
    const errors = []; page.on("pageerror", e => errors.push(e.message));
    await page.addInitScript(({ user }) => {
      localStorage.setItem("blockinsure_wallet", user.walletAddress);
      localStorage.setItem("blockinsure_user", JSON.stringify(user));
      localStorage.setItem("blockinsure_jwt", "synthetic-ui-test");
      window.ethereum = { request: async ({ method }) => {
        if (["eth_accounts", "eth_requestAccounts"].includes(method)) return [user.walletAddress];
        if (method === "eth_chainId") return "0x7a69";
        throw Error("Read-only component fixture forbids wallet operations");
      }, on() {}, removeListener() {} };
    }, { user });
    // Claim42 is synthetic, so its auxiliary contract reads must be synthetic
    // too. Do not send an inconsistent API fixture to a real local contract.
    const { ethers } = require("../../backEnd/node_modules/ethers");
    const interfaces = ["InsuranceManager", "OracleCoordinator", "ClaimAdjudicator", "PolicyEconomics"].map(name =>
      new ethers.Interface(require(`../../backEnd/abi/${name}.json`).abi));
    const empty = param => param.baseType === "array" ? [] : param.baseType === "tuple" ? param.components.map(empty) :
      param.type === "address" ? "0x1111111111111111111111111111111111111111" : param.type === "bool" ? false :
        param.type === "string" ? "" : param.type === "bytes" ? "0x" : /^bytes\d+$/.test(param.type) ? "0x" + "00".repeat(Number(param.type.slice(5))) : 0n;
    await page.route("**/*", async route => {
      const request = route.request(); let body;
      try { body = request.postDataJSON(); } catch { return route.fallback(); }
      if (!body || !(Array.isArray(body) ? body[0]?.jsonrpc : body.jsonrpc)) return route.fallback();
      const respond = item => {
        let result;
        if (item.method === "eth_chainId") result = "0x7a69";
        else if (["eth_getBalance", "eth_blockNumber"].includes(item.method)) result = "0x0";
        else if (item.method === "eth_getCode") result = "0x60006000";
        else if (item.method === "eth_call") {
          for (const iface of interfaces) {
            const fn = iface.getFunction(item.params[0].data.slice(0, 10));
            if (fn) { result = iface.encodeFunctionResult(fn, fn.outputs.map(empty)); break; }
          }
        }
        if (result === undefined) throw Error(`Unhandled read-only UI fixture RPC: ${item.method}`);
        return { jsonrpc: "2.0", id: item.id, result };
      };
      await route.fulfill({ headers: { "access-control-allow-origin": "*" }, json: Array.isArray(body) ? body.map(respond) : respond(body) });
    });
    await page.route("**/api/**", route => route.fulfill({ json: {
      success: true, user, logs: [], voteSummary: null, appeal: null,
      claim: { claimId: "42", policyId: "4", claimantWallet: "0x6575cbc8b95abc6ab6628e7aec176af5769580f9", claimAmountEth: "0.00002", claimType: "HOSPITALIZATION", hospitalId: "HOSP-001", status: { code, label } },
      evidenceChain: { documentCount: 0, documents: [], verified: false },
    } }));
    await page.goto("/admin/claims/42");
    await expect(page.locator(".admin-claim-sidebar")).toContainText(label);
    const action = page.getByRole("button", { name: "Send to Manual Review", exact: true });
    if (manual) await expect(action).toBeEnabled();
    else await expect(action).toHaveCount(0);
    expect(errors).toEqual([]);
  });
}

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
for (const legacyVerified of [false, true]) {
  test(`empty evidence is awaiting linkage even when verified=${legacyVerified}`, async ({ page }) => {
    const user = { role: "USER", walletAddress: "0x6575cbc8b95abc6ab6628e7aec176af5769580f9" };
    await page.addInitScript(({ user }) => {
      localStorage.setItem("blockinsure_wallet", user.walletAddress);
      localStorage.setItem("blockinsure_user", JSON.stringify(user));
      localStorage.setItem("blockinsure_jwt", "synthetic-ui-test");
      window.ethereum = { request: async ({ method }) => {
        if (["eth_accounts", "eth_requestAccounts"].includes(method)) return [user.walletAddress];
        if (method === "eth_chainId") return "0x7a69";
        throw Error("UI fixture forbids wallet operations");
      }, on() {}, removeListener() {} };
    }, { user });
    await page.route("**/api/**", route => route.fulfill({ json: {
      success: true, user, logs: [], appeal: null,
      claim: { claimId: "4", policyId: "3", claimantWallet: user.walletAddress, claimAmountEth: "0.00002", claimType: "HOSPITALIZATION", hospitalId: "HOSP-001", status: { code: 9, label: "SETTLED" } },
      evidenceChain: { documentCount: 0, documents: [], headHash: "", verified: legacyVerified },
    } }));
    await page.setViewportSize({ width: 320, height: 900 });
    await page.goto("/user/claims/4");
    const panel = page.locator(".evidence-chain-panel");
    await expect(panel.locator(".evidence-chain-status")).toHaveText("Awaiting evidence linkage");
    await expect(panel.locator(".is-verified")).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  });
}
