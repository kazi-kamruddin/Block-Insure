require("dotenv").config();

const { ethers } = require("ethers");
const InsuranceManagerArtifact = require("../abi/InsuranceManager.json");

const purchasePolicyLocal = async () => {
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

    const packageId = process.argv[2] || "1";

    const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
    const wallet = new ethers.Wallet(process.env.ADMIN_PRIVATE_KEY, provider);

    const contract = new ethers.Contract(
      process.env.VITE_CONTRACT_ADDRESS,
      InsuranceManagerArtifact.abi,
      wallet
    );

    console.log("Purchasing policy as wallet:", wallet.address);
    console.log("Package ID:", packageId);

    const policyPackage = await contract.getPolicyPackage(packageId);

    if (!policyPackage.isActive) {
      throw new Error("Policy package is not active");
    }

    console.log("Package name:", policyPackage.name);
    console.log("Premium:", ethers.formatEther(policyPackage.premiumAmount), "ETH");

    const tx = await contract.purchasePolicy(packageId, {
      value: policyPackage.premiumAmount,
    });

    console.log("Transaction sent:", tx.hash);

    const receipt = await tx.wait();

    let purchasedPolicyId = null;

    for (const log of receipt.logs) {
      try {
        const parsedLog = contract.interface.parseLog(log);

        if (parsedLog && parsedLog.name === "PolicyPurchased") {
          purchasedPolicyId = parsedLog.args.policyId.toString();
        }
      } catch (_) {
        // Ignore unrelated logs.
      }
    }

    console.log("Policy purchased successfully");
    console.log("Policy ID:", purchasedPolicyId);
  } catch (error) {
    console.error("Policy purchase failed:", error.message);
    process.exit(1);
  }
};

purchasePolicyLocal();