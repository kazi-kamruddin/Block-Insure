// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract InsuranceManager is AccessControl, Pausable, ReentrancyGuard {
    // =============================================================
    // Roles
    // =============================================================

    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    bytes32 public constant CLAIM_OFFICER_ROLE = keccak256("CLAIM_OFFICER_ROLE");
    bytes32 public constant ORACLE_ROLE = keccak256("ORACLE_ROLE");
    bytes32 public constant AUDITOR_ROLE = keccak256("AUDITOR_ROLE");

    // =============================================================
    // Structs
    // =============================================================

    struct PolicyPackage {
        uint256 packageId;
        string name;
        string policyType;
        uint256 premiumAmount;
        uint256 coverageAmount;
        uint256 durationDays;
        string requiredDocumentType;
        bool isActive;
    }

    struct Policy {
        uint256 policyId;
        uint256 packageId;
        address holderWallet;
        uint256 startDate;
        uint256 endDate;
        uint256 coverageAmount;
        uint256 premiumPaid;
        bool isActive;
    }

    // =============================================================
    // Storage
    // =============================================================

    uint256 public packageCounter = 1;
    uint256 public policyCounter = 1;

    mapping(uint256 => PolicyPackage) private policyPackages;
    mapping(uint256 => Policy) private policies;

    uint256[] private packageIds;

    mapping(address => uint256[]) private policiesByWallet;

    // =============================================================
    // Events
    // =============================================================

    event ContractPaused(address indexed pausedBy, uint256 timestamp);
    event ContractUnpaused(address indexed unpausedBy, uint256 timestamp);

    event PolicyPackageCreated(
        uint256 indexed packageId,
        string name,
        uint256 premiumAmount,
        uint256 coverageAmount
    );

    event PolicyPackageUpdated(
        uint256 indexed packageId,
        string name,
        uint256 premiumAmount,
        uint256 coverageAmount,
        uint256 durationDays
    );

    event PolicyPackageDeactivated(uint256 indexed packageId);
    event PolicyPackageReactivated(uint256 indexed packageId);

    event PolicyPurchased(
        uint256 indexed policyId,
        uint256 indexed packageId,
        address indexed holderWallet,
        uint256 coverageAmount,
        uint256 endDate
    );

    // =============================================================
    // Constructor
    // =============================================================

    constructor() {
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(ADMIN_ROLE, msg.sender);
    }

    // =============================================================
    // Role Management
    // =============================================================

    function grantProjectRole(bytes32 role, address account) external onlyRole(ADMIN_ROLE) {
        grantRole(role, account);
    }

    function revokeProjectRole(bytes32 role, address account) external onlyRole(ADMIN_ROLE) {
        revokeRole(role, account);
    }

    // =============================================================
    // Emergency Controls
    // =============================================================

    function pause() external onlyRole(ADMIN_ROLE) {
        _pause();
        emit ContractPaused(msg.sender, block.timestamp);
    }

    function unpause() external onlyRole(ADMIN_ROLE) {
        _unpause();
        emit ContractUnpaused(msg.sender, block.timestamp);
    }

    // =============================================================
    // Phase 3: Policy Package System
    // =============================================================

    function createPolicyPackage(
        string memory name,
        string memory policyType,
        uint256 premiumAmount,
        uint256 coverageAmount,
        uint256 durationDays,
        string memory requiredDocumentType
    ) external onlyRole(ADMIN_ROLE) returns (uint256) {
        require(bytes(name).length > 0, "Package name required");
        require(bytes(policyType).length > 0, "Policy type required");
        require(premiumAmount > 0, "Premium must be greater than zero");
        require(coverageAmount > 0, "Coverage must be greater than zero");
        require(durationDays > 0, "Duration must be greater than zero");
        require(bytes(requiredDocumentType).length > 0, "Required document type required");

        uint256 newPackageId = packageCounter;

        policyPackages[newPackageId] = PolicyPackage({
            packageId: newPackageId,
            name: name,
            policyType: policyType,
            premiumAmount: premiumAmount,
            coverageAmount: coverageAmount,
            durationDays: durationDays,
            requiredDocumentType: requiredDocumentType,
            isActive: true
        });

        packageIds.push(newPackageId);
        packageCounter++;

        emit PolicyPackageCreated(
            newPackageId,
            name,
            premiumAmount,
            coverageAmount
        );

        return newPackageId;
    }

    function updatePolicyPackage(
        uint256 packageId,
        string memory name,
        string memory policyType,
        uint256 premiumAmount,
        uint256 coverageAmount,
        uint256 durationDays,
        string memory requiredDocumentType
    ) external onlyRole(ADMIN_ROLE) {
        require(_packageExists(packageId), "Package does not exist");
        require(bytes(name).length > 0, "Package name required");
        require(bytes(policyType).length > 0, "Policy type required");
        require(premiumAmount > 0, "Premium must be greater than zero");
        require(coverageAmount > 0, "Coverage must be greater than zero");
        require(durationDays > 0, "Duration must be greater than zero");
        require(bytes(requiredDocumentType).length > 0, "Required document type required");

        PolicyPackage storage existingPackage = policyPackages[packageId];

        existingPackage.name = name;
        existingPackage.policyType = policyType;
        existingPackage.premiumAmount = premiumAmount;
        existingPackage.coverageAmount = coverageAmount;
        existingPackage.durationDays = durationDays;
        existingPackage.requiredDocumentType = requiredDocumentType;

        emit PolicyPackageUpdated(
            packageId,
            name,
            premiumAmount,
            coverageAmount,
            durationDays
        );
    }

    function deactivatePolicyPackage(uint256 packageId) external onlyRole(ADMIN_ROLE) {
        require(_packageExists(packageId), "Package does not exist");
        require(policyPackages[packageId].isActive, "Package already inactive");

        policyPackages[packageId].isActive = false;

        emit PolicyPackageDeactivated(packageId);
    }

    function reactivatePolicyPackage(uint256 packageId) external onlyRole(ADMIN_ROLE) {
        require(_packageExists(packageId), "Package does not exist");
        require(!policyPackages[packageId].isActive, "Package already active");

        policyPackages[packageId].isActive = true;

        emit PolicyPackageReactivated(packageId);
    }

    function getPolicyPackage(uint256 packageId) external view returns (PolicyPackage memory) {
        require(_packageExists(packageId), "Package does not exist");
        return policyPackages[packageId];
    }

    function getAllPackageIds() external view returns (uint256[] memory) {
        return packageIds;
    }

    function getActivePackageIds() external view returns (uint256[] memory) {
        uint256 activeCount = 0;

        for (uint256 i = 0; i < packageIds.length; i++) {
            if (policyPackages[packageIds[i]].isActive) {
                activeCount++;
            }
        }

        uint256[] memory activeIds = new uint256[](activeCount);
        uint256 currentIndex = 0;

        for (uint256 i = 0; i < packageIds.length; i++) {
            uint256 packageId = packageIds[i];

            if (policyPackages[packageId].isActive) {
                activeIds[currentIndex] = packageId;
                currentIndex++;
            }
        }

        return activeIds;
    }

    // =============================================================
    // Phase 4: Policy Purchase System
    // =============================================================

    function purchasePolicy(uint256 packageId) external payable whenNotPaused returns (uint256) {
        require(_packageExists(packageId), "Package does not exist");

        PolicyPackage memory selectedPackage = policyPackages[packageId];

        require(selectedPackage.isActive, "Package is not active");
        require(msg.value == selectedPackage.premiumAmount, "Incorrect premium amount");

        uint256 newPolicyId = policyCounter;
        uint256 startDate = block.timestamp;
        uint256 endDate = block.timestamp + (selectedPackage.durationDays * 1 days);

        policies[newPolicyId] = Policy({
            policyId: newPolicyId,
            packageId: packageId,
            holderWallet: msg.sender,
            startDate: startDate,
            endDate: endDate,
            coverageAmount: selectedPackage.coverageAmount,
            premiumPaid: msg.value,
            isActive: true
        });

        policiesByWallet[msg.sender].push(newPolicyId);
        policyCounter++;

        emit PolicyPurchased(
            newPolicyId,
            packageId,
            msg.sender,
            selectedPackage.coverageAmount,
            endDate
        );

        return newPolicyId;
    }

    function getPolicy(uint256 policyId) external view returns (Policy memory) {
        require(_policyExists(policyId), "Policy does not exist");
        return policies[policyId];
    }

    function getPoliciesByWallet(address wallet) external view returns (uint256[] memory) {
        return policiesByWallet[wallet];
    }

    function isPolicyActive(uint256 policyId) public view returns (bool) {
        require(_policyExists(policyId), "Policy does not exist");

        Policy memory selectedPolicy = policies[policyId];

        return selectedPolicy.isActive && block.timestamp <= selectedPolicy.endDate;
    }

    function getContractBalance() external view returns (uint256) {
        return address(this).balance;
    }

    receive() external payable {}

    // =============================================================
    // Internal Helpers
    // =============================================================

    function _packageExists(uint256 packageId) internal view returns (bool) {
        return policyPackages[packageId].packageId != 0;
    }

    function _policyExists(uint256 policyId) internal view returns (bool) {
        return policies[policyId].policyId != 0;
    }
}