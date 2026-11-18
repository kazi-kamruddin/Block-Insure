// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;
import "./ClaimAdjudicator.sol";

import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

interface IClarificationManager {
    struct ClaimSnapshot {
        uint256 claimId;
        uint256 policyId;
        address claimantWallet;
        uint256 amount;
        uint256 incidentDate;
        string service;
        string hospitalId;
        bytes32 invoiceHash;
        bytes32 documentHash;
        string documentCID;
        uint8 status;
        uint256 verificationConfidence;
        uint256 submittedAt;
    }

    function getClaim(uint256 id) external view returns (ClaimSnapshot memory);
    function acceptClarification(uint256 id, uint256 amount) external;
    function claimVersion(uint256 id) external view returns (uint64);
    function manualReviewEligibleAt(uint256 id) external view returns (uint256);
}

contract ClaimAdjudicatorV6 is ClaimAdjudicator {
    mapping(uint256 => bool) public clarificationUsed;
    mapping(uint256 => mapping(uint64 => bytes32)) public clarificationEvidence;
    event ClaimClarified(uint256 indexed claimId, uint64 indexed version, bytes32 evidenceHash);

    function applyClarification(uint256 id, uint64 priorVersion, uint64 deadline, uint256 amount,
        bytes32 evidenceHash, bytes calldata authorization) external {
        require(!clarificationUsed[id] && block.timestamp <= deadline && evidenceHash != bytes32(0));
        IClarificationManager claims = IClarificationManager(manager);
        require(claims.getClaim(id).claimantWallet == msg.sender);
        require(claims.claimVersion(id) == priorVersion && deadline < claims.manualReviewEligibleAt(id));
        bytes32 digest = keccak256(abi.encode(block.chainid, address(this), msg.sender, id, priorVersion, deadline, amount, evidenceHash));
        address signer = ECDSA.recover(MessageHashUtils.toEthSignedMessageHash(digest), authorization);
        require(IClaimAdjudicationManager(manager).hasRole(keccak256("ADMIN_ROLE"), signer));
        clarificationUsed[id] = true;
        clarificationEvidence[id][priorVersion + 1] = evidenceHash;
        claims.acceptClarification(id, amount);
        emit ClaimClarified(id, priorVersion + 1, evidenceHash);
    }

    constructor(address managerAddress) ClaimAdjudicator(managerAddress) {}
    function reasonedVotingRequired() public pure override returns (bool) { return true; }
}
