require("dotenv").config();

const axios = require("axios");
const { Wallet } = require("ethers");

const API_BASE_URL = "http://localhost:5000";

const testWalletLogin = async ({ httpClient = axios, signer, log = console.log } = {}) => {
  if (!signer && !process.env.ADMIN_PRIVATE_KEY) {
    throw new Error("ADMIN_PRIVATE_KEY is missing in .env");
  }
  const wallet = signer || new Wallet(process.env.ADMIN_PRIVATE_KEY);
  const walletAddress = wallet.address;
  let token;
  try {
    log("Testing wallet login for:", walletAddress);
    const nonceResponse = await httpClient.get(
      `${API_BASE_URL}/api/auth/nonce/${walletAddress}`
    );

    const { message } = nonceResponse.data;

    if (typeof message !== "string" || !message) {
      throw new Error("Backend did not return a SIWE login message");
    }

    const signature = await wallet.signMessage(message);

    const loginResponse = await httpClient.post(
      `${API_BASE_URL}/api/auth/wallet-login`,
      {
        walletAddress,
        message,
        signature,
      }
    );

    token = loginResponse.data?.token;
    if (!loginResponse.data?.success || !token) {
      throw new Error("Backend did not return a successful SIWE session");
    }
    const response = await httpClient.get(`${API_BASE_URL}/api/users/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (response.data?.user?.walletAddress?.toLowerCase() !== walletAddress.toLowerCase()) {
      throw new Error("Authenticated profile does not match the signing wallet");
    }
    log("SIWE login and protected profile verified for:", walletAddress);
  } finally {
    if (token) {
      await httpClient.post(`${API_BASE_URL}/api/auth/logout`, {}, {
        headers: { Authorization: `Bearer ${token}` },
      });
    }
  }
};

if (require.main === module) {
  testWalletLogin().catch((error) => {
    const detail = error.response ? `HTTP ${error.response.status}` : "diagnostic could not complete";
    console.error(`Wallet login test failed: ${detail}`);
    process.exitCode = 1;
  });
}

module.exports = { testWalletLogin };
