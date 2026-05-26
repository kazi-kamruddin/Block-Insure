require("dotenv").config();

const { ethers } = require("ethers");
const InsuranceManagerArtifact = require("../abi/InsuranceManager.json");

const grantOracleRoleLocal = async () => {
  try {
    if (!process.env.RPC_URL) {
      throw new Error("RPC_URL is missing in .env");
    }

    if (!process.env.VITE_CONTRACT_ADDRESS) {
      throw new Error("VITE_CONTRACT_ADDRESS is missing in .env");
    }

    if (!process.env.ADMIN_PRIVATE_KEY) {
      throw new Error("ADMIN_PRIVATE_KEY is missing in .env");
    }

    if (!process.env.ORACLE_PRIVATE_KEY) {
      throw new Error("ORACLE_PRIVATE_KEY is missing in .env");
    }

    const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
    const adminWallet = new ethers.Wallet(process.env.ADMIN_PRIVATE_KEY, provider);
    const oracleWallet = new ethers.Wallet(process.env.ORACLE_PRIVATE_KEY, provider);

    const contract = new ethers.Contract(
      process.env.VITE_CONTRACT_ADDRESS,
      InsuranceManagerArtifact.abi,
      adminWallet
    );

    const oracleRole = await contract.ORACLE_ROLE();

    const alreadyHasRole = await contract.hasRole(
      oracleRole,
      oracleWallet.address
    );

    if (alreadyHasRole) {
      console.log("Oracle wallet already has ORACLE_ROLE:");
      console.log(oracleWallet.address);
      return;
    }

    console.log("Granting ORACLE_ROLE to:", oracleWallet.address);

    const tx = await contract.grantProjectRole(oracleRole, oracleWallet.address);

    console.log("Transaction sent:", tx.hash);

    await tx.wait();

    console.log("ORACLE_ROLE granted successfully");
  } catch (error) {
    console.error("Grant oracle role failed:", error.message);
    process.exit(1);
  }
};

grantOracleRoleLocal();