require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config();
require("solidity-coverage");
const { subtask } = require("hardhat/config");
const {
  TASK_COMPILE_SOLIDITY_GET_SOLC_BUILD,
} = require("hardhat/builtin-tasks/task-names");

const { RPC_URL, ADMIN_PRIVATE_KEY } = process.env;

subtask(TASK_COMPILE_SOLIDITY_GET_SOLC_BUILD).setAction(
  async ({ solcVersion }, _hre, runSuper) => {
    if (solcVersion === "0.8.26") {
      return {
        compilerPath: require.resolve("solc/soljson.js"),
        isSolcJs: true,
        version: "0.8.26",
        longVersion: "0.8.26+commit.8a97fa7a",
      };
    }

    return runSuper();
  }
);

module.exports = {
  solidity: {
    version: "0.8.26",
    settings: {
      evmVersion: "cancun",
      optimizer: {
        enabled: true,
        runs: 1,
      },
      viaIR: true,
      debug: {
        revertStrings: "strip",
      },
      metadata: {
        bytecodeHash: "none",
      },
    },
  },
  networks: {
    hardhat: {},
    sepolia: {
      url: RPC_URL || "",
      accounts: ADMIN_PRIVATE_KEY ? [ADMIN_PRIVATE_KEY] : [],
    },
  },
};
