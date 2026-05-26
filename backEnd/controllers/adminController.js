const { ethers } = require("ethers");
const { getAdminContract } = require("../services/contractService");

const createError = (message, statusCode) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

const createPolicyPackage = async (req, res, next) => {
  try {
    const {
      name,
      policyType,
      premiumAmountEth,
      coverageAmountEth,
      durationDays,
      requiredDocumentType,
    } = req.body;

    if (
      !name ||
      !policyType ||
      !premiumAmountEth ||
      !coverageAmountEth ||
      !durationDays ||
      !requiredDocumentType
    ) {
      throw createError("All policy package fields are required", 400);
    }

    const premiumAmountWei = ethers.parseEther(premiumAmountEth.toString());
    const coverageAmountWei = ethers.parseEther(coverageAmountEth.toString());

    const contract = getAdminContract();

    const tx = await contract.createPolicyPackage(
      name,
      policyType,
      premiumAmountWei,
      coverageAmountWei,
      Number(durationDays),
      requiredDocumentType
    );

    const receipt = await tx.wait();

    let packageId = null;

    for (const log of receipt.logs) {
      try {
        const parsedLog = contract.interface.parseLog(log);

        if (parsedLog && parsedLog.name === "PolicyPackageCreated") {
          packageId = parsedLog.args.packageId.toString();
        }
      } catch (_) {
        // Ignore logs from other contracts.
      }
    }

    res.status(201).json({
      success: true,
      message: "Policy package created successfully",
      packageId,
      transactionHash: tx.hash,
      package: {
        name,
        policyType,
        premiumAmountWei: premiumAmountWei.toString(),
        premiumAmountEth: premiumAmountEth.toString(),
        coverageAmountWei: coverageAmountWei.toString(),
        coverageAmountEth: coverageAmountEth.toString(),
        durationDays: Number(durationDays),
        requiredDocumentType,
      },
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  createPolicyPackage,
};