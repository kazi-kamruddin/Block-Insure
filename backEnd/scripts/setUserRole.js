require("dotenv").config();

const dns = require("dns");
const mongoose = require("mongoose");
const { getAddress } = require("ethers");
const User = require("../models/User");

dns.setDefaultResultOrder("ipv4first");

if (process.env.FORCE_PUBLIC_DNS === "true") {
  dns.setServers(["8.8.8.8", "1.1.1.1"]);
}

const setUserRole = async () => {
  try {
    const walletInput = process.argv[2];
    const roleInput = process.argv[3] || "ADMIN";

    if (!walletInput) {
      throw new Error("Wallet address is required");
    }

    const allowedRoles = ["USER", "ADMIN", "AUDITOR", "ORACLE"];

    if (!allowedRoles.includes(roleInput)) {
      throw new Error(`Invalid role. Use one of: ${allowedRoles.join(", ")}`);
    }

    const walletAddress = getAddress(walletInput).toLowerCase();

    await mongoose.connect(process.env.MONGODB_URI);

    const user = await User.findOneAndUpdate(
      { walletAddress },
      { walletAddress, role: roleInput },
      {
        new: true,
        upsert: true,
        setDefaultsOnInsert: true,
      }
    );

    console.log("User role updated:");
    console.log({
      walletAddress: user.walletAddress,
      role: user.role,
    });

    await mongoose.connection.close();
  } catch (error) {
    console.error("Failed to update user role:", error.message);
    process.exit(1);
  }
};

setUserRole();