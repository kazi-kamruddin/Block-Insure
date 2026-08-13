const { ethers } = require("ethers");
const InsuranceManagerArtifact = require("../abi/InsuranceManager.json");
const OracleCoordinatorArtifact = require("../abi/OracleCoordinator.json");

const getRequiredEnv = (key) => {
  const value = process.env[key];

  if (!value) {
    const error = new Error(`${key} is not configured`);
    error.statusCode = 500;
    throw error;
  }

  return value;
};

const getProvider = () => {
  const rpcUrl = getRequiredEnv("RPC_URL");
  return new ethers.JsonRpcProvider(rpcUrl);
};

const getContractAddress = () => {
  return getRequiredEnv("VITE_CONTRACT_ADDRESS");
};

const getReadOnlyContract = () => {
  const provider = getProvider();
  const contractAddress = getContractAddress();

  return new ethers.Contract(
    contractAddress,
    InsuranceManagerArtifact.abi,
    provider
  );
};

const getContractBalance = async () => {
  const provider = getProvider();
  return provider.getBalance(getContractAddress());
};

const getOracleCoordinator = async (contract = getReadOnlyContract()) => {
  const coordinatorAddress = await contract.oracleCoordinator();
  return new ethers.Contract(
    coordinatorAddress,
    OracleCoordinatorArtifact.abi,
    contract.runner
  );
};

const getRegistrySnapshot = async (contract = getReadOnlyContract()) => {
  const coordinator = await getOracleCoordinator(contract);
  const [version, root, timestamp, blockNumber] = await Promise.all([
    coordinator.currentRegistryVersion(),
    coordinator.currentRegistryRoot(),
    coordinator.currentRegistryTimestamp(),
    coordinator.currentRegistryBlock(),
  ]);

  if (version === 0n) {
    return {
      version,
      root,
      timestamp,
      blockNumber,
      treeVersionHash: ethers.ZeroHash,
      leafCount: 0n,
    };
  }

  const snapshot = await coordinator.getRegistrySnapshot(version);
  return {
    version,
    root,
    timestamp,
    blockNumber,
    treeVersionHash: snapshot.treeVersionHash,
    leafCount: snapshot.leafCount,
  };
};

const getAdminWallet = () => {
  const provider = getProvider();
  const privateKey = getRequiredEnv("ADMIN_PRIVATE_KEY");
  const wallet = new ethers.Wallet(privateKey, provider);
  const signer = new ethers.NonceManager(wallet);

  signer.address = wallet.address;

  return signer;
};

const getAdminContract = () => {
  const wallet = getAdminWallet();
  const contractAddress = getContractAddress();

  return new ethers.Contract(
    contractAddress,
    InsuranceManagerArtifact.abi,
    wallet
  );
};

module.exports = {
  getProvider,
  getContractAddress,
  getContractBalance,
  getOracleCoordinator,
  getRegistrySnapshot,
  getReadOnlyContract,
  getAdminContract,
  getAdminWallet,
};
