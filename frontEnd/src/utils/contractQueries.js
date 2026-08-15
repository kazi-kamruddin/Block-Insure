function normalizeAddress(address) {
  return String(address || "").toLowerCase();
}

export async function getClaimIdsByWallet(contract, walletAddress) {
  void contract;
  const response = await getIndexedEvents({
    contractName: "InsuranceManager",
    eventName: "ClaimSubmitted",
    walletAddress,
    page: 1,
    limit: 100,
  });
  return (response.items || [])
    .map((event) => BigInt(event.args.claimId))
    .reverse();
}

export async function getActiveRoleMembers(contract, role) {
  const grants = [];
  let page = 1;
  let totalPages;
  do {
    const response = await getIndexedEvents({
      contractName: "InsuranceManager",
      eventName: "RoleGranted",
      argRole: String(role).toLowerCase(),
      page,
      limit: 100,
    });
    grants.push(...(response.items || []));
    totalPages = response.pagination?.totalPages || 1;
    page += 1;
  } while (page <= totalPages);
  const candidates = [
    ...new Set(grants.map((event) => normalizeAddress(event.args?.account))),
  ];
  const activeChecks = await Promise.all(
    candidates.map((account) => contract.hasRole(role, account))
  );

  return candidates.filter((_, index) => activeChecks[index]);
}
import { getIndexedEvents } from "../services/api";
