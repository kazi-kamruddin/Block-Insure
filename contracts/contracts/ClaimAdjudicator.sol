// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IClaimAdjudicationManager {
    function hasRole(bytes32 role, address account) external view returns (bool);
    function finalizeManualReview(
        uint256 claimId,
        uint64 claimVersion,
        bool approved,
        uint8 reasonCode
    ) external;
}

contract ClaimAdjudicator is ReentrancyGuard {
    bytes32 private constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    uint8 public constant VOTE_VALID = 1;
    uint8 public constant VOTE_INVALID = 2;
    uint8 public constant REVIEW_APPROVED = 4;
    uint8 public constant REVIEW_REJECTED = 5;
    uint8 public constant REVIEW_TIMED_OUT = 6;

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

    address public immutable manager;
    uint64 public reviewDuration = 3 days;
    uint64 public routingDelay = 2 days;
    uint8 public maxAppeals = 1;

    address[] private activeAuditors;
    mapping(address => bool) public isActiveAuditor;
    mapping(address => uint256) private activeAuditorIndexPlusOne;
    mapping(bytes32 => ManualReview) private reviews;
    mapping(bytes32 => mapping(address => uint8)) private votes;
    mapping(uint256 => uint256) public allocatedSettlementWei;
    mapping(uint256 => uint256) public withdrawnSettlementWei;
    mapping(uint256 => bool) public fundedSettlement;
    mapping(address => uint256) public claimableSettlementWei;
    uint256 public totalOutstandingLiabilityWei;
    uint256 public totalUnfundedLiabilityWei;
    mapping(uint256 => uint8) public appealRound;
    mapping(uint256 => bool) public appealFinalized;
    mapping(uint256 => mapping(uint64 => DecisionRecord)) private decisions;
    mapping(address => uint256) public auditorReputation;
    mapping(address => uint256) public auditorTotalVotes;
    mapping(address => uint256) public auditorSuccessfulOutcomes;
    mapping(address => uint256) public auditorFailedOutcomes;

    event AuditorRegistrationUpdated(address indexed auditor, bool active);
    event ReviewConfigUpdated(uint64 reviewDuration, uint64 routingDelay);
    event ManualReviewOpened(
        uint256 indexed claimId,
        uint64 indexed claimVersion,
        address[4] auditors,
        uint64 deadline
    );
    event AuditorVoteCast(
        uint256 indexed claimId,
        uint64 indexed claimVersion,
        address indexed auditor,
        uint8 vote,
        uint8 approvals,
        uint8 rejections
    );
    event ManualReviewFinalized(
        uint256 indexed claimId,
        uint64 indexed claimVersion,
        bool approved,
        uint8 reasonCode
    );
    event PayoutRecorded(
        uint256 indexed claimId,
        address indexed claimant,
        uint256 amount,
        bool funded
    );
    event PayoutFunded(uint256 indexed claimId, uint256 amount);
    event PayoutWithdrawn(uint256 indexed claimId, address indexed claimant, uint256 amount);
    event DecisionRecorded(
        uint256 indexed claimId,
        uint64 indexed claimVersion,
        bool approved,
        uint8 rejectionReason,
        bytes32 decisionHash
    );
    event AppealStarted(uint256 indexed claimId, uint8 appealRound, uint64 newClaimVersion);
    event AuditorReputationObserved(
        bytes32 indexed observationId,
        address indexed auditor,
        bool successful,
        uint256 betaMean
    );

    modifier onlyManager() {
        require(msg.sender == manager, "Caller is not manager");
        _;
    }

    modifier onlyManagerAdmin() {
        require(
            IClaimAdjudicationManager(manager).hasRole(ADMIN_ROLE, msg.sender),
            "Caller is not manager admin"
        );
        _;
    }

    constructor(address managerAddress) {
        require(managerAddress != address(0), "Invalid manager");
        manager = managerAddress;
    }

    function setAuditor(address auditor, bool active) external onlyManager {
        require(auditor != address(0), "Invalid auditor");
        if (active == isActiveAuditor[auditor]) return;

        isActiveAuditor[auditor] = active;
        if (active) {
            activeAuditors.push(auditor);
            activeAuditorIndexPlusOne[auditor] = activeAuditors.length;
        } else {
            uint256 index = activeAuditorIndexPlusOne[auditor] - 1;
            uint256 lastIndex = activeAuditors.length - 1;
            if (index != lastIndex) {
                address moved = activeAuditors[lastIndex];
                activeAuditors[index] = moved;
                activeAuditorIndexPlusOne[moved] = index + 1;
            }
            activeAuditors.pop();
            delete activeAuditorIndexPlusOne[auditor];
        }

        emit AuditorRegistrationUpdated(auditor, active);
    }

    function updateConfig(uint64 newReviewDuration, uint64 newRoutingDelay) external onlyManagerAdmin {
        require(newReviewDuration > 0, "Review duration required");
        reviewDuration = newReviewDuration;
        routingDelay = newRoutingDelay;
        emit ReviewConfigUpdated(newReviewDuration, newRoutingDelay);
    }

    function updateMaxAppeals(uint8 newMaximum) external onlyManagerAdmin {
        require(newMaximum > 0, "Maximum appeals required");
        maxAppeals = newMaximum;
    }

    function getActiveAuditors() external view returns (address[] memory) {
        return activeAuditors;
    }

    function startReview(uint256 claimId, uint64 version)
        external
        onlyManager
        returns (uint64 deadline)
    {
        bytes32 key = reviewKey(claimId, version);
        ManualReview storage review = reviews[key];
        require(review.deadline == 0, "Review already exists");
        require(activeAuditors.length >= 4, "Four active auditors required");

        address[4] memory selected;
        uint256 offset = uint256(keccak256(abi.encode(claimId, version))) % activeAuditors.length;
        for (uint256 i = 0; i < 4; i++) {
            selected[i] = activeAuditors[(offset + i) % activeAuditors.length];
            review.auditors[i] = selected[i];
        }

        deadline = uint64(block.timestamp) + reviewDuration;
        review.deadline = deadline;
        emit ManualReviewOpened(claimId, version, selected, deadline);
    }

    function castVote(
        uint256 claimId,
        uint64 version,
        address auditor,
        uint8 vote
    ) external onlyManager {
        require(vote == VOTE_VALID || vote == VOTE_INVALID, "Invalid vote");
        bytes32 key = reviewKey(claimId, version);
        ManualReview storage review = reviews[key];
        require(review.deadline != 0, "Review does not exist");
        require(!review.finalized, "Review finalized");
        require(block.timestamp <= review.deadline, "Review deadline passed");
        require(_isAssigned(review, auditor), "Auditor is not assigned");
        require(votes[key][auditor] == 0, "Auditor already voted");

        votes[key][auditor] = vote;
        auditorTotalVotes[auditor]++;
        if (vote == VOTE_VALID) review.approvals++;
        else review.rejections++;

        emit AuditorVoteCast(
            claimId,
            version,
            auditor,
            vote,
            review.approvals,
            review.rejections
        );

        if (review.approvals == 3) {
            _finalize(claimId, version, review, true, REVIEW_APPROVED);
        } else if (review.rejections == 2) {
            _finalize(claimId, version, review, false, REVIEW_REJECTED);
        }
    }

    function finalizeExpiredReview(uint256 claimId, uint64 version) external onlyManager {
        ManualReview storage review = reviews[reviewKey(claimId, version)];
        require(review.deadline != 0, "Review does not exist");
        require(!review.finalized, "Review finalized");
        require(block.timestamp > review.deadline, "Review deadline active");
        _finalize(claimId, version, review, false, REVIEW_TIMED_OUT);
    }

    function getReview(uint256 claimId, uint64 version)
        external
        view
        returns (ManualReview memory)
    {
        return reviews[reviewKey(claimId, version)];
    }

    function getVote(uint256 claimId, uint64 version, address auditor)
        external
        view
        returns (uint8)
    {
        return votes[reviewKey(claimId, version)][auditor];
    }

    function getVotes(uint256 claimId, uint64 version)
        external
        view
        returns (address[4] memory auditors, uint8[4] memory reviewVotes)
    {
        ManualReview storage review = reviews[reviewKey(claimId, version)];
        auditors = review.auditors;
        for (uint256 i = 0; i < 4; i++) {
            reviewVotes[i] = votes[reviewKey(claimId, version)][auditors[i]];
        }
    }

    function isAssigned(uint256 claimId, uint64 version, address auditor)
        external
        view
        returns (bool)
    {
        return _isAssigned(reviews[reviewKey(claimId, version)], auditor);
    }

    function allocatePayout(
        uint256 claimId,
        uint64 version,
        address claimant,
        uint256 amount,
        bytes32 decisionHash
    ) external payable onlyManager returns (bool funded) {
        require(claimant != address(0) && amount > 0, "Invalid payout");
        require(allocatedSettlementWei[claimId] == 0, "Payout already allocated");
        require(msg.value == 0 || msg.value == amount, "Invalid payout funding");

        allocatedSettlementWei[claimId] = amount;
        totalOutstandingLiabilityWei += amount;
        funded = msg.value == amount;
        fundedSettlement[claimId] = funded;
        if (funded) claimableSettlementWei[claimant] += amount;
        else totalUnfundedLiabilityWei += amount;
        _recordDecision(claimId, version, true, 0, decisionHash);
        emit PayoutRecorded(claimId, claimant, amount, funded);
    }

    function fundPayout(uint256 claimId, address claimant)
        external
        payable
        onlyManager
    {
        uint256 amount = allocatedSettlementWei[claimId];
        require(amount > 0 && !fundedSettlement[claimId], "Payout does not need funding");
        require(msg.value == amount, "Incorrect funding amount");
        fundedSettlement[claimId] = true;
        totalUnfundedLiabilityWei -= amount;
        claimableSettlementWei[claimant] += amount;
        emit PayoutFunded(claimId, amount);
    }

    function withdrawPayout(uint256 claimId, address payable claimant)
        external
        onlyManager
        nonReentrant
        returns (uint256 amount)
    {
        amount = allocatedSettlementWei[claimId];
        require(amount > 0 && fundedSettlement[claimId], "Payout is not funded");
        require(withdrawnSettlementWei[claimId] == 0, "Payout already withdrawn");
        withdrawnSettlementWei[claimId] = amount;
        claimableSettlementWei[claimant] -= amount;
        totalOutstandingLiabilityWei -= amount;
        (bool success, ) = claimant.call{value: amount}("");
        require(success, "Settlement transfer failed");
        emit PayoutWithdrawn(claimId, claimant, amount);
    }

    function recordRejection(
        uint256 claimId,
        uint64 version,
        uint8 rejectionReason,
        bytes32 decisionHash
    ) external onlyManager {
        require(rejectionReason != 0, "Rejection reason required");
        _recordDecision(claimId, version, false, rejectionReason, decisionHash);
    }

    function beginAppeal(uint256 claimId, uint64 newVersion)
        external
        onlyManager
        returns (uint8 round)
    {
        require(appealRound[claimId] < maxAppeals, "Maximum appeals reached");
        appealRound[claimId]++;
        round = appealRound[claimId];
        appealFinalized[claimId] = false;
        emit AppealStarted(claimId, round, newVersion);
    }

    function getDecision(uint256 claimId, uint64 version)
        external
        view
        returns (DecisionRecord memory)
    {
        return decisions[claimId][version];
    }

    function reviewKey(uint256 claimId, uint64 version) public pure returns (bytes32) {
        return keccak256(abi.encode(claimId, version));
    }

    function _isAssigned(ManualReview storage review, address auditor)
        private
        view
        returns (bool)
    {
        for (uint256 i = 0; i < 4; i++) {
            if (review.auditors[i] == auditor) return true;
        }
        return false;
    }

    function _finalize(
        uint256 claimId,
        uint64 version,
        ManualReview storage review,
        bool approved,
        uint8 reasonCode
    ) private {
        review.finalized = true;
        review.approved = approved;
        _recordAuditorObservations(claimId, version, review, approved);
        IClaimAdjudicationManager(manager).finalizeManualReview(
            claimId,
            version,
            approved,
            reasonCode
        );
        emit ManualReviewFinalized(claimId, version, approved, reasonCode);
    }

    function _recordDecision(
        uint256 claimId,
        uint64 version,
        bool approved,
        uint8 rejectionReason,
        bytes32 decisionHash
    ) private {
        require(decisions[claimId][version].decidedAt == 0, "Decision already recorded");
        decisions[claimId][version] = DecisionRecord({
            claimVersion: version,
            appealRound: appealRound[claimId],
            approved: approved,
            rejectionReason: rejectionReason,
            decisionHash: decisionHash,
            decidedAt: uint64(block.timestamp)
        });
        if (appealRound[claimId] > 0) appealFinalized[claimId] = true;
        emit DecisionRecorded(claimId, version, approved, rejectionReason, decisionHash);
    }

    function _recordAuditorObservations(
        uint256 claimId,
        uint64 version,
        ManualReview storage review,
        bool approved
    ) private {
        bytes32 key = reviewKey(claimId, version);
        for (uint256 i = 0; i < 4; i++) {
            address auditor = review.auditors[i];
            uint8 vote = votes[key][auditor];
            if (vote == 0) continue;
            bool successful = (vote == VOTE_VALID) == approved;
            if (successful) auditorSuccessfulOutcomes[auditor]++;
            else auditorFailedOutcomes[auditor]++;
            uint256 betaMean = ((auditorSuccessfulOutcomes[auditor] + 1) * 100) /
                (auditorSuccessfulOutcomes[auditor] + auditorFailedOutcomes[auditor] + 2);
            auditorReputation[auditor] = betaMean;
            emit AuditorReputationObserved(
                keccak256(abi.encode(claimId, version, auditor)),
                auditor,
                successful,
                betaMean
            );
        }
    }
}
