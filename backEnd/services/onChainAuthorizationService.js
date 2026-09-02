const {
  getHospitalVerificationRegistry,
  getBankIdentityRegistry,
  getReadOnlyContract,
} = require("./contractService");

const ROLE_CONSTANTS = Object.freeze({
  ADMIN: "ADMIN_ROLE",
  AUDITOR: "AUDITOR_ROLE",
  ORACLE: "ORACLE_ROLE",
});

const hasCurrentOnChainRole = async (role, walletAddress) => {
  if (role === "HOSPITAL") {
    const registry = getHospitalVerificationRegistry();
    const hospitalRole = await registry.HOSPITAL_ROLE();
    return registry.hasRole(hospitalRole, walletAddress);
  }
  if (role === "BANK") {
    const registry = getBankIdentityRegistry();
    const bankRole = await registry.BANK_ROLE();
    return registry.hasRole(bankRole, walletAddress);
  }
  const constantName = ROLE_CONSTANTS[role];
  if (!constantName) return true;
  const contract = getReadOnlyContract();
  const roleId = await contract[constantName]();
  return contract.hasRole(roleId, walletAddress);
};

const assertCurrentOnChainRole = async (role, walletAddress) => {
  if (await hasCurrentOnChainRole(role, walletAddress)) return;
  const error = new Error("On-chain role is missing or has been revoked");
  error.statusCode = 403;
  throw error;
};

module.exports = { assertCurrentOnChainRole, hasCurrentOnChainRole };
