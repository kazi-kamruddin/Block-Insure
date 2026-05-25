require("dotenv").config();

const axios = require("axios");
const { Wallet } = require("ethers");

const API_BASE_URL = "http://localhost:5000";

const testWalletLogin = async () => {
  try {
    if (!process.env.ADMIN_PRIVATE_KEY) {
      throw new Error("ADMIN_PRIVATE_KEY is missing in .env");
    }

    const wallet = new Wallet(process.env.ADMIN_PRIVATE_KEY);
    const walletAddress = wallet.address;

    console.log("Testing wallet login for:", walletAddress);

    const nonceResponse = await axios.get(
      `${API_BASE_URL}/api/auth/nonce/${walletAddress}`
    );

    const { message } = nonceResponse.data;

    console.log("Message to sign:", message);

    const signature = await wallet.signMessage(message);

    const loginResponse = await axios.post(
      `${API_BASE_URL}/api/auth/wallet-login`,
      {
        walletAddress,
        signature,
      }
    );

    console.log("Wallet login successful:");
    console.log(loginResponse.data);
  } catch (error) {
    console.error("Wallet login test failed:");

    if (error.response) {
      console.error(error.response.data);
    } else {
      console.error(error.message);
    }
  }
};

testWalletLogin();