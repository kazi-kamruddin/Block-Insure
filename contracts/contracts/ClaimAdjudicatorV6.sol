// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;
import "./ClaimAdjudicator.sol";

import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

interface IClarificationManager {
    function acceptClarification(uint256 id, uint64 priorVersion, address claimant, uint256 amount, bytes32 evidenceHash) external;
}

contract ClaimAdjudicatorV6 is ClaimAdjudicator {
    mapping(uint256 => bool) public clarificationUsed;
    mapping(uint256 => mapping(uint64 => bytes32)) public clarificationEvidence;
    function applyClarification(uint256 id, uint64 priorVersion, uint64 deadline, uint256 amount,
        bytes32 evidenceHash, bytes calldata authorization) external {
        require(!clarificationUsed[id] && block.timestamp <= deadline && evidenceHash != bytes32(0));
        bytes32 digest = keccak256(abi.encode(block.chainid, address(this), msg.sender, id, priorVersion, deadline, amount, evidenceHash));
        address signer = ECDSA.recover(MessageHashUtils.toEthSignedMessageHash(digest), authorization);
        require(IClaimAdjudicationManager(manager).hasRole(keccak256("ADMIN_ROLE"), signer));
        clarificationUsed[id] = true;
        clarificationEvidence[id][priorVersion + 1] = evidenceHash;
        IClarificationManager(manager).acceptClarification(id, priorVersion, msg.sender, amount, evidenceHash);
    }

    constructor(address managerAddress) ClaimAdjudicator(managerAddress) {}
    function reasonedVotingRequired() public pure override returns (bool) { return true; }
}
