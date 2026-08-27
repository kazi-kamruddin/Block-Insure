// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

interface IPolicyEconomics {
    function manager() external view returns (address);

    function recordPolicy(
        uint256 policyId,
        uint256 packageId,
        address holder,
        uint64 startsAt,
        uint64 endsAt,
        uint64 paidThrough,
        uint256 coverageLimitWei,
        uint256 premiumWei,
        bytes32 requiredDocumentType,
        uint16 deductibleRateBps,
        uint128 deductibleCapWei,
        uint16 insurerShareBps
    ) external;

    function recordPremium(
        uint256 policyId,
        uint64 previousPaidThrough,
        uint64 paidAt,
        uint64 newPaidThrough
    ) external;

    function closeCoverage(uint256 policyId, uint64 closesAt) external;

    function validateAndReserveClaim(
        uint256 claimId,
        uint256 policyId,
        address claimant,
        uint256 claimAmountWei,
        uint64 incidentAt,
        bytes32 serviceCode,
        bytes32 invoiceId,
        uint16 documentCommitmentCount
    ) external returns (uint256 insurerLiabilityWei);

    function reserveAppeal(uint256 claimId) external;
    function releaseClaim(uint256 claimId) external;
    function settleClaim(uint256 claimId) external;

    function calculateSettlement(uint256 claimId)
        external
        view
        returns (
            uint256 claimAmount,
            uint256 deductible,
            uint256 afterDeductible,
            uint256 insurerPays,
            uint256 claimantResponsibility
        );

    function minimumTreasuryBalance(uint256 approvedUnfundedLiabilityWei)
        external
        view
        returns (uint256);
}
