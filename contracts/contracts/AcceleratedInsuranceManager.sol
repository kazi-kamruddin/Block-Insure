// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "./InsuranceManager.sol";

/// @notice Separately deployed, labelled demo profile; never mutates quarterly policies.
contract AcceleratedInsuranceManager is InsuranceManager {
    constructor() {
        require(block.chainid == 31337 || block.chainid == 11155111 || block.chainid == 84532, "Test networks only");
    }

    function _premiumIntervalSeconds() internal pure override returns (uint256) { return 10 minutes; }
    function _gracePeriodSeconds() internal pure override returns (uint256) { return 2 minutes; }
}
