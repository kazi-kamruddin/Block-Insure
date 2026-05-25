require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config();
require("solidity-coverage");

const { RPC_URL, ADMIN_PRIVATE_KEY } = process.env;

module.exports = {
  solidity: {
    version: "0.8.28",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
      viaIR: true,
    },
  },
  networks: {
    sepolia: {
      url: RPC_URL || "",
      accounts: ADMIN_PRIVATE_KEY ? [ADMIN_PRIVATE_KEY] : [],
    },
  },
};