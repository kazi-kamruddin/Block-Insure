const crypto = require("node:crypto");
const { test, expect } = require("@playwright/test");
const { Contract } = require("../../backEnd/node_modules/ethers");
const { loginActor } = require("../support/actions");
const { createActorContext, closeActor } = require("../support/walletBridge");
const { getE2EConfig } = require("../support/environment");

test.describe("@workflow @phase1 coherent application foundation", () => {
  test("administrator provisions hospital staff; a browser without a wallet maintains and publishes scoped records", async ({ browser }, testInfo) => {
    const admin = await createActorContext(browser, "admin");
    const staffContext = await browser.newContext({ baseURL: getE2EConfig().appUrl, viewport: { width: 320, height: 780 } });
    const staff = await staffContext.newPage();
    const suffix = crypto.randomBytes(5).toString("hex");
    const username = `phase1.staff.${suffix}`;
    const password = `Synthetic-staff-${crypto.randomBytes(12).toString("hex")}`;
    try {
      await loginActor(admin.page, admin.actor);
      await admin.page.goto("/admin/hospital-staff");
      await admin.page.getByLabel("Hospital", { exact: true }).selectOption("HOSP-001");
      await admin.page.getByLabel("Staff display name").fill("Phase one hospital staff");
      await admin.page.getByLabel("Staff username").fill(username);
      await admin.page.getByLabel("Initial staff password").fill(password);
      await admin.page.getByRole("button", { name: "Create staff account" }).click();
      await expect(admin.page.getByRole("status")).toContainText("Staff access saved");
      const token = await admin.page.evaluate(() => localStorage.getItem("blockinsure_jwt"));
      const headers = { Authorization: `Bearer ${token}` };
      await staff.goto("/hospital/login");
      expect(await staff.evaluate(() => typeof window.ethereum)).toBe("undefined");
      await staff.getByLabel("Username", { exact: true }).fill(username);
      await staff.getByLabel("Password", { exact: true }).fill(password);
      await staff.getByRole("button", { name: "Sign in to hospital" }).click();
      await expect(staff).toHaveURL(/\/hospital\/dashboard$/);
      await expect(staff.getByRole("heading", { name: "Dhaka Central Medical Hospital" })).toBeVisible();
      await staff.reload();
      await expect(staff.getByRole("navigation", { name: "Hospital navigation" })).toBeVisible();
      await staff.goto("/hospital/records");
      const date = new Date(Number((await admin.provider.getBlock("latest")).timestamp) * 1000).toISOString().slice(0, 10);
      const invoice = `LOCAL-${suffix}`;
      await staff.getByLabel("Patient reference", { exact: false }).fill("PATIENT-LOCAL-001");
      await staff.getByLabel("Invoice number", { exact: true }).fill(invoice);
      await staff.getByLabel("Authorized claimant wallets", { exact: false }).fill(admin.wallet.address);
      await staff.getByLabel("Diagnosis code", { exact: true }).fill("DEMO");
      for (const name of ["Admission date", "Discharge date", "Invoice date"]) await staff.getByLabel(name, { exact: true }).fill(date);
      await staff.getByLabel("Bill amount (ETH)", { exact: true }).fill("0.1");
      await staff.getByRole("button", { name: "Create hospital record", exact: true }).click();
      const row = staff.locator("tbody tr").filter({ hasText: invoice });
      await expect(row).toBeVisible();
      await expect(row.getByText("Publication pending", { exact: true })).toHaveCount(0, { timeout: 90000 });
      expect(await staff.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      const staffToken = await staff.evaluate(() => sessionStorage.getItem("blockinsure_hospital_session"));
      const staffHeaders = { Authorization: `Bearer ${staffToken}` };
      const own = await (await staff.request.get(`${getE2EConfig().apiUrl}/api/hospitals/records`, { headers: staffHeaders })).json();
      const record = own.records.find((item) => item.invoiceNumber === invoice);
      expect(record.identityVersion).toBe(2);
      const staff2 = await admin.page.request.post(`${getE2EConfig().apiUrl}/api/hospital-staff/accounts`, { headers,
        data: { username: `${username}.second`, password, hospitalId: "HOSP-002", displayName: "Other hospital staff" } });
      expect(staff2.status()).toBe(201);
      const login2 = await (await staff.request.post(`${getE2EConfig().apiUrl}/api/hospital-staff/login`, {
        data: { username: `${username}.second`, password },
      })).json();
      const cross = await staff.request.patch(`${getE2EConfig().apiUrl}/api/hospitals/records/${record.id}`, {
        headers: { Authorization: `Bearer ${login2.token}` }, data: { billAmount: "0.3" },
      });
      expect(cross.status()).toBe(404);
      const sameLocalInvoice = await staff.request.post(`${getE2EConfig().apiUrl}/api/hospitals/records`, {
        headers: { Authorization: `Bearer ${login2.token}` }, data: {
          invoiceNumber: invoice, patientReference: "PATIENT-LOCAL-001", authorizedClaimants: admin.wallet.address,
          treatmentType: "HOSPITALIZATION", diagnosisCode: "DEMO", billAmount: "0.1", admissionDate: date, dischargeDate: date, invoiceDate: date,
        },
      });
      expect(sameLocalInvoice.status(), await sameLocalInvoice.text()).toBe(201);
      const otherRecord = (await sameLocalInvoice.json()).record;
      expect(otherRecord.invoiceHash).not.toBe(record.invoiceHash);
      expect(otherRecord.patientHash).not.toBe(record.patientHash);
      const loggedOut = await staff.request.post(`${getE2EConfig().apiUrl}/api/hospital-staff/logout`, { headers: { Authorization: `Bearer ${login2.token}` } });
      expect(loggedOut.ok()).toBe(true);
      expect((await staff.request.get(`${getE2EConfig().apiUrl}/api/hospitals/records`, { headers: { Authorization: `Bearer ${login2.token}` } })).status()).toBe(401);
      expect((await staff.request.get(`${getE2EConfig().apiUrl}/api/admin/role-sync-health`, { headers: staffHeaders })).status()).toBe(401);
      const insurer = await admin.page.request.get(`${getE2EConfig().apiUrl}/api/hospitals/insurer/records/HOSP-001`, { headers });
      expect(insurer.ok()).toBe(true);
      const accounts = await (await admin.page.request.get(`${getE2EConfig().apiUrl}/api/hospital-staff/accounts`, { headers })).json();
      const account = accounts.staff.find((item) => item.username === username);
      await testInfo.attach("hospital-no-wallet-320px.png", { body: await staff.screenshot({ fullPage: true }), contentType: "image/png" });
      const disabled = await admin.page.request.patch(`${getE2EConfig().apiUrl}/api/hospital-staff/accounts/${account.staffId}`, { headers, data: { active: false } });
      expect(disabled.ok()).toBe(true);
      expect((await staff.request.get(`${getE2EConfig().apiUrl}/api/hospitals/me`, { headers: staffHeaders })).status()).toBe(401);
      await staff.reload();
      await expect(staff).toHaveURL(/\/hospital\/login$/);
      const newPassword = `Reset-synthetic-${crypto.randomBytes(12).toString("hex")}`;
      expect((await admin.page.request.patch(`${getE2EConfig().apiUrl}/api/hospital-staff/accounts/${account.staffId}`, { headers, data: { active: true, password: newPassword } })).ok()).toBe(true);
      expect((await staff.request.post(`${getE2EConfig().apiUrl}/api/hospital-staff/login`, { data: { username, password } })).status()).toBe(401);
      await staff.getByLabel("Username", { exact: true }).fill(username);
      await staff.getByLabel("Password", { exact: true }).fill(newPassword);
      await staff.getByRole("button", { name: "Sign in to hospital" }).click();
      await expect(staff).toHaveURL(/\/hospital\/dashboard$/);
      await staff.getByRole("button", { name: "Sign out all staff sessions", exact: true }).click();
      await expect(staff).toHaveURL(/\/hospital\/login$/);
      const coordinator = new Contract(await (new Contract(process.env.CONTRACT_ADDRESS, require("../../backEnd/abi/InsuranceManager.json").abi, admin.provider)).oracleCoordinator(), require("../../backEnd/abi/OracleCoordinator.json").abi, admin.provider);
      expect(await coordinator.hospitalVerificationRegistry()).toBe("0x0000000000000000000000000000000000000000");
    } finally { await staffContext.close(); await closeActor(admin); }
  });

  test("reviewed medical document is committed with the purchase and immediate repeat collection is unavailable", async ({ browser }, testInfo) => {
    const user = await createActorContext(browser, "user");
    try {
      await loginActor(user.page, user.actor);
      await user.page.goto("/user/policies/buy");
      await user.page.getByRole("checkbox", { name: /I have read and agree/ }).first().check();
      await user.page.getByRole("button", { name: "Buy Policy", exact: true }).first().click();
      await expect(user.page.locator(".success-text")).toContainText("policy purchased successfully");
      await user.page.goto("/user/policies");
      await expect(user.page.getByRole("button", { name: "Pay Premium", exact: true }).first()).toBeDisabled();
      const token = await user.page.evaluate(() => localStorage.getItem("blockinsure_jwt"));
      const response = await user.page.request.get(`${getE2EConfig().apiUrl}/api/policies/my`, { headers: { Authorization: `Bearer ${token}` } });
      expect(response.ok(), await response.text()).toBe(true);
      const policies = (await response.json()).policies;
      expect(policies.length).toBeGreaterThan(0);
      expect(policies[0].issuedDocument.bound).toBe(true);
      expect(policies[0].issuedDocument.available).toBe(true);
      expect(policies[0].policyTerms.authoritative).toBe(true);
      expect(policies[0].installment.payableNow).toBe(false);
      await testInfo.attach("issued-policy-and-schedule.png", { body: await user.page.screenshot({ fullPage: true }), contentType: "image/png" });
    } finally { await closeActor(user); }
  });

  test("custom terms remain authoritative and an interrupted publication is unavailable for purchase", async ({ browser }) => {
    const admin = await createActorContext(browser, "admin");
    const user = await createActorContext(browser, "user");
    try {
      await loginActor(admin.page, admin.actor);
      await admin.page.goto("/admin/policy-packages/new");
      const name = `Critical Accident Custom ${Date.now()}`;
      for (const [label, value] of [
        ["Package name", name], ["Premium amount in ETH", "0.01"], ["Coverage amount in ETH", "1"],
        ["Initial waiting period (days)", "2"], ["Reinstatement waiting period (days)", "1"],
        ["Claim filing deadline (days)", "180"], ["Deductible rate (basis points)", "750"],
        ["Deductible cap (ETH)", "0.015"], ["Insurer share (basis points)", "6500"],
        ["Maximum claim (ETH)", "0.8"], ["Allowed claim types (comma separated)", "CUSTOM_MEDICAL"],
      ]) await admin.page.getByLabel(label, { exact: true }).fill(value);
      const created = admin.page.waitForResponse((response) => response.request().method() === "POST" && /\/api\/admin\/policy-packages$/.test(response.url()));
      await admin.page.getByRole("button", { name: "Create Package", exact: true }).click();
      const response = await created;
      expect(response.status(), await response.text()).toBe(201);
      const packageId = (await response.json()).packageId;
      const publicResponse = await admin.page.request.get(`${getE2EConfig().apiUrl}/api/policy-packages/${packageId}`);
      expect(publicResponse.ok(), await publicResponse.text()).toBe(true);
      const offered = (await publicResponse.json()).policyPackage;
      expect(offered.policyTerms.waitingPeriodDays).toBe(2);
      expect(offered.policyTerms.coinsuranceBps).toBe(6500);
      expect(offered.policyTerms.coveredClaimTypes).toEqual(["CUSTOM_MEDICAL"]);
      expect(offered.policyDocument.content).toContain("Initial waiting period: 2 days");

      const manager = new Contract(process.env.CONTRACT_ADDRESS, require("../../backEnd/abi/InsuranceManager.json").abi, await admin.provider.getSigner(admin.wallet.address));
      await (await manager.createPolicyPackage("Interrupted rule publication", "HEALTH", offered.premiumAmountWei, offered.coverageAmountWei, 365, "HOSPITAL_BILL")).wait();
      const incompleteId = String(await manager.packageCounter() - 1n);
      expect((await admin.page.request.get(`${getE2EConfig().apiUrl}/api/policy-packages/${incompleteId}`)).status()).toBe(404);
      const token = await admin.page.evaluate(() => localStorage.getItem("blockinsure_jwt"));
      const blocked = await admin.page.request.post(`${getE2EConfig().apiUrl}/api/admin/policy-packages/${incompleteId}/reactivate`, { headers: { Authorization: `Bearer ${token}` } });
      expect(blocked.status()).toBe(409);
      await (await manager.deactivatePolicyPackage(incompleteId)).wait();

      await (await manager.updatePolicyPackage(packageId, name, "HEALTH", offered.premiumAmountWei, offered.coverageAmountWei, 366, "HOSPITAL_BILL")).wait();
      await expect(manager.connect(user.wallet).purchasePolicyWithTerms(packageId, offered.issueHash, offered.policyDocument.documentHash, { value: BigInt(offered.premiumAmountWei) })).rejects.toThrow();
      await loginActor(user.page, user.actor);
      await user.page.goto("/user/policies/buy");
      const card = user.page.locator(".card-row > .card").filter({ has: user.page.getByRole("heading", { name, exact: true }) });
      await card.getByRole("checkbox", { name: /I have read and agree/ }).check();
      await card.getByRole("button", { name: "Buy Policy", exact: true }).click();
      await expect(user.page.locator(".success-text")).toContainText("policy purchased successfully");
      const userToken = await user.page.evaluate(() => localStorage.getItem("blockinsure_jwt"));
      const mine = await (await user.page.request.get(`${getE2EConfig().apiUrl}/api/policies/my`, { headers: { Authorization: `Bearer ${userToken}` } })).json();
      const issued = mine.policies.find((policy) => policy.packageId === packageId);
      expect(issued.policyTerms.coinsuranceBps).toBe(6500);
      expect(issued.policyTerms.waitingPeriodDays).toBe(2);
      expect(issued.issuedDocument.bound && issued.issuedDocument.available).toBe(true);
    } finally { await closeActor(user); await closeActor(admin); }
  });
});
