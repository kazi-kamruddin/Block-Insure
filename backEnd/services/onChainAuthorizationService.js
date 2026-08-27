const { getReadOnlyContract } = require("./contractService");

const ROLE_CONSTANTS = Object.freeze({
  ADMIN: "ADMIN_ROLE",
  AUDITOR: "AUDITOR_ROLE",
  ORACLE: "ORACLE_ROLE",
});

const hasCurrentOnChainRole = async (role, walletAddress) => {
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
