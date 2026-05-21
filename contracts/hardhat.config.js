require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config();

const { RPC_URL, ADMIN_PRIVATE_KEY } = process.env;

module.exports = {
  solidity: "0.8.28",
  networks: {
    sepolia: {
      url: RPC_URL || "",
      accounts: ADMIN_PRIVATE_KEY ? [ADMIN_PRIVATE_KEY] : [],
    },
  },
};