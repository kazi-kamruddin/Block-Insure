require("dotenv").config();

const { ethers } = require("ethers");
const InsuranceManagerArtifact = require("../abi/InsuranceManager.json");

function requireEnv(name) {
  const value = process.env[name];

  if (!value) {
    throw new Error(`${name} is missing in .env`);
  }

  return value;
}

async function grantRoleIfMissing(contract, roleName, roleHash, walletAddress, nonceState) {
  const normalizedAddress = ethers.getAddress(walletAddress);

  const alreadyHasRole = await contract.hasRole(roleHash, normalizedAddress);

  if (alreadyHasRole) {
    console.log(`${roleName} already granted to: ${normalizedAddress}`);
    return;
  }

  console.log(`Granting ${roleName} to: ${normalizedAddress}`);

  const tx = await contract.grantProjectRole(roleHash, normalizedAddress, {
    nonce: nonceState.current,
  });

  console.log(`${roleName} transaction sent: ${tx.hash}`);
  console.log(`${roleName} nonce used: ${nonceState.current}`);

  nonceState.current += 1;

  await tx.wait();

  console.log(`${roleName} granted successfully`);
}

async function main() {
  try {
    const rpcUrl = requireEnv("RPC_URL");
    const contractAddress = requireEnv("VITE_CONTRACT_ADDRESS");
    const adminPrivateKey = requireEnv("ADMIN_PRIVATE_KEY");
    const oraclePrivateKey = requireEnv("ORACLE_PRIVATE_KEY");
    const auditorWalletAddress = requireEnv("AUDITOR_WALLET_ADDRESS");

    const provider = new ethers.JsonRpcProvider(rpcUrl);
    const adminWallet = new ethers.Wallet(adminPrivateKey, provider);
    const oracleWallet = new ethers.Wallet(oraclePrivateKey, provider);

    const claimOfficerWalletAddress =
      process.env.CLAIM_OFFICER_WALLET_ADDRESS || adminWallet.address;

    const contract = new ethers.Contract(
      contractAddress,
      InsuranceManagerArtifact.abi,
      adminWallet
    );

    const nonceState = {
      current: await provider.getTransactionCount(adminWallet.address, "latest"),
    };

    console.log("Using contract:", contractAddress);
    console.log("Admin signer:", adminWallet.address);
    console.log("Admin starting nonce:", nonceState.current);
    console.log("Oracle wallet:", oracleWallet.address);
    console.log("Auditor wallet:", auditorWalletAddress);
    console.log("Claim officer wallet:", claimOfficerWalletAddress);
    console.log("");

    const adminRole = await contract.ADMIN_ROLE();
    const claimOfficerRole = await contract.CLAIM_OFFICER_ROLE();
    const oracleRole = await contract.ORACLE_ROLE();
    const auditorRole = await contract.AUDITOR_ROLE();

    const adminHasAdminRole = await contract.hasRole(
      adminRole,
      adminWallet.address
    );

    if (!adminHasAdminRole) {
      throw new Error(
        [
          "Admin wallet does not have ADMIN_ROLE on-chain.",
          `Admin wallet: ${adminWallet.address}`,
          "This usually means the contract was deployed by a different wallet.",
          "Redeploy the local contract using ADMIN_PRIVATE_KEY from contracts/.env,",
          "or use the original deployer/admin wallet to grant roles.",
        ].join("\n")
      );
    }

    console.log("Admin wallet has ADMIN_ROLE. Good.");
    console.log("");

    await grantRoleIfMissing(
      contract,
      "CLAIM_OFFICER_ROLE",
      claimOfficerRole,
      claimOfficerWalletAddress,
      nonceState
    );

    await grantRoleIfMissing(
      contract,
      "ORACLE_ROLE",
      oracleRole,
      oracleWallet.address,
      nonceState
    );

    await grantRoleIfMissing(
      contract,
      "AUDITOR_ROLE",
      auditorRole,
      auditorWalletAddress,
      nonceState
    );

    console.log("");
    console.log("Project on-chain role setup complete.");
  } catch (error) {
    console.error("Grant project roles failed:");
    console.error(error.message);
    process.exit(1);
  }
}

main();