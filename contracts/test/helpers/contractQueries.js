const normalizeAddress = (address) => address.toLowerCase();

async function getIds(contract, counterName) {
  const nextId = Number(await contract[counterName]());
  return Array.from({ length: Math.max(nextId - 1, 0) }, (_, index) =>
    BigInt(index + 1)
  );
}

const getPackageIds = (contract) => getIds(contract, "packageCounter");

async function getActivePackageIds(contract) {
  const packageIds = await getPackageIds(contract);
  const packages = await Promise.all(
    packageIds.map((packageId) => contract.getPolicyPackage(packageId))
  );
  return packageIds.filter((_, index) => packages[index].isActive);
}

async function getPolicyIdsByWallet(contract, walletAddress) {
  const policyIds = await getIds(contract, "policyCounter");
  const policies = await Promise.all(
    policyIds.map((policyId) => contract.getPolicy(policyId))
  );
  return policyIds.filter(
    (_, index) =>
      normalizeAddress(policies[index].holderWallet) ===
      normalizeAddress(walletAddress)
  );
}

async function getClaimIdsByWallet(contract, walletAddress) {
  const claimIds = await getIds(contract, "claimCounter");
  const claims = await Promise.all(
    claimIds.map((claimId) => contract.getClaim(claimId))
  );
  return claimIds.filter(
    (_, index) =>
      normalizeAddress(claims[index].claimantWallet) ===
      normalizeAddress(walletAddress)
  );
}

async function getActiveRoleMembers(contract, role) {
  const events = await contract.queryFilter(contract.filters.RoleGranted(role));
  const candidates = [
    ...new Set(events.map((event) => normalizeAddress(event.args.account))),
  ];
  const active = await Promise.all(
    candidates.map((account) => contract.hasRole(role, account))
  );
  return candidates.filter((_, index) => active[index]);
}

module.exports = {
  getActivePackageIds,
  getActiveRoleMembers,
  getClaimIdsByWallet,
  getPackageIds,
  getPolicyIdsByWallet,
};
