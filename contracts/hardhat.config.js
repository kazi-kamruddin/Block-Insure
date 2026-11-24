require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config({ quiet: true });
require("solidity-coverage");
const { subtask } = require("hardhat/config");
const {
  TASK_COMPILE_SOLIDITY_GET_SOLC_BUILD,
} = require("hardhat/builtin-tasks/task-names");

const { RPC_URL, ADMIN_PRIVATE_KEY } = process.env;
const pairedChainId = Number(process.env.PAIRED_LOCAL_CHAIN_ID || 31337);
const pairedRpc = process.env.PAIRED_LOCAL_RPC_URL;
if (![31337, 11155111].includes(pairedChainId)) throw new Error("Invalid paired local chain ID");
if (pairedRpc && !/^http:\/\/(127\.0\.0\.1|localhost):\d+\/?$/.test(pairedRpc)) throw new Error("Paired local RPC must be loopback");

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
      "contracts/ClaimAdjudicatorV6.sol": {
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
      chainId: pairedChainId,
      hardfork: "cancun",
      blockGasLimit: 100_000_000,
    },
    ...(pairedRpc ? { localhost: { url: pairedRpc, chainId: pairedChainId } } : {}),
    sepolia: {
      url: process.env.SEPOLIA_RPC_URL || RPC_URL || "",
      chainId: 11155111,
      accounts: ADMIN_PRIVATE_KEY ? [ADMIN_PRIVATE_KEY] : [],
    },
    baseSepolia: {
      url: process.env.BASE_SEPOLIA_RPC_URL || "",
      chainId: 84532,
      accounts: ADMIN_PRIVATE_KEY ? [ADMIN_PRIVATE_KEY] : [],
    },
  },
};
