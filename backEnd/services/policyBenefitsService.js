const { ethers } = require("ethers");
const policyBenefitsAbi = require("../abi/policyBenefitsAbi");
const { getProvider } = require("./contractService");

const BENEFIT_TYPES = ["DEATH", "SURRENDER", "MATURITY"];
const BENEFIT_STATUSES = [
  "NONE",
  "REQUESTED",
  "APPROVED",
  "REJECTED",
  "ALLOCATED",
];

const getBenefitsAddress = () => {
  const address = String(process.env.POLICY_BENEFITS_ADDRESS || "").trim();
  if (!ethers.isAddress(address) || address === ethers.ZeroAddress) {
    const error = new Error(
      "Policy benefits module is not configured. Run the local deployment workflow."
    );
    error.statusCode = 503;
    throw error;
  }
  return address;
};

const getReadOnlyBenefitsContract = () =>
  new ethers.Contract(getBenefitsAddress(), policyBenefitsAbi, getProvider());

const formatTerms = (terms) => ({
  configured: terms.configured,
  deathBenefitEnabled: terms.deathBenefitEnabled,
  surrenderEnabled: terms.surrenderEnabled,
  maturityEnabled: terms.maturityEnabled,
  deathBenefitBps: Number(terms.deathBenefitBps),
  deathBenefitPercent: Number(terms.deathBenefitBps) / 100,
  surrenderValueBps: Number(terms.surrenderValueBps),
  surrenderValuePercent: Number(terms.surrenderValueBps) / 100,
  maturityBonusBps: Number(terms.maturityBonusBps),
  maturityBonusPercent: Number(terms.maturityBonusBps) / 100,
  minimumSurrenderInstallments: Number(terms.minimumSurrenderInstallments),
  version: Number(terms.version),
  termsHash: terms.termsHash,
});

const formatBenefitRequest = (request) => ({
  requestId: request.requestId.toString(),
  policyId: request.policyId.toString(),
  packageId: request.packageId.toString(),
  benefitType: {
    code: Number(request.benefitType),
    label: BENEFIT_TYPES[Number(request.benefitType)] || "UNKNOWN",
  },
  status: {
    code: Number(request.status),
    label: BENEFIT_STATUSES[Number(request.status)] || "UNKNOWN",
  },
  requester: request.requester,
  amountWei: request.amount.toString(),
  amountEth: ethers.formatEther(request.amount),
  evidenceHash: request.evidenceHash,
  decisionReasonHash: request.decisionReasonHash,
  termsVersion: Number(request.termsVersion),
  requestedAt: request.requestedAt.toString(),
  resolvedAt: request.resolvedAt.toString(),
  allocatedAt: request.allocatedAt.toString(),
});

const getPolicyBenefitsSnapshot = async (policy, walletAddress = "") => {
  const contract = getReadOnlyBenefitsContract();
  const policyId = policy.policyId.toString();
  const packageId = policy.packageId.toString();
  const [rawTerms, acceptedVersion, rawBeneficiaries, deathAmount, surrenderAmount, maturityAmount] =
    await Promise.all([
      contract.getAcceptedBenefitTerms(policyId),
      contract.acceptedTermsVersionByPolicy(policyId),
      contract.getBeneficiaries(policyId),
      contract.calculateBenefit(policyId, 0),
      contract.calculateBenefit(policyId, 1),
      contract.calculateBenefit(policyId, 2),
    ]);
  const claimableAmount = walletAddress
    ? await contract.claimableBenefitWei(walletAddress)
    : 0n;
  const requestIds = await Promise.all(
    [0, 1, 2].map((benefitType) =>
      contract.requestByPolicyAndType(policyId, benefitType)
    )
  );
  const requests = await Promise.all(
    requestIds
      .filter((requestId) => requestId > 0n)
      .map(async (requestId) =>
        formatBenefitRequest(await contract.getBenefitRequest(requestId))
      )
  );

  return {
    contractAddress: getBenefitsAddress(),
    acceptedTermsVersion: Number(acceptedVersion),
    termsAcceptanceRequired: Number(acceptedVersion) === 0,
    terms: formatTerms(rawTerms),
    beneficiaries: rawBeneficiaries.map((beneficiary) => ({
      account: beneficiary.account,
      shareBps: Number(beneficiary.shareBps),
      sharePercent: Number(beneficiary.shareBps) / 100,
    })),
    projections: {
      death: { wei: deathAmount.toString(), eth: ethers.formatEther(deathAmount) },
      surrender: {
        wei: surrenderAmount.toString(),
        eth: ethers.formatEther(surrenderAmount),
      },
      maturity: {
        wei: maturityAmount.toString(),
        eth: ethers.formatEther(maturityAmount),
      },
    },
    claimable: {
      wei: claimableAmount.toString(),
      eth: ethers.formatEther(claimableAmount),
    },
    requests,
  };
};

module.exports = {
  BENEFIT_STATUSES,
  BENEFIT_TYPES,
  formatBenefitRequest,
  formatTerms,
  getBenefitsAddress,
  getPolicyBenefitsSnapshot,
  getReadOnlyBenefitsContract,
};
