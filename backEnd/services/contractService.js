const { ethers } = require("ethers");
const InsuranceManagerArtifact = require("../abi/InsuranceManager.json");

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

const getAdminWallet = () => {
  const provider = getProvider();
  const privateKey = getRequiredEnv("ADMIN_PRIVATE_KEY");

  return new ethers.Wallet(privateKey, provider);
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
  getReadOnlyContract,
  getAdminContract,
};