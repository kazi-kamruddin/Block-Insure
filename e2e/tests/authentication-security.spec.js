const { test, expect } = require("@playwright/test");
const { Wallet } = require("../../backEnd/node_modules/ethers");
const { getE2EConfig } = require("../support/environment");

async function nonceFor(request, apiUrl, walletAddress) {
  const response = await request.get(`${apiUrl}/api/auth/nonce/${walletAddress}`);
  expect(response.status(), await response.text()).toBe(200);
  return response.json();
}

async function loginWithWallet(request, apiUrl, wallet) {
  const nonce = await nonceFor(request, apiUrl, wallet.address);
  const signature = await wallet.signMessage(nonce.message);
  const response = await request.post(`${apiUrl}/api/auth/wallet-login`, {
    data: { walletAddress: wallet.address, message: nonce.message, signature },
  });
  return { nonce, response };
}

test.describe("@smoke authentication and session security", () => {
  test("protected APIs independently reject a missing bearer token", async ({ request }) => {
    const { apiUrl } = getE2EConfig();
    for (const path of [
      "/api/users/me",
      "/api/admin/role-sync-health",
      "/api/banks/me",
      "/api/hospitals/me",
      "/api/oracle/health",
      "/api/notifications",
    ]) {
      const response = await request.get(`${apiUrl}${path}`);
      expect(response.status(), `${path}: ${await response.text()}`).toBe(401);
    }
  });

  test("SIWE rejects invalid signatures, wrong wallets, and wrong chains", async ({ request }) => {
    const environment = getE2EConfig();
    const user = new Wallet(environment.actors.user.privateKey);
    const other = new Wallet(environment.actors.auditor1.privateKey);

    let nonce = await nonceFor(request, environment.apiUrl, user.address);
    let response = await request.post(`${environment.apiUrl}/api/auth/wallet-login`, {
      data: { walletAddress: user.address, message: nonce.message, signature: "0x00" },
    });
    expect(response.status()).toBe(401);

    nonce = await nonceFor(request, environment.apiUrl, user.address);
    response = await request.post(`${environment.apiUrl}/api/auth/wallet-login`, {
      data: {
        walletAddress: user.address,
        message: nonce.message,
        signature: await other.signMessage(nonce.message),
      },
    });
    expect(response.status()).toBe(401);

    nonce = await nonceFor(request, environment.apiUrl, user.address);
    const wrongChainMessage = nonce.message.replace(
      `Chain ID: ${environment.chainId}`,
      "Chain ID: 1"
    );
    response = await request.post(`${environment.apiUrl}/api/auth/wallet-login`, {
      data: {
        walletAddress: user.address,
        message: wrongChainMessage,
        signature: await user.signMessage(wrongChainMessage),
      },
    });
    expect(response.status()).toBe(401);
  });

  test("SIWE nonce replay and a logged-out bearer are rejected", async ({ request }) => {
    const environment = getE2EConfig();
    const user = new Wallet(environment.actors.user.privateKey);
    const { nonce, response } = await loginWithWallet(request, environment.apiUrl, user);
    expect(response.status(), await response.text()).toBe(200);
    const session = await response.json();

    const replay = await request.post(`${environment.apiUrl}/api/auth/wallet-login`, {
      data: {
        walletAddress: user.address,
        message: nonce.message,
        signature: await user.signMessage(nonce.message),
      },
    });
    expect(replay.status()).toBe(401);

    const logout = await request.post(`${environment.apiUrl}/api/auth/logout`, {
      headers: { authorization: `Bearer ${session.token}` },
    });
    expect(logout.status(), await logout.text()).toBe(200);
    const afterLogout = await request.get(`${environment.apiUrl}/api/users/me`, {
      headers: { authorization: `Bearer ${session.token}` },
    });
    expect(afterLogout.status()).toBe(401);
  });

  test("guest direct navigation and refresh cannot enter any role workspace", async ({ page }) => {
    for (const path of [
      "/user/dashboard",
      "/admin/dashboard",
      "/auditor/dashboard",
      "/hospital/dashboard",
      "/bank/dashboard",
    ]) {
      await page.goto(path);
      await expect(page).toHaveURL(/\/$/);
      await page.reload();
      await expect(page.getByRole("button", { name: /connect wallet/i }).first()).toBeVisible();
    }
  });
});
