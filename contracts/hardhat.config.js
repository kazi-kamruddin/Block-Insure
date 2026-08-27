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
    compilers: [{
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
    }],
    overrides: {
      "contracts/ClaimAdjudicator.sol": {
        version: "0.8.26",
        settings: {
          evmVersion: "cancun",
          optimizer: { enabled: true, runs: 1 },
          viaIR: true,
          metadata: { bytecodeHash: "none" },
        },
      },
    },
  },
  networks: {
    // Pin the execution hardfork to the compiler target. This also keeps
    // coverage instrumentation from hitting Osaka's EIP-7825 transaction cap;
    // deployability is enforced separately by the EIP-170 bytecode-size tests.
    hardhat: {
      hardfork: "cancun",
      blockGasLimit: 100_000_000,
    },
    sepolia: {
      url: RPC_URL || "",
      accounts: ADMIN_PRIVATE_KEY ? [ADMIN_PRIVATE_KEY] : [],
    },
  },
};
