// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

interface IClaimAdjudicator {
    struct ManualReview {
        address[4] auditors;
        uint8 approvals;
        uint8 rejections;
        uint64 deadline;
        bool finalized;
        bool approved;
    }

    struct DecisionRecord {
        uint64 claimVersion;
        uint8 appealRound;
        bool approved;
        uint8 rejectionReason;
        bytes32 decisionHash;
        uint64 decidedAt;
    }

    function manager() external view returns (address);
    function routingDelay() external view returns (uint64);
    function maxAppeals() external view returns (uint8);
    function setAuditor(address auditor, bool active) external;
    function updateConfig(uint64 reviewDuration, uint64 routingDelay) external;
    function updateMaxAppeals(uint8 newMaximum) external;
    function startReview(uint256 claimId, uint64 version) external returns (uint64);
    function castVote(uint256 claimId, uint64 version, address auditor, uint8 vote) external;
    function finalizeExpiredReview(uint256 claimId, uint64 version) external;
    function getReview(uint256 claimId, uint64 version) external view returns (ManualReview memory);
    function getVote(uint256 claimId, uint64 version, address auditor) external view returns (uint8);
    function getVotes(uint256 claimId, uint64 version)
        external
        view
        returns (address[4] memory, uint8[4] memory);
    function allocatePayout(
        uint256 claimId,
        uint64 version,
        address claimant,
        uint256 amount,
        bytes32 decisionHash
    ) external payable returns (bool);
    function fundPayout(uint256 claimId, address claimant) external payable;
    function withdrawPayout(uint256 claimId, address payable claimant) external returns (uint256);
    function recordRejection(
        uint256 claimId,
        uint64 version,
        uint8 rejectionReason,
        bytes32 decisionHash
    ) external;
    function beginAppeal(uint256 claimId, uint64 newVersion) external returns (uint8);
    function getDecision(uint256 claimId, uint64 version) external view returns (DecisionRecord memory);
    function allocatedSettlementWei(uint256 claimId) external view returns (uint256);
    function withdrawnSettlementWei(uint256 claimId) external view returns (uint256);
    function claimableSettlementWei(address claimant) external view returns (uint256);
    function totalOutstandingLiabilityWei() external view returns (uint256);
    function totalUnfundedLiabilityWei() external view returns (uint256);
    function appealRound(uint256 claimId) external view returns (uint8);
    function appealFinalized(uint256 claimId) external view returns (bool);
    function auditorReputation(address auditor) external view returns (uint256);
    function auditorTotalVotes(address auditor) external view returns (uint256);
    function auditorSuccessfulOutcomes(address auditor) external view returns (uint256);
    function auditorFailedOutcomes(address auditor) external view returns (uint256);
}
