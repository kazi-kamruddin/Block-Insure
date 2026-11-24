const { expect } = require("@playwright/test");

async function requestReadyOracleVerification(page, claimId) {
  const { apiUrl } = require("./environment").getE2EConfig();
  const token = await page.evaluate(() => localStorage.getItem("blockinsure_jwt"));
  const readinessPath = "/api/admin/oracle-readiness";
  const request = page.getByRole("button", { name: "Request Oracle Verification", exact: true });
  let readiness;
  for (let attempt = 0; attempt < 3; ++attempt) {
    await expect.poll(async () => {
      const response = await page.request.get(apiUrl + readinessPath, {
        headers: { Authorization: `Bearer ${token}` }, params: { claimId }, maxRetries: 1,
      });
      return response.status();
    }, { message: `Both Oracle workers must be ready for claim ${claimId}`, timeout: 90_000 }).toBe(200);
    [readiness] = await Promise.all([
      page.waitForResponse((response) => {
        const url = new URL(response.url());
        return response.request().method() === "GET" && url.pathname === readinessPath && url.searchParams.get("claimId") === String(claimId);
      }, { timeout: 30_000 }),
      request.click(),
    ]);
    // HTTP 503 exits the application's readiness check before any send.
    if (readiness.status() !== 503) break;
    await expect(request).toBeEnabled();
  }
  expect(readiness.status()).toBe(200);
  await expect(page.locator(".success-text").filter({ hasText: /^Oracle verification requested successfully\.$/ }))
    .toBeVisible({ timeout: 60_000 });
}

async function loginActor(page, actor) {
  if (actor.role === "HOSPITAL") {
    const { getE2EConfig } = require("./environment");
    const { Wallet } = require("../../backEnd/node_modules/ethers");
    const config = getE2EConfig();
    const admin = new Wallet(config.actors.admin.privateKey);
    const nonceResponse = await page.request.get(`${config.apiUrl}/api/auth/nonce/${admin.address}`);
    const nonce = await nonceResponse.json();
    const login = await page.request.post(`${config.apiUrl}/api/auth/wallet-login`, { data: {
      walletAddress: admin.address, message: nonce.message, signature: await admin.signMessage(nonce.message),
    } });
    expect(login.ok()).toBe(true);
    const headers = { Authorization: `Bearer ${(await login.json()).token}` };
    const hospitalId = actor.name === "hospital2" || actor.hospitalId === "HOSP-002" ? "HOSP-002" : "HOSP-001";
    // Synthetic test credential only; never a maintained user credential.
    const username = `e2e.staff.${hospitalId.toLowerCase()}`;
    const password = `Synthetic-staff-${require("node:crypto").randomBytes(18).toString("hex")}`;
    const created = await page.request.post(`${config.apiUrl}/api/hospital-staff/accounts`, { headers, data: { username, password, hospitalId, displayName: "Synthetic hospital staff" } });
    if (created.status() === 409) {
      const accounts = await (await page.request.get(`${config.apiUrl}/api/hospital-staff/accounts`, { headers })).json();
      const existing = accounts.staff.find((staff) => staff.username === username);
      const reset = await page.request.patch(`${config.apiUrl}/api/hospital-staff/accounts/${existing.staffId}`, { headers, data: { password, active: true } });
      expect(reset.ok()).toBe(true);
    } else expect(created.status(), await created.text()).toBe(201);
    await page.goto("/hospital/login");
    await page.getByLabel("Username", { exact: true }).fill(username);
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Sign in to hospital" }).click();
    await expect(page).toHaveURL(/\/hospital\/dashboard$/);
    return;
  }
  await page.goto("/");
  await page.getByRole("button", { name: /connect wallet/i }).first().click();
  await expect(page).toHaveURL(new RegExp(`${actor.home.replaceAll("/", "\\/")}$`));
  await expect(page.locator(".wallet-role")).toHaveText(actor.role);
}

async function resetLocalClaimSubmissionLimit(page) {
  const apiBaseUrl = process.env.E2E_API_URL || "http://localhost:5000";
  const result = await page.evaluate(async (baseUrl) => {
    const token = localStorage.getItem("blockinsure_jwt");
    const response = await fetch(`${baseUrl}/api/claims/submission-limit/me`, {
      method: "DELETE",
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    return { ok: response.ok, status: response.status, body: await response.text() };
  }, apiBaseUrl);

  if (!result.ok) {
    throw new Error(
      `Could not reset the local E2E claim allowance (${result.status}): ${result.body}`
    );
  }
}

async function prepareReasonedVote(page, basis) {
  if (process.env.CLAIM_WORKFLOW_PROFILE !== "V6") return;
  const input = page.getByRole("textbox", { name: /Evidence supporting your vote/ });
  await input.fill(basis);
}

function uniqueEvidenceFile() {
  const onePixelPng = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    "base64"
  );
  const uniqueMarker = Buffer.from(`\nblock-insure-e2e:${Date.now()}:${Math.random()}`);

  return {
    name: `claim-evidence-${Date.now()}.png`,
    mimeType: "image/png",
    buffer: Buffer.concat([onePixelPng, uniqueMarker]),
  };
}

function localDateTimeValue(date = new Date()) {
  const local = new Date(date.getTime() + 6 * 3_600_000);
  return local.toISOString().slice(0, local.getUTCSeconds() === 0 ? 16 : 19);
}

function syntheticPdfEvidenceFile() {
  const text = `DEMO medical evidence ${Date.now()}`;
  const content = `BT /F1 18 Tf 50 700 Td (${text}) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`,
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => { offsets.push(Buffer.byteLength(pdf)); pdf += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return { name: `demo-evidence-${Date.now()}.pdf`, mimeType: "application/pdf", buffer: Buffer.from(pdf) };
}

async function advanceToInstallment(session, policyId, daysBeforeDue) {
  const { Contract } = require("../../backEnd/node_modules/ethers");
  expect((await session.provider.getNetwork()).chainId).toBe(31337n);
  const manager = new Contract(process.env.CONTRACT_ADDRESS || process.env.VITE_CONTRACT_ADDRESS, require("../../backEnd/abi/InsuranceManager.json").abi, session.provider);
  const policy = await manager.getPolicy(policyId);
  const economics = new Contract(await manager.policyEconomics(), require("../../backEnd/abi/PolicyEconomics.json").abi, session.provider);
  const quote = await economics.getInstallmentQuote(policyId, policy.nextPremiumDueDate);
  const target = daysBeforeDue === undefined ? Number(quote.opensAt) : Number(policy.nextPremiumDueDate) - daysBeforeDue * 86400;
  const current = await session.provider.getBlock("latest");
  if (target > Number(current.timestamp)) {
    await session.provider.send("evm_setNextBlockTimestamp", [target]);
    await session.provider.send("evm_mine", []);
  }
  return policy;
}

module.exports = {
  advanceToInstallment,
  localDateTimeValue,
  loginActor,
  resetLocalClaimSubmissionLimit,
  prepareReasonedVote,
  requestReadyOracleVerification,
  uniqueEvidenceFile,
  syntheticPdfEvidenceFile,
};
