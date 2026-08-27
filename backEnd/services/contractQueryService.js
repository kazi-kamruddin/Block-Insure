const normalizeAddress = (address) => String(address || "").toLowerCase();
const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 100;
const EVENT_BLOCK_CHUNK_SIZE = 2000;

const parsePagination = (query = {}) => {
  const requestedPage = Number.parseInt(query.page, 10);
  const requestedLimit = Number.parseInt(query.limit, 10);
  const page =
    Number.isInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;
  const limit =
    Number.isInteger(requestedLimit) && requestedLimit > 0
      ? Math.min(requestedLimit, MAX_PAGE_SIZE)
      : DEFAULT_PAGE_SIZE;

  return { page, limit };
};

const paginate = (items, { page, limit }) => {
  const total = items.length;
  const totalPages = Math.max(Math.ceil(total / limit), 1);
  const offset = (page - 1) * limit;

  return {
    items: items.slice(offset, offset + limit),
    pagination: {
      page,
      limit,
      total,
      totalPages,
      hasNextPage: page < totalPages,
      hasPreviousPage: page > 1,
    },
  };
};

const queryEventsInChunks = async (
  contract,
  filter,
  fromBlock = Number(process.env.CONTRACT_DEPLOYMENT_BLOCK || 0),
  toBlock
) => {
  const provider = contract.runner?.provider;
  const latestBlock =
    toBlock === undefined ? await provider.getBlockNumber() : Number(toBlock);
  const events = [];

  for (
    let chunkStart = Math.max(Number(fromBlock), 0);
    chunkStart <= latestBlock;
    chunkStart += EVENT_BLOCK_CHUNK_SIZE
  ) {
    const chunkEnd = Math.min(
      chunkStart + EVENT_BLOCK_CHUNK_SIZE - 1,
      latestBlock
    );
    events.push(
      ...(await contract.queryFilter(filter, chunkStart, chunkEnd))
    );
  }

  return events;
};

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
  const events = await queryEventsInChunks(
    contract,
    contract.filters.PolicyPurchased(null, null, walletAddress)
  );
  return events.map((event) => event.args.policyId);
};

const getClaimIdsByWallet = async (contract, walletAddress) => {
  const events = await queryEventsInChunks(
    contract,
    contract.filters.ClaimSubmitted(null, null, walletAddress)
  );
  return events.map((event) => event.args.claimId);
};

const getActiveRoleMembers = async (contract, role) => {
  const grants = await queryEventsInChunks(
    contract,
    contract.filters.RoleGranted(role)
  );
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
  paginate,
  parsePagination,
  queryEventsInChunks,
};
