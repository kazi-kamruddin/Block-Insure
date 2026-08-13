require("dotenv").config();

const { ethers } = require("ethers");
const InsuranceManagerArtifact = require("../abi/InsuranceManager.json");
const OracleCoordinatorArtifact = require("../abi/OracleCoordinator.json");

const requireEnv = (name) => {
  if (!process.env[name]) throw new Error(`${name} is missing in .env`);
  return process.env[name];
};

const submitOracleResultLocal = async () => {
  try {
    const requestId = BigInt(process.argv[2] || "1");
    const verified = (process.argv[3] || "true") === "true";
    const provider = new ethers.JsonRpcProvider(requireEnv("RPC_URL"));
    const manager = new ethers.Contract(
      requireEnv("VITE_CONTRACT_ADDRESS"),
      InsuranceManagerArtifact.abi,
      provider
    );
    const coordinatorAddress = await manager.oracleCoordinator();
    const oracleWallets = [
      new ethers.Wallet(requireEnv("ORACLE_PRIVATE_KEY"), provider),
      new ethers.Wallet(requireEnv("ORACLE_PRIVATE_KEY_2"), provider),
    ];
    const request = await new ethers.Contract(
      coordinatorAddress,
      OracleCoordinatorArtifact.abi,
      provider
    ).getRequest(requestId);
    const resultHash = ethers.keccak256(
      ethers.AbiCoder.defaultAbiCoder().encode(
        ["string", "uint256", "uint256", "bool"],
        ["BLOCK_INSURE_LOCAL_MANUAL_RESULT_V1", requestId, request.claimId, verified]
      )
    );
    const submissions = [];

    for (const wallet of oracleWallets) {
      const coordinator = new ethers.Contract(
        coordinatorAddress,
        OracleCoordinatorArtifact.abi,
        wallet
      );
      const salt = ethers.keccak256(
        ethers.solidityPacked(
          ["string", "uint256", "address"],
          ["BLOCK_INSURE_LOCAL_SALT", requestId, wallet.address]
        )
      );
      const commitment = ethers.keccak256(
        ethers.AbiCoder.defaultAbiCoder().encode(
          ["uint256", "uint64", "uint64", "bool", "bytes32", "bytes32", "bytes32"],
          [requestId, request.claimVersion, request.registryVersion, verified, resultHash, request.modelVersion, salt]
        )
      );
      await (await coordinator.commitOracleResult(requestId, commitment)).wait();
      submissions.push({ coordinator, wallet, salt });
    }

    for (const { coordinator, wallet, salt } of submissions) {
      const tx = await coordinator.revealOracleResult(
        requestId,
        verified,
        resultHash,
        request.claimVersion,
        request.registryVersion,
        request.modelVersion,
        salt
      );
      await tx.wait();
      console.log(`Revealed request ${requestId} as ${wallet.address}: ${tx.hash}`);
    }

    const finalRequest = await submissions[0].coordinator.getRequest(requestId);
    console.log("Finalized:", finalRequest.isFulfilled);
    console.log("Verified:", finalRequest.verifiedResult);
    console.log("Result hash:", finalRequest.resultHash);
  } catch (error) {
    console.error("Submit oracle result failed:", error.message);
    process.exitCode = 1;
  }
};

submitOracleResultLocal();
