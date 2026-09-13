const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const { test, expect } = require("@playwright/test");
const dotenv = require("../../backEnd/node_modules/dotenv");
const jwt = require("../../backEnd/node_modules/jsonwebtoken");
const mongoose = require("../../backEnd/node_modules/mongoose");

const { loginActor } = require("../support/actions");
const { closeActor, createActorContext } = require("../support/walletBridge");
const { getE2EConfig } = require("../support/environment");

const projectRoot = path.resolve(__dirname, "../..");

function requireLocalMongoUri() {
  const uri = process.env.MONGODB_URI || process.env.E2E_MONGODB_URI;
  if (!uri) throw new Error("A disposable local MongoDB URI is required");
  const parsed = new URL(uri);
  if (!["127.0.0.1", "localhost", "::1"].includes(parsed.hostname)) {
    throw new Error(`Refusing unfinished-boundary tests against non-local MongoDB host ${parsed.hostname}`);
  }
  if (parsed.pathname.replace(/^\//, "") !== "block_insure_e2e") {
    throw new Error("Refusing unfinished-boundary tests outside block_insure_e2e");
  }
  return uri;
}

async function bearer(page) {
  const token = await page.evaluate(() => localStorage.getItem("blockinsure_jwt"));
  expect(token, "SIWE login should persist a bearer token").toBeTruthy();
  return { Authorization: `Bearer ${token}` };
}

test.describe("@unfinished live defensive and isolation boundaries", () => {
  test("expired signed session is rejected independently by the backend", async ({ request }) => {
    const environment = dotenv.parse(
      fs.readFileSync(path.join(projectRoot, "backEnd", ".env"), "utf8")
    );
    const expiredToken = jwt.sign(
      {
        jti: crypto.randomUUID(),
        walletAddress: "0x0000000000000000000000000000000000000001",
        role: "USER",
        authMethod: "SIWE",
      },
      environment.JWT_SECRET,
      {
        audience: environment.JWT_AUDIENCE || "block-insure-client",
        issuer: environment.JWT_ISSUER || "block-insure-api",
        expiresIn: -1,
      }
    );
    const response = await request.get(`${getE2EConfig().apiUrl}/api/users/me`, {
      headers: { Authorization: `Bearer ${expiredToken}` },
    });
    expect(response.status()).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      message: "Invalid or expired token",
    });
  });

  test("a second contracted hospital cannot read or mutate another hospital's record", async ({ browser }) => {
    const owner = await createActorContext(browser, "hospital");
    const outsider = await createActorContext(browser, "hospital2");
    const user = await createActorContext(browser, "user");
    try {
      await loginActor(owner.page, owner.actor);
      const ownerRecordsResponse = await owner.page.request.get(
        `${getE2EConfig().apiUrl}/api/hospitals/records`,
        { headers: await bearer(owner.page) }
      );
      expect(ownerRecordsResponse.ok()).toBe(true);
      const ownerRecords = (await ownerRecordsResponse.json()).records;
      expect(ownerRecords.length).toBeGreaterThan(0);
      expect(new Set(ownerRecords.map((record) => record.hospitalId))).toEqual(new Set(["HOSP-001"]));
      const protectedRecord = ownerRecords[0];

      await loginActor(outsider.page, outsider.actor);
      await expect(outsider.page.getByText("Chattogram Metropolitan Hospital")).toBeVisible();
      const outsiderHeaders = await bearer(outsider.page);
      const outsiderRecordsResponse = await outsider.page.request.get(
        `${getE2EConfig().apiUrl}/api/hospitals/records`,
        { headers: outsiderHeaders }
      );
      expect(outsiderRecordsResponse.ok()).toBe(true);
      const outsiderRecords = (await outsiderRecordsResponse.json()).records;
      expect(outsiderRecords.every((record) => record.hospitalId === "HOSP-002")).toBe(true);
      expect(outsiderRecords.some((record) => record.id === protectedRecord.id)).toBe(false);

      const crossHospitalPatch = await outsider.page.request.patch(
        `${getE2EConfig().apiUrl}/api/hospitals/records/${protectedRecord.id}`,
        { headers: outsiderHeaders, data: { invoiceStatus: "PAID" } }
      );
      expect(crossHospitalPatch.status()).toBe(404);

      await loginActor(user.page, user.actor);
      const wrongRolePatch = await user.page.request.patch(
        `${getE2EConfig().apiUrl}/api/hospitals/records/${protectedRecord.id}`,
        { headers: await bearer(user.page), data: { invoiceStatus: "PAID" } }
      );
      expect(wrongRolePatch.status()).toBe(403);

      const ownerRecordAfter = await owner.page.request.get(
        `${getE2EConfig().apiUrl}/api/hospitals/records/${protectedRecord.id}`,
        { headers: await bearer(owner.page) }
      );
      expect(ownerRecordAfter.ok()).toBe(true);
      expect((await ownerRecordAfter.json()).record.invoiceStatus).toBe(protectedRecord.invoiceStatus);
    } finally {
      await closeActor(owner);
      await closeActor(outsider);
      await closeActor(user);
    }
  });

  test("manual OTP expiry, concurrent confirmation, and replay produce one payment", async ({ browser }) => {
    test.setTimeout(120_000);
    const mongo = await mongoose.createConnection(requireLocalMongoUri()).asPromise();
    const session = await createActorContext(browser, "user");
    try {
      await loginActor(session.page, session.actor);
      await session.page.goto("/user/policies/buy");
      await session.page.getByRole("checkbox", { name: /I have read and agree/ }).first().check();
      await session.page.getByRole("button", { name: "Buy Policy" }).first().click();
      await expect(session.page.locator(".success-text")).toContainText("policy purchased successfully");

      await session.page.goto("/user/banking");
      await session.page.getByLabel("Source account").selectOption({ index: 1 });
      const policySelect = session.page.locator(".banking-form select").nth(1);
      await expect.poll(() => policySelect.locator("option").count()).toBeGreaterThan(1);
      await policySelect.selectOption({ index: (await policySelect.locator("option").count()) - 1 });
      const policyId = await policySelect.inputValue();

      const expiredResponsePromise = session.page.waitForResponse(
        (response) => response.request().method() === "POST" && response.url().endsWith("/manual-payments/otp")
      );
      await session.page.getByRole("button", { name: "Make a manual bank payment" }).click();
      const expiredChallenge = await (await expiredResponsePromise).json();
      await mongo.db.collection("bankotpchallenges").updateOne(
        { challengeId: expiredChallenge.challengeId },
        { $set: { expiresAt: new Date(Date.now() - 1_000) } }
      );
      await session.page.getByRole("button", { name: "Confirm manual payment" }).click();
      await expect(session.page.locator(".app-toast.toast-error")).toContainText("OTP has expired");

      const freshResponsePromise = session.page.waitForResponse(
        (response) => response.request().method() === "POST" && response.url().endsWith("/manual-payments/otp")
      );
      await session.page.getByRole("button", { name: "Make a manual bank payment" }).click();
      const freshChallenge = await (await freshResponsePromise).json();
      const headers = await bearer(session.page);
      const beforeCount = await mongo.db.collection("banktransactions").countDocuments({
        policyId,
        type: "MANUAL_OTP",
      });
      const confirmUrl = `${getE2EConfig().apiUrl}/api/banks/user/manual-payments/confirm`;
      const payload = { challengeId: freshChallenge.challengeId, otp: freshChallenge.demoOtp };
      const confirmations = await Promise.all([
        session.page.request.post(confirmUrl, { headers, data: payload }),
        session.page.request.post(confirmUrl, { headers, data: payload }),
      ]);
      const statuses = confirmations.map((response) => response.status()).sort((a, b) => a - b);
      expect(statuses[0]).toBe(200);
      expect([404, 409]).toContain(statuses[1]);

      const replay = await session.page.request.post(confirmUrl, { headers, data: payload });
      expect([404, 409]).toContain(replay.status());
      await expect
        .poll(() => mongo.db.collection("banktransactions").countDocuments({ policyId, type: "MANUAL_OTP" }))
        .toBe(beforeCount + 1);
    } finally {
      await closeActor(session);
      await mongo.close();
    }
  });
});
