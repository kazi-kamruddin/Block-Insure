const { test, expect } = require("@playwright/test");
const { Wallet } = require("../../backEnd/node_modules/ethers");
const { getE2EConfig } = require("../support/environment");

test.describe.configure({ mode: "serial" });

test.describe("@resilience live HTTP defensive controls", () => {
  test("serves security headers and an explicit local CORS policy", async ({ request }) => {
    const { apiUrl } = getE2EConfig();
    const allowed = await request.get(`${apiUrl}/health/live`, {
      headers: { origin: "http://localhost:5173" },
    });
    expect(allowed.status(), await allowed.text()).toBe(200);
    expect(allowed.headers()["access-control-allow-origin"]).toBe(
      "http://localhost:5173"
    );
    expect(allowed.headers()["access-control-allow-credentials"]).toBe("true");
    expect(allowed.headers()["x-content-type-options"]).toBe("nosniff");
    expect(allowed.headers()["content-security-policy"]).toBeTruthy();
    expect(allowed.headers()["x-powered-by"]).toBeUndefined();

    const denied = await request.get(`${apiUrl}/health/live`, {
      headers: { origin: "https://untrusted.invalid" },
    });
    expect(denied.status(), await denied.text()).toBe(403);
    expect(denied.headers()["access-control-allow-origin"]).toBeUndefined();
  });

  test("rejects malformed JSON and unsupported methods without leaking internals", async ({
    request,
  }) => {
    const { apiUrl } = getE2EConfig();
    const malformed = await request.fetch(`${apiUrl}/api/auth/wallet-login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      data: '{"walletAddress":',
    });
    expect(malformed.status(), await malformed.text()).toBe(400);
    const malformedBody = await malformed.text();
    expect(malformedBody).not.toContain("node_modules");
    expect(malformedBody).not.toContain("backEnd\\");
    expect(malformedBody).not.toMatch(/private.?key|jwt.?secret|mongodb(?:\+srv)?:\/\//i);

    const unsupported = await request.patch(`${apiUrl}/health/live`);
    expect(unsupported.status(), await unsupported.text()).toBe(404);
    expect(await unsupported.json()).toMatchObject({
      success: false,
      message: "Route not found: PATCH /health/live",
    });
  });

  test("live Oracle endpoints reject missing and invalid API keys", async ({ request }) => {
    const { apiUrl } = getE2EConfig();
    for (const headers of [{}, { "x-oracle-api-key": "invalid" }]) {
      const response = await request.post(`${apiUrl}/api/oracle/heartbeat`, {
        headers,
        data: { oracleAddress: "0x0000000000000000000000000000000000000001" },
      });
      expect(response.status(), await response.text()).toBe(401);
      expect(await response.json()).toMatchObject({
        success: false,
        message: "Invalid oracle API key",
      });
    }
  });

  test("nonce endpoint enforces its sustained per-client rate limit", async ({ request }) => {
    const environment = getE2EConfig();
    const walletAddress = new Wallet(environment.actors.user.privateKey).address;
    const responses = await Promise.all(
      Array.from({ length: 110 }, () =>
        request.get(`${environment.apiUrl}/api/auth/nonce/${walletAddress}`)
      )
    );
    const statuses = responses.map((response) => response.status());
    expect(statuses.every((status) => status === 200 || status === 429)).toBe(true);
    expect(statuses.filter((status) => status === 429).length).toBeGreaterThan(0);
    const limited = responses.find((response) => response.status() === 429);
    expect(limited.headers()["ratelimit"]).toBeTruthy();
    expect(await limited.json()).toMatchObject({
      success: false,
      message: "Too many nonce requests. Try again later.",
    });
  });
});
