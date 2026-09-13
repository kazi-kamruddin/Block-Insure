const { test, expect } = require("@playwright/test");
const { getE2EConfig } = require("../support/environment");

test.describe("@unfinished RPC readiness and recovery", () => {
  test("readiness fails closed during a local RPC outage and recovers after reconnection", async ({
    request,
  }) => {
    const environment = getE2EConfig();
    const proxyUrl = environment.backendRpcProxyUrl;
    expect(proxyUrl, "Start the isolated stack with E2E_RPC_PROXY=true").toBeTruthy();

    const initial = await request.get(`${environment.apiUrl}/health/ready`);
    expect(initial.status(), await initial.text()).toBe(200);
    expect(await initial.json()).toMatchObject({
      success: true,
      status: "ready",
      services: {
        database: "connected",
        blockchainRpc: "connected",
        contract: "deployed",
        chainId: 31337,
        expectedChainId: 31337,
      },
    });

    const paused = await request.post(`${proxyUrl}/__control/pause`);
    expect(paused.status(), await paused.text()).toBe(200);
    expect(await paused.json()).toMatchObject({ success: true, paused: true });
    try {
      await expect
        .poll(async () => {
          const response = await request.get(`${environment.apiUrl}/health/ready`);
          const body = await response.json();
          return { status: response.status(), body };
        }, { timeout: 15_000, intervals: [250, 500, 1_000] })
        .toMatchObject({
          status: 503,
          body: {
            success: false,
            status: "not_ready",
            services: {
              database: "connected",
              blockchainRpc: "unavailable",
              contract: "unchecked",
            },
          },
        });

      const liveness = await request.get(`${environment.apiUrl}/health/live`);
      expect(liveness.status(), await liveness.text()).toBe(200);
      expect(await liveness.json()).toMatchObject({ success: true, status: "alive" });
    } finally {
      await request.post(`${proxyUrl}/__control/resume`);
    }

    await expect
      .poll(async () => {
        const response = await request.get(`${environment.apiUrl}/health/ready`);
        return { status: response.status(), body: await response.json() };
      }, { timeout: 15_000, intervals: [250, 500, 1_000] })
      .toMatchObject({
        status: 200,
        body: {
          success: true,
          status: "ready",
          services: {
            database: "connected",
            blockchainRpc: "connected",
            contract: "deployed",
            chainId: 31337,
          },
        },
      });
  });
});
