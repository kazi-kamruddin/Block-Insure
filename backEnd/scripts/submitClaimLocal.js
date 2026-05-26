require("dotenv").config();

const { ethers } = require("ethers");
const InsuranceManagerArtifact = require("../abi/InsuranceManager.json");

/* ----------------------------- Arg Parser ------------------------------ */

const getFlagValue = (args, flagName) => {
  const index = args.indexOf(flagName);

  if (index === -1 || index + 1 >= args.length) {
    return null;
  }

  return args[index + 1];
};

const getPositionals = (args) => {
  const positionals = [];

  for (let i = 0; i < args.length; i += 1) {
    if (args[i].startsWith("--")) {
      i += 1;
    } else {
      positionals.push(args[i]);
    }
  }

  return positionals;
};

/* ----------------------------- Utilities ------------------------------- */

const normalizeBytes32 = (value, fallbackText) => {
  if (!value) {
    return ethers.keccak256(ethers.toUtf8Bytes(fallbackText));
  }

  if (/^0x[a-fA-F0-9]{64}$/.test(value)) {
    return value;
  }

  if (/^[a-fA-F0-9]{64}$/.test(value)) {
    return `0x${value}`;
  }

  return ethers.keccak256(ethers.toUtf8Bytes(value));
};

/* ----------------------------- Main Script ----------------------------- */

const submitClaimLocal = async () => {
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

    const args = process.argv.slice(2);
    const positionals = getPositionals(args);

    const policyId = positionals[0] || "1";
    const claimAmountEth = positionals[1] || "0.1";

    const invoiceHashInput =
      getFlagValue(args, "--invoice") || positionals[2] || null;

    const documentHashInput =
      getFlagValue(args, "--docHash") || positionals[3] || null;

    const documentCID =
      getFlagValue(args, "--cid") ||
      positionals[4] ||
      "QmLocalTestCIDForClaimDocument";

    const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
    const wallet = new ethers.Wallet(process.env.ADMIN_PRIVATE_KEY, provider);

    const contract = new ethers.Contract(
      process.env.VITE_CONTRACT_ADDRESS,
      InsuranceManagerArtifact.abi,
      wallet
    );

    const policy = await contract.getPolicy(policyId);

    if (!policy.isActive) {
      throw new Error("Policy is not active");
    }

    const incidentDate = policy.startDate;

   const claimAmount = ethers.parseEther(claimAmountEth);
   const claimType = "HOSPITALIZATION";
   
   const hospitalId =
     getFlagValue(args, "--hospital") ||
     "HOSP-001";
   
   const invoiceHash = normalizeBytes32(
     invoiceHashInput,
     `invoice-${wallet.address}-${Date.now()}`
   );

    const documentHash = normalizeBytes32(
      documentHashInput,
      `document-${wallet.address}-${Date.now()}`
    );

    console.log("Submitting claim as wallet:", wallet.address);
    console.log("Policy ID:", policyId);
    console.log("Policy start date:", policy.startDate.toString());
    console.log("Incident date used:", incidentDate.toString());
    console.log("Claim amount:", claimAmountEth, "ETH");
    console.log("Hospital ID:", hospitalId);
    console.log("Invoice hash:", invoiceHash);
    console.log("Document hash:", documentHash);
    console.log("Document CID:", documentCID);

    const tx = await contract.submitClaim(
      policyId,
      claimAmount,
      incidentDate,
      claimType,
      hospitalId,
      invoiceHash,
      documentHash,
      documentCID
    );

    console.log("Transaction sent:", tx.hash);

    const receipt = await tx.wait();

    let claimId = null;

    for (const log of receipt.logs) {
      try {
        const parsedLog = contract.interface.parseLog(log);

        if (parsedLog && parsedLog.name === "ClaimSubmitted") {
          claimId = parsedLog.args.claimId.toString();
        }
      } catch (_) {
        // Ignore unrelated logs.
      }
    }

    console.log("Claim submitted successfully");
    console.log("Claim ID:", claimId);
  } catch (error) {
    console.error("Claim submission failed:", error.message);
    process.exit(1);
  }
};

submitClaimLocal();