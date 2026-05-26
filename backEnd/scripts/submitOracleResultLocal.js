require("dotenv").config();

const { ethers } = require("ethers");
const InsuranceManagerArtifact = require("../abi/InsuranceManager.json");

const submitOracleResultLocal = async () => {
  try {
    if (!process.env.RPC_URL) {
      throw new Error("RPC_URL is missing in .env");
    }

    if (!process.env.VITE_CONTRACT_ADDRESS) {
      throw new Error("VITE_CONTRACT_ADDRESS is missing in .env");
    }

    if (!process.env.ORACLE_PRIVATE_KEY) {
      throw new Error("ORACLE_PRIVATE_KEY is missing in .env");
    }

    const requestId = process.argv[2] || "1";
    const verifiedInput = process.argv[3] || "true";

    const verified = verifiedInput === "true";

    const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
    const oracleWallet = new ethers.Wallet(process.env.ORACLE_PRIVATE_KEY, provider);

    const contract = new ethers.Contract(
      process.env.VITE_CONTRACT_ADDRESS,
      InsuranceManagerArtifact.abi,
      oracleWallet
    );

    const oracleRequest = await contract.getOracleRequest(requestId);

    const oracleResponse = {
      requestId: requestId.toString(),
      claimId: oracleRequest.claimId.toString(),
      verified,
      riskLevel: verified ? "LOW" : "HIGH",
      remarks: verified
        ? "Hospital record matched in local oracle simulation"
        : "Hospital record mismatch in local oracle simulation",
      checkedAt: new Date().toISOString(),
    };

    const resultHash = ethers.keccak256(
      ethers.toUtf8Bytes(JSON.stringify(oracleResponse))
    );

    console.log("Submitting oracle result as:", oracleWallet.address);
    console.log("Request ID:", requestId);
    console.log("Claim ID:", oracleRequest.claimId.toString());
    console.log("Verified:", verified);
    console.log("Result hash:", resultHash);

    const tx = await contract.submitOracleResult(
      requestId,
      verified,
      resultHash,
      oracleResponse.riskLevel,
      oracleResponse.remarks
    );

    console.log("Transaction sent:", tx.hash);

    await tx.wait();

    const updatedRequest = await contract.getOracleRequest(requestId);
    const updatedClaim = await contract.getClaim(updatedRequest.claimId);

    console.log("Oracle result submitted successfully");
    console.log("Claim ID:", updatedClaim.claimId.toString());
    console.log("Claim status code:", updatedClaim.status.toString());
    console.log("Risk score:", updatedClaim.riskScore.toString());
  } catch (error) {
    console.error("Submit oracle result failed:", error.message);
    process.exit(1);
  }
};

submitOracleResultLocal();