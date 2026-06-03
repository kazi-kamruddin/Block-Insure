require("dotenv").config();

const dns = require("dns");
const mongoose = require("mongoose");
const { exportMerkleRoot } = require("../services/merkleRegistryService");
const { getAdminContract } = require("../services/contractService");

dns.setDefaultResultOrder("ipv4first");

if (process.env.FORCE_PUBLIC_DNS === "true") {
  dns.setServers(["8.8.8.8", "1.1.1.1"]);
}

const pushMerkleRoot = async () => {
  try {
    if (!process.env.MONGODB_URI) {
      throw new Error("MONGODB_URI is missing in .env");
    }

    await mongoose.connect(process.env.MONGODB_URI);

    const root = await exportMerkleRoot();
    const contract = getAdminContract();

    console.log("Pushing registry Merkle root on-chain...");
    console.log("Root:", root);

    const tx = await contract.updateRegistryMerkleRoot(root);

    console.log("Transaction sent:", tx.hash);

    const receipt = await tx.wait();

    console.log("Registry Merkle root updated successfully");
    console.log("Transaction hash:", tx.hash);
    console.log("Block number:", receipt.blockNumber);
  } catch (error) {
    console.error("Push Merkle root failed:", error.message);
    process.exitCode = 1;
  } finally {
    await mongoose.connection.close();
  }
};

pushMerkleRoot();
