module.exports = [
  "function requestCounter() view returns (uint256)",
  "function totalReservedLiabilityWei() view returns (uint256)",
  "function availableReserveWei() view returns (uint256)",
  "function getBenefitTerms(uint256 packageId) view returns (tuple(bool configured,bool deathBenefitEnabled,bool surrenderEnabled,bool maturityEnabled,uint16 deathBenefitBps,uint16 surrenderValueBps,uint16 maturityBonusBps,uint16 minimumSurrenderInstallments,uint32 version,bytes32 termsHash))",
  "function getBeneficiaries(uint256 policyId) view returns (tuple(address account,uint16 shareBps)[])",
  "function getBenefitRequest(uint256 requestId) view returns (tuple(uint256 requestId,uint256 policyId,uint256 packageId,uint8 benefitType,uint8 status,address requester,uint256 amount,bytes32 evidenceHash,bytes32 decisionReasonHash,uint32 termsVersion,uint256 requestedAt,uint256 resolvedAt,uint256 paidAt))",
  "function requestByPolicyAndType(uint256 policyId,uint8 benefitType) view returns (uint256)",
  "function calculateBenefit(uint256 policyId,uint8 benefitType) view returns (uint256)",
  "function publishBenefitTerms(uint256 packageId,bool deathBenefitEnabled,bool surrenderEnabled,bool maturityEnabled,uint16 deathBenefitBps,uint16 surrenderValueBps,uint16 maturityBonusBps,uint16 minimumSurrenderInstallments,uint32 version,bytes32 termsHash)",
  "function approveBenefit(uint256 requestId)",
  "function rejectBenefit(uint256 requestId,bytes32 reasonHash)",
  "function settleBenefit(uint256 requestId)",
];
