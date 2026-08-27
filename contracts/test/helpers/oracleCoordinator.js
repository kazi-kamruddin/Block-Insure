const { ethers } = require("hardhat");

const DEFAULT_REGISTRY_ROOT = ethers.keccak256(
  ethers.toUtf8Bytes("block-insure-test-registry-v1")
);
const DEFAULT_TREE_VERSION_HASH = ethers.keccak256(
  ethers.toUtf8Bytes("canonical-registry-schema-v1")
);

async function getOracleCoordinator(insuranceManager, signer) {
  const coordinator = await ethers.getContractAt(
    "OracleCoordinator",
    await insuranceManager.oracleCoordinator()
  );
  return signer ? coordinator.connect(signer) : coordinator;
}

async function configureOracleFixture(
  insuranceManager,
  admin,
  oracles,
  { threshold = 2, commitBlocks = 20, revealBlocks = 20 } = {}
) {
  if ((await insuranceManager.claimAdjudicator()) === ethers.ZeroAddress) {
    const Adjudicator = await ethers.getContractFactory("ClaimAdjudicator", admin);
    const adjudicator = await Adjudicator.deploy(await insuranceManager.getAddress());
    await insuranceManager.connect(admin).configureClaimAdjudicator(await adjudicator.getAddress());
  }
  const coordinator = await getOracleCoordinator(insuranceManager, admin);
  const oracleRole = await insuranceManager.ORACLE_ROLE();

  for (const oracle of oracles) {
    if (!(await insuranceManager.hasRole(oracleRole, oracle.address))) {
      await insuranceManager.connect(admin).grantProjectRole(oracleRole, oracle.address);
    }
  }

  await coordinator
    .connect(admin)
    .updateConsensusConfig(threshold, commitBlocks, revealBlocks);

  if ((await coordinator.currentRegistryVersion()) === 0n) {
    await coordinator
      .connect(admin)
      .publishRegistrySnapshot(
        DEFAULT_REGISTRY_ROOT,
        1,
        DEFAULT_TREE_VERSION_HASH
      );
  }

  return coordinator;
}

function buildCommitment(request, verified, resultHash, salt) {
  return ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(
      ["uint256", "uint64", "uint64", "bool", "bytes32", "bytes32", "bytes32"],
      [
        request.requestId,
        request.claimVersion,
        request.registryVersion,
        verified,
        resultHash,
        request.modelVersion,
        salt,
      ]
    )
  );
}

async function commitResult(coordinator, oracle, request, verified, resultHash, salt) {
  const commitment = buildCommitment(request, verified, resultHash, salt);
  await coordinator.connect(oracle).commitOracleResult(request.requestId, commitment);
  return commitment;
}

async function revealResult(coordinator, oracle, request, verified, resultHash, salt) {
  return coordinator.connect(oracle).revealOracleResult(
    request.requestId,
    verified,
    resultHash,
    request.claimVersion,
    request.registryVersion,
    request.modelVersion,
    salt
  );
}

async function finalizeExactResult(
  coordinator,
  requestId,
  oracles,
  verified,
  resultHash
) {
  const request = await coordinator.getRequest(requestId);
  const salts = oracles.map((oracle, index) =>
    ethers.keccak256(
      ethers.solidityPacked(
        ["string", "uint256", "address"],
        ["BLOCK_INSURE_TEST_SALT", index, oracle.address]
      )
    )
  );

  for (let index = 0; index < oracles.length; index += 1) {
    await commitResult(
      coordinator,
      oracles[index],
      request,
      verified,
      resultHash,
      salts[index]
    );
  }

  const latest = await ethers.provider.getBlockNumber();
  if (
    Number(await coordinator.commitmentCount(requestId)) <
      Number(request.expectedResponses) &&
    latest <= Number(request.commitDeadlineBlock)
  ) {
    const blocksToMine = Number(request.commitDeadlineBlock) - latest + 1;
    await ethers.provider.send("hardhat_mine", [ethers.toQuantity(blocksToMine)]);
  }

  let finalTransaction;
  for (let index = 0; index < oracles.length; index += 1) {
    finalTransaction = await revealResult(
      coordinator,
      oracles[index],
      request,
      verified,
      resultHash,
      salts[index]
    );
    if ((await coordinator.getRequest(requestId)).isFulfilled) break;
  }

  return finalTransaction;
}

module.exports = {
  DEFAULT_REGISTRY_ROOT,
  DEFAULT_TREE_VERSION_HASH,
  getOracleCoordinator,
  configureOracleFixture,
  buildCommitment,
  commitResult,
  revealResult,
  finalizeExactResult,
};
