function normalizeAddress(address) {
  return String(address || "").toLowerCase();
}

export async function getClaimIdsByWallet(contract, walletAddress) {
  const events = await contract.queryFilter(
    contract.filters.ClaimSubmitted(null, null, walletAddress),
    Number(import.meta.env.VITE_CONTRACT_DEPLOYMENT_BLOCK || 0)
  );
  return events.map((event) => event.args.claimId);
}

export async function getActiveRoleMembers(contract, role) {
  const grants = await contract.queryFilter(
    contract.filters.RoleGranted(role),
    Number(import.meta.env.VITE_CONTRACT_DEPLOYMENT_BLOCK || 0)
  );
  const candidates = [
    ...new Set(grants.map((event) => normalizeAddress(event.args.account))),
  ];
  const activeChecks = await Promise.all(
    candidates.map((account) => contract.hasRole(role, account))
  );

  return candidates.filter((_, index) => activeChecks[index]);
}
