const normalizeAddress = (address) => String(address || "").toLowerCase();

const getCreatedIds = async (contract, counterName) => {
  const nextId = Number(await contract[counterName]());
  return Array.from({ length: Math.max(nextId - 1, 0) }, (_, index) =>
    BigInt(index + 1)
  );
};

const getPolicyPackageIds = (contract) =>
  getCreatedIds(contract, "packageCounter");

const getPolicyIds = (contract) => getCreatedIds(contract, "policyCounter");

const getClaimIds = (contract) => getCreatedIds(contract, "claimCounter");

const getActivePolicyPackageIds = async (contract) => {
  const packageIds = await getPolicyPackageIds(contract);
  const packages = await Promise.all(
    packageIds.map((packageId) => contract.getPolicyPackage(packageId))
  );

  return packageIds.filter((_, index) => packages[index].isActive);
};

const getPolicyIdsByWallet = async (contract, walletAddress) => {
  const targetWallet = normalizeAddress(walletAddress);
  const policyIds = await getPolicyIds(contract);
  const policies = await Promise.all(
    policyIds.map((policyId) => contract.getPolicy(policyId))
  );

  return policyIds.filter(
    (_, index) =>
      normalizeAddress(policies[index].holderWallet) === targetWallet
  );
};

const getClaimIdsByWallet = async (contract, walletAddress) => {
  const targetWallet = normalizeAddress(walletAddress);
  const claimIds = await getClaimIds(contract);
  const claims = await Promise.all(
    claimIds.map((claimId) => contract.getClaim(claimId))
  );

  return claimIds.filter(
    (_, index) =>
      normalizeAddress(claims[index].claimantWallet) === targetWallet
  );
};

const getActiveRoleMembers = async (contract, role) => {
  const grants = await contract.queryFilter(contract.filters.RoleGranted(role));
  const candidates = [
    ...new Set(grants.map((event) => normalizeAddress(event.args.account))),
  ];
  const activeChecks = await Promise.all(
    candidates.map((account) => contract.hasRole(role, account))
  );

  return candidates.filter((_, index) => activeChecks[index]);
};

module.exports = {
  getActivePolicyPackageIds,
  getActiveRoleMembers,
  getClaimIds,
  getClaimIdsByWallet,
  getPolicyIds,
  getPolicyIdsByWallet,
  getPolicyPackageIds,
};
