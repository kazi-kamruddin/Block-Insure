require("dotenv").config();

const dns = require("dns");
const mongoose = require("mongoose");
const { queueRegistryPublication, publishPendingRegistry } = require("../services/registryPublicationService");

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

    await queueRegistryPublication();
    const result = await publishPendingRegistry();
    if (result?.status !== "PUBLISHED") throw new Error("Registry publication is still pending");
    console.log("Both worker snapshots synchronized and archived; root published:", result.rootHash);
  } catch (error) {
    console.error("Push Merkle root failed:", error.message);
    process.exitCode = 1;
  } finally {
    await mongoose.connection.close();
  }
};

pushMerkleRoot();
