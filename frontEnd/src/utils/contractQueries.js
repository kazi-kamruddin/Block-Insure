function normalizeAddress(address) {
  return String(address || "").toLowerCase();
}

export async function getClaimIdsByWallet(contract, walletAddress) {
  const nextClaimId = Number(await contract.claimCounter());
  const claimIds = Array.from(
    { length: Math.max(nextClaimId - 1, 0) },
    (_, index) => BigInt(index + 1)
  );
  const claims = await Promise.all(
    claimIds.map((claimId) => contract.getClaim(claimId))
  );
  const targetWallet = normalizeAddress(walletAddress);

  return claimIds.filter(
    (_, index) =>
      normalizeAddress(claims[index].claimantWallet) === targetWallet
  );
}

export async function getActiveRoleMembers(contract, role) {
  const grants = await contract.queryFilter(contract.filters.RoleGranted(role));
  const candidates = [
    ...new Set(grants.map((event) => normalizeAddress(event.args.account))),
  ];
  const activeChecks = await Promise.all(
    candidates.map((account) => contract.hasRole(role, account))
  );

  return candidates.filter((_, index) => activeChecks[index]);
}
