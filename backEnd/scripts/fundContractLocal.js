require("dotenv").config();

const { ethers } = require("ethers");
const InsuranceManagerArtifact = require("../abi/InsuranceManager.json");

const fundContractLocal = async () => {
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

    const amountEth = process.argv[2] || "1";

    const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
    const adminWallet = new ethers.Wallet(process.env.ADMIN_PRIVATE_KEY, provider);

    const contract = new ethers.Contract(
      process.env.VITE_CONTRACT_ADDRESS,
      InsuranceManagerArtifact.abi,
      adminWallet
    );

    console.log("Funding contract from:", adminWallet.address);
    console.log("Amount:", amountEth, "ETH");

    const tx = await contract.fundContract({
      value: ethers.parseEther(amountEth),
    });

    console.log("Transaction sent:", tx.hash);

    await tx.wait();

    const balance = await contract.getContractBalance();

    console.log("Contract funded successfully");
    console.log("Contract balance:", ethers.formatEther(balance), "ETH");
  } catch (error) {
    console.error("Fund contract failed:", error.message);
    process.exit(1);
  }
};

fundContractLocal();