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

    uint8 public constant VOTE_VALID = 1;
    uint8 public constant VOTE_INVALID = 2;
    uint8 public constant VOTE_NEEDS_MORE = 3;

    // =============================================================
    // Structs
    // =============================================================
    enum ClaimStatus {
        SUBMITTED,
        DUPLICATE_CHECKED,
        FRAUD_FLAGGED,
        ORACLE_PENDING,
        ORACLE_VERIFIED,
        ORACLE_FAILED,
        MANUAL_REVIEW,
        APPROVED,
        REJECTED,
        SETTLED,
        CLOSED
    }    

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

    struct Claim {
        uint256 claimId;
        uint256 policyId;
        address claimantWallet;
        uint256 claimAmount;
        uint256 incidentDate;
        string claimType;
        string hospitalId;
        bytes32 invoiceHash;
        bytes32 documentHash;
        string documentCID;
        ClaimStatus status;
        uint256 riskScore;
        uint256 submittedAt;
    }

    struct ClaimDocument {
        bytes32 documentHash;
        string documentCID;
        uint256 uploadedAt;
        string documentType;
    }

    struct OracleRequest {
        uint256 requestId;
        uint256 claimId;
        string oracleType;
        bytes32 queryHash;
        uint256 requestedAt;
        bool isFulfilled;
        bool verifiedResult;
        bytes32 resultHash;
        string riskLevel;
        string remarks;
    }

    struct SettlementRecord {
        uint256 claimId;
        address recipient;
        uint256 amount;
        string settlementReference;
        uint256 settledAt;
        bool paidOnChain;
    }

    // =============================================================
    // Storage
    // =============================================================

    uint256 public packageCounter = 1;
    uint256 public policyCounter = 1;
    uint256 private adminRoleMemberCount = 1;

    mapping(uint256 => PolicyPackage) private policyPackages;
    mapping(uint256 => Policy) private policies;

    uint256[] private packageIds;

    mapping(address => uint256[]) private policiesByWallet;

    uint256 public claimCounter = 1;

    mapping(uint256 => Claim) private claims;
    mapping(uint256 => ClaimDocument[]) private claimDocuments;
    mapping(address => uint256[]) private claimsByWallet;
    mapping(uint256 => uint256) private claimBaseRiskScore;

    mapping(bytes32 => bool) private usedDocumentHashes;
    mapping(bytes32 => bool) private usedInvoiceHashes;
    mapping(address => mapping(uint256 => mapping(bytes32 => bool))) private userDateClaimTypeUsed;

    uint256 public oracleRequestCounter = 1;
    uint8 public oracleQuorumThreshold = 2;

    mapping(uint256 => OracleRequest) private oracleRequests;
    mapping(uint256 => uint256) private oracleRequestByClaimId;
    mapping(uint256 => uint8) public oracleConfirmationCount;
    mapping(uint256 => mapping(address => bool)) public oracleHasConfirmed;
    mapping(uint256 => bool[]) public oracleConfirmationResults;

    mapping(uint256 => bytes32) private claimRejectionReasonHash;
    mapping(uint256 => SettlementRecord) private settlementRecords;
    mapping(uint256 => bool) public claimAppealed;

    mapping(uint256 => mapping(address => uint8)) public auditorVotes;
    mapping(uint256 => address[]) public claimVoters;
    mapping(address => uint256) public auditorReputation;
    mapping(address => uint256) public auditorTotalVotes;
    mapping(address => bool) private auditorReputationInitialized;
    address[] private auditorMembers;
    mapping(address => bool) private auditorMemberTracked;

    bytes32 public registryMerkleRoot;
    uint256 public registrySnapshotTimestamp;
    uint256 public registrySnapshotBlock;

    uint256 public deductibleRateBps = 1000;
    uint256 public deductibleCapWei = 0.02 ether;
    uint256 public insurerShareBps = 8000;

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

    event ClaimSubmitted(
        uint256 indexed claimId,
        uint256 indexed policyId,
        address indexed claimantWallet,
        uint256 claimAmount
    );

    event DocumentAdded(
        uint256 indexed claimId,
        bytes32 documentHash,
        string documentCID
    );

    event ClaimFlagged(
        uint256 indexed claimId,
        string reason
    );

    event OracleRequested(
        uint256 indexed requestId,
        uint256 indexed claimId,
        string oracleType
    );

    event OracleResultSubmitted(
        uint256 indexed requestId,
        uint256 indexed claimId,
        bool verified,
        string riskLevel
    );

    event OracleConfirmationReceived(
        uint256 indexed requestId,
        uint256 indexed claimId,
        address indexed oracle,
        bool verified,
        uint8 confirmationCount
    );

    event ClaimApproved(
        uint256 indexed claimId,
        address indexed approvedBy,
        uint256 timestamp
    );

    event ClaimRejected(
        uint256 indexed claimId,
        address indexed rejectedBy,
        bytes32 reasonHash
    );

    event ClaimAppealed(
        uint256 indexed claimId,
        address indexed claimant,
        string appealReasonHash,
        uint256 timestamp
    );

    event ClaimReopenedAfterAppeal(
        uint256 indexed claimId,
        address indexed reopenedBy,
        uint256 timestamp
    );

    event ClaimSentToManualReview(
        uint256 indexed claimId,
        address indexed sentBy,
        uint256 timestamp
    );

    event AuditorVoteCast(
        uint256 indexed claimId,
        address indexed auditor,
        uint8 vote,
        uint256 timestamp
    );

    event AuditorReputationUpdated(
        address indexed auditor,
        uint256 newReputation,
        uint256 timestamp
    );

    event SettlementCalculated(
        uint256 indexed claimId,
        uint256 claimAmount,
        uint256 deductible,
        uint256 insurerPays,
        uint256 claimantResponsibility
    );

    event SettlementParamsUpdated(
        uint256 deductibleRateBps,
        uint256 deductibleCapWei,
        uint256 insurerShareBps,
        uint256 timestamp
    );

    event ClaimSettled(
        uint256 indexed claimId,
        address indexed claimantWallet,
        uint256 amount,
        uint256 timestamp
    );

    event ClaimSettledRecordOnly(
        uint256 indexed claimId,
        uint256 amount,
        string settlementReference,
        uint256 timestamp
    );

    event ContractFunded(
        address indexed fundedBy,
        uint256 amount
    );

    event ExcessWithdrawn(
        address indexed withdrawnBy,
        uint256 amount
    );

    event RegistryRootUpdated(
        bytes32 indexed newRoot,
        uint256 timestamp,
        uint256 blockNumber,
        address updatedBy
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
        _grantProjectRoleInternal(role, account);
    }

    function revokeProjectRole(bytes32 role, address account) external onlyRole(ADMIN_ROLE) {
        _revokeProjectRoleInternal(role, account);
    }

    function grantRole(bytes32 role, address account) public override onlyRole(ADMIN_ROLE) {
        _grantProjectRoleInternal(role, account);
    }

    function revokeRole(bytes32 role, address account) public override onlyRole(ADMIN_ROLE) {
        _revokeProjectRoleInternal(role, account);
    }

    function renounceRole(bytes32 role, address callerConfirmation) public override {
        require(callerConfirmation == msg.sender, "Can only renounce roles for self");
        require(role != DEFAULT_ADMIN_ROLE, "Cannot manage default admin role");

        if (role == ADMIN_ROLE && hasRole(ADMIN_ROLE, callerConfirmation)) {
            require(adminRoleMemberCount > 1, "Cannot revoke final admin");
            adminRoleMemberCount--;
        }

        _revokeRole(role, callerConfirmation);
    }

    function _grantProjectRoleInternal(bytes32 role, address account) internal {
        require(account != address(0), "Invalid account");
        require(role != DEFAULT_ADMIN_ROLE, "Cannot manage default admin role");

        if (role == ADMIN_ROLE && !hasRole(ADMIN_ROLE, account)) {
            adminRoleMemberCount++;
        }

        _grantRole(role, account);

        if (role == AUDITOR_ROLE && !auditorMemberTracked[account]) {
            auditorMemberTracked[account] = true;
            auditorMembers.push(account);
        }
    }

    function _revokeProjectRoleInternal(bytes32 role, address account) internal {
        require(account != address(0), "Invalid account");
        require(role != DEFAULT_ADMIN_ROLE, "Cannot manage default admin role");

        if (role == ADMIN_ROLE && hasRole(ADMIN_ROLE, account)) {
            require(adminRoleMemberCount > 1, "Cannot revoke final admin");
            adminRoleMemberCount--;
        }

        _revokeRole(role, account);
    }

    function getAuditors() external view returns (address[] memory) {
        uint256 activeCount = 0;

        for (uint256 i = 0; i < auditorMembers.length; i++) {
            if (hasRole(AUDITOR_ROLE, auditorMembers[i])) {
                activeCount++;
            }
        }

        address[] memory activeAuditors = new address[](activeCount);
        uint256 currentIndex = 0;

        for (uint256 i = 0; i < auditorMembers.length; i++) {
            address auditor = auditorMembers[i];

            if (hasRole(AUDITOR_ROLE, auditor)) {
                activeAuditors[currentIndex] = auditor;
                currentIndex++;
            }
        }

        return activeAuditors;
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

    // =============================================================
    // Registry Merkle Commitment
    // =============================================================

    function updateRegistryMerkleRoot(bytes32 _root) external onlyRole(ADMIN_ROLE) {
        registryMerkleRoot = _root;
        registrySnapshotTimestamp = block.timestamp;
        registrySnapshotBlock = block.number;

        emit RegistryRootUpdated(
            _root,
            block.timestamp,
            block.number,
            msg.sender
        );
    }

    function getRegistrySnapshot()
        external
        view
        returns (bytes32 root, uint256 timestamp, uint256 blockNumber)
    {
        return (
            registryMerkleRoot,
            registrySnapshotTimestamp,
            registrySnapshotBlock
        );
    }

    receive() external payable {
        emit ContractFunded(msg.sender, msg.value);
    }

    // =============================================================
    // Phase 5,6: Claim Submission System & fraud detection
    // =============================================================

    function submitClaim(
        uint256 policyId,
        uint256 claimAmount,
        uint256 incidentDate,
        string memory claimType,
        string memory hospitalId,
        bytes32 invoiceHash,
        bytes32 documentHash,
        string memory documentCID
    ) external whenNotPaused returns (uint256) {
        require(_policyExists(policyId), "Policy does not exist");

        Policy memory selectedPolicy = policies[policyId];

        require(selectedPolicy.holderWallet == msg.sender, "Caller is not policy holder");
        require(isPolicyActive(policyId), "Policy is not active");
        require(incidentDate >= selectedPolicy.startDate && incidentDate <= selectedPolicy.endDate, "Incident date outside policy period");
        require(incidentDate <= block.timestamp, "Incident date cannot be in the future");
        require(claimAmount > 0, "Claim amount must be greater than zero");
        require(claimAmount <= selectedPolicy.coverageAmount, "Claim amount exceeds coverage");
        require(bytes(claimType).length > 0, "Claim type required");
        require(bytes(hospitalId).length > 0, "Hospital ID required");
        require(invoiceHash != bytes32(0), "Invoice hash required");
        require(documentHash != bytes32(0), "Document hash required");
        require(bytes(documentCID).length > 0, "Document CID required");

        uint256 newClaimId = claimCounter;
        bytes32 claimTypeHash = keccak256(bytes(claimType));

        bool duplicateDocument = usedDocumentHashes[documentHash];
        bool duplicateInvoice = usedInvoiceHashes[invoiceHash];
        bool duplicateUserDateType = userDateClaimTypeUsed[msg.sender][incidentDate][claimTypeHash];

        bool isFraud = duplicateDocument || duplicateInvoice || duplicateUserDateType;

        claims[newClaimId] = Claim({
            claimId: newClaimId,
            policyId: policyId,
            claimantWallet: msg.sender,
            claimAmount: claimAmount,
            incidentDate: incidentDate,
            claimType: claimType,
            hospitalId: hospitalId,
            invoiceHash: invoiceHash,
            documentHash: documentHash,
            documentCID: documentCID,
            status: ClaimStatus.SUBMITTED,
            riskScore: 0,
            submittedAt: block.timestamp
        });

        claimDocuments[newClaimId].push(
            ClaimDocument({
                documentHash: documentHash,
                documentCID: documentCID,
                uploadedAt: block.timestamp,
                documentType: policyPackages[selectedPolicy.packageId].requiredDocumentType
            })
        );

        claimsByWallet[msg.sender].push(newClaimId);

        emit ClaimSubmitted(
            newClaimId,
            policyId,
            msg.sender,
            claimAmount
        );

        emit DocumentAdded(
            newClaimId,
            documentHash,
            documentCID
        );

        if (isFraud) {
            claims[newClaimId].status = ClaimStatus.FRAUD_FLAGGED;

            string memory reason = "Duplicate claim detected";

            if (duplicateDocument) {
                reason = "Duplicate document hash";
            } else if (duplicateInvoice) {
                reason = "Duplicate invoice hash";
            } else if (duplicateUserDateType) {
                reason = "Duplicate user date claim type";
            }

            claimCounter++;

            emit ClaimFlagged(newClaimId, reason);

            return newClaimId;
        }

        uint256 calculatedRiskScore = calculateRiskScore(newClaimId);

        usedDocumentHashes[documentHash] = true;
        usedInvoiceHashes[invoiceHash] = true;
        userDateClaimTypeUsed[msg.sender][incidentDate][claimTypeHash] = true;

        claims[newClaimId].riskScore = calculatedRiskScore;
        claimBaseRiskScore[newClaimId] = calculatedRiskScore;
        claims[newClaimId].status = ClaimStatus.DUPLICATE_CHECKED;

        claimCounter++;

        return newClaimId;
    }

    function getClaim(uint256 claimId) external view returns (Claim memory) {
        require(_claimExists(claimId), "Claim does not exist");
        return claims[claimId];
    }

    function getClaimDocuments(uint256 claimId) external view returns (ClaimDocument[] memory) {
        require(_claimExists(claimId), "Claim does not exist");
        return claimDocuments[claimId];
    }

    function getClaimsByWallet(address wallet) external view returns (uint256[] memory) {
        return claimsByWallet[wallet];
    }

    function getClaimStatus(uint256 claimId) external view returns (ClaimStatus) {
        require(_claimExists(claimId), "Claim does not exist");
        return claims[claimId].status;
    }

    function isFraudFlagged(uint256 claimId) external view returns (bool) {
        require(_claimExists(claimId), "Claim does not exist");
        return claims[claimId].status == ClaimStatus.FRAUD_FLAGGED;
    }

    // =============================================================
    // Phase 7: Risk Score Logic
    // =============================================================

    function calculateRiskScore(uint256 claimId) internal view returns (uint256) {
        Claim memory selectedClaim = claims[claimId];
        Policy memory selectedPolicy = policies[selectedClaim.policyId];

        uint256 score = 0;

        if (selectedPolicy.isActive && block.timestamp <= selectedPolicy.endDate) {
            score += 15;
        }

        if (
            selectedClaim.incidentDate >= selectedPolicy.startDate &&
            selectedClaim.incidentDate <= selectedPolicy.endDate
        ) {
            score += 15;
        }

        if (
            selectedClaim.claimAmount > 0 &&
            selectedClaim.claimAmount <= selectedPolicy.coverageAmount
        ) {
            score += 15;
        }

        if (
            selectedClaim.documentHash != bytes32(0) &&
            bytes(selectedClaim.documentCID).length > 0
        ) {
            score += 15;
        }

        if (!usedDocumentHashes[selectedClaim.documentHash]) {
            score += 10;
        }

        if (!usedInvoiceHashes[selectedClaim.invoiceHash]) {
            score += 10;
        }

        bytes32 claimTypeHash = keccak256(bytes(selectedClaim.claimType));

        if (
            !userDateClaimTypeUsed[
                selectedClaim.claimantWallet
            ][
                selectedClaim.incidentDate
            ][
                claimTypeHash
            ]
        ) {
            score += 10;
        }

        return _capRiskScore(score);
    }

    function getRiskScore(uint256 claimId) external view returns (uint256) {
        require(_claimExists(claimId), "Claim does not exist");
        return claims[claimId].riskScore;
    }

    function getRiskLevel(uint256 claimId) external view returns (string memory) {
        require(_claimExists(claimId), "Claim does not exist");

        if (claims[claimId].status == ClaimStatus.FRAUD_FLAGGED) {
            return "FRAUD_FLAGGED";
        }

        if (claims[claimId].status == ClaimStatus.ORACLE_FAILED) {
            return "ORACLE_FAILED";
        }

        uint256 score = claims[claimId].riskScore;

        if (score >= 80) {
            return "LOW";
        }

        if (score >= 50) {
            return "MEDIUM";
        }

        return "HIGH";
    }

    function _addOracleVerificationScore(uint256 claimId) internal {
        claims[claimId].riskScore = _capRiskScore(claims[claimId].riskScore + 25);
    }

    function _capRiskScore(uint256 score) internal pure returns (uint256) {
        if (score > 100) {
            return 100;
        }

        return score;
    }

    // =============================================================
    // Phase 8: Oracle Contract Logic
    // =============================================================

    function requestOracleVerification(uint256 claimId) external returns (uint256) {
        require(
            hasRole(ADMIN_ROLE, msg.sender) || hasRole(CLAIM_OFFICER_ROLE, msg.sender),
            "Caller is not admin or claim officer"
        );

        require(_claimExists(claimId), "Claim does not exist");
        require(claims[claimId].status == ClaimStatus.DUPLICATE_CHECKED, "Claim is not ready for oracle");
        require(oracleRequestByClaimId[claimId] == 0, "Oracle request already exists");

        Claim memory selectedClaim = claims[claimId];

        string memory oracleType = "HOSPITAL";

        bytes32 queryHash = keccak256(
            abi.encodePacked(
                selectedClaim.claimId,
                selectedClaim.policyId,
                selectedClaim.claimantWallet,
                selectedClaim.hospitalId,
                selectedClaim.invoiceHash,
                selectedClaim.documentHash
            )
        );

        uint256 newRequestId = oracleRequestCounter;

        oracleRequests[newRequestId] = OracleRequest({
            requestId: newRequestId,
            claimId: claimId,
            oracleType: oracleType,
            queryHash: queryHash,
            requestedAt: block.timestamp,
            isFulfilled: false,
            verifiedResult: false,
            resultHash: bytes32(0),
            riskLevel: "",
            remarks: ""
        });

        oracleRequestByClaimId[claimId] = newRequestId;
        oracleRequestCounter++;

        claims[claimId].status = ClaimStatus.ORACLE_PENDING;

        emit OracleRequested(newRequestId, claimId, oracleType);

        return newRequestId;
    }

    function submitOracleResult(
        uint256 requestId,
        bool verified,
        bytes32 resultHash,
        string memory riskLevel,
        string memory remarks
    ) external onlyRole(ORACLE_ROLE) {
        require(_oracleRequestExists(requestId), "Oracle request does not exist");
        require(!oracleHasConfirmed[requestId][msg.sender], "Oracle already confirmed");
        require(!oracleRequests[requestId].isFulfilled, "Oracle request already fulfilled");
        require(resultHash != bytes32(0), "Result hash required");
        require(bytes(riskLevel).length > 0, "Risk level required");
        require(bytes(remarks).length > 0, "Remarks required");

        OracleRequest storage requestData = oracleRequests[requestId];

        uint256 claimId = requestData.claimId;

        require(
            claims[claimId].status == ClaimStatus.ORACLE_PENDING,
            "Claim is not oracle pending"
        );

        oracleHasConfirmed[requestId][msg.sender] = true;
        oracleConfirmationResults[requestId].push(verified);
        oracleConfirmationCount[requestId]++;

        requestData.resultHash = resultHash;
        requestData.riskLevel = riskLevel;
        requestData.remarks = remarks;

        emit OracleConfirmationReceived(
            requestId,
            claimId,
            msg.sender,
            verified,
            oracleConfirmationCount[requestId]
        );

        if (oracleConfirmationCount[requestId] < oracleQuorumThreshold) {
            return;
        }

        uint256 verifiedCount = 0;
        uint256 failedCount = 0;
        bool[] storage confirmations = oracleConfirmationResults[requestId];

        for (uint256 i = 0; i < confirmations.length; i++) {
            if (confirmations[i]) {
                verifiedCount++;
            } else {
                failedCount++;
            }
        }

        bool finalVerified = verifiedCount > failedCount;

        requestData.isFulfilled = true;
        requestData.verifiedResult = finalVerified;

        if (finalVerified) {
            claims[claimId].status = ClaimStatus.ORACLE_VERIFIED;
            _addOracleVerificationScore(claimId);
        } else {
            claims[claimId].status = ClaimStatus.ORACLE_FAILED;
        }

        emit OracleResultSubmitted(
            requestId,
            claimId,
            finalVerified,
            riskLevel
        );
    }

    function updateQuorumThreshold(uint8 threshold) external onlyRole(ADMIN_ROLE) {
        require(threshold >= 1, "Quorum threshold must be at least 1");

        oracleQuorumThreshold = threshold;
    }

    function getOracleConfirmationStatus(uint256 requestId)
        external
        view
        returns (uint8 confirmations, uint8 required, bool finalized)
    {
        require(_oracleRequestExists(requestId), "Oracle request does not exist");

        return (
            oracleConfirmationCount[requestId],
            oracleQuorumThreshold,
            oracleRequests[requestId].isFulfilled
        );
    }

    function getOracleRequest(uint256 requestId) external view returns (OracleRequest memory) {
        require(_oracleRequestExists(requestId), "Oracle request does not exist");
        return oracleRequests[requestId];
    }

    function getOracleRequestByClaimId(uint256 claimId) external view returns (OracleRequest memory) {
        require(_claimExists(claimId), "Claim does not exist");

        uint256 requestId = oracleRequestByClaimId[claimId];

        require(requestId != 0, "Oracle request does not exist");

        return oracleRequests[requestId];
    }

    // =============================================================
    // Phase 9: Admin Decision and Settlement
    // =============================================================

    function approveClaim(uint256 claimId) external {
        require(
            hasRole(ADMIN_ROLE, msg.sender) || hasRole(CLAIM_OFFICER_ROLE, msg.sender),
            "Caller is not admin or claim officer"
        );
        require(_claimExists(claimId), "Claim does not exist");
        require(
            claims[claimId].status == ClaimStatus.ORACLE_VERIFIED ||
                claims[claimId].status == ClaimStatus.MANUAL_REVIEW,
            "Claim is not approvable"
        );

        claims[claimId].status = ClaimStatus.APPROVED;

        emit ClaimApproved(claimId, msg.sender, block.timestamp);
    }

    function rejectClaim(uint256 claimId, bytes32 reasonHash) external {
        require(
            hasRole(ADMIN_ROLE, msg.sender) || hasRole(CLAIM_OFFICER_ROLE, msg.sender),
            "Caller is not admin or claim officer"
        );
        require(_claimExists(claimId), "Claim does not exist");
        require(reasonHash != bytes32(0), "Reason hash required");
        require(claims[claimId].status != ClaimStatus.SETTLED, "Claim already settled");
        require(claims[claimId].status != ClaimStatus.CLOSED, "Claim already closed");

        claims[claimId].status = ClaimStatus.REJECTED;
        claimRejectionReasonHash[claimId] = reasonHash;

        emit ClaimRejected(claimId, msg.sender, reasonHash);
    }

    function submitAppeal(uint256 claimId, string calldata appealReasonHash) external {
        require(_claimExists(claimId), "Claim does not exist");
        require(claims[claimId].claimantWallet == msg.sender, "Caller is not claimant");
        require(claims[claimId].status == ClaimStatus.REJECTED, "Claim is not rejected");
        require(!claimAppealed[claimId], "Claim already appealed");
        require(bytes(appealReasonHash).length > 0, "Appeal reason hash required");

        claimAppealed[claimId] = true;

        emit ClaimAppealed(claimId, msg.sender, appealReasonHash, block.timestamp);
    }

    function reopenClaimAfterAppeal(uint256 claimId) external onlyRole(ADMIN_ROLE) {
        require(_claimExists(claimId), "Claim does not exist");
        require(claimAppealed[claimId], "Claim has not been appealed");
        require(claims[claimId].status == ClaimStatus.REJECTED, "Claim is not rejected");

        address[] storage existingVoters = claimVoters[claimId];

        for (uint256 i = 0; i < existingVoters.length; i++) {
            delete auditorVotes[claimId][existingVoters[i]];
        }

        delete claimVoters[claimId];
        delete claimRejectionReasonHash[claimId];
        oracleRequestByClaimId[claimId] = 0;
        claims[claimId].riskScore = claimBaseRiskScore[claimId];
        claims[claimId].status = ClaimStatus.DUPLICATE_CHECKED;

        emit ClaimReopenedAfterAppeal(claimId, msg.sender, block.timestamp);
    }

    function castVote(uint256 claimId, uint8 vote) external onlyRole(AUDITOR_ROLE) {
        require(_claimExists(claimId), "Claim does not exist");
        require(
            vote == VOTE_VALID ||
                vote == VOTE_INVALID ||
                vote == VOTE_NEEDS_MORE,
            "Invalid vote"
        );
        require(auditorVotes[claimId][msg.sender] == 0, "Auditor already voted");
        require(
            claims[claimId].status == ClaimStatus.MANUAL_REVIEW ||
                claims[claimId].status == ClaimStatus.ORACLE_FAILED,
            "Claim is not open for auditor voting"
        );

        if (!auditorReputationInitialized[msg.sender]) {
            auditorReputation[msg.sender] = 50;
            auditorReputationInitialized[msg.sender] = true;
        }

        auditorVotes[claimId][msg.sender] = vote;
        claimVoters[claimId].push(msg.sender);
        auditorTotalVotes[msg.sender]++;

        emit AuditorVoteCast(claimId, msg.sender, vote, block.timestamp);
    }

    function updateAuditorReputation(address auditor, uint256 newScore) external onlyRole(ADMIN_ROLE) {
        require(auditor != address(0), "Invalid auditor");
        require(newScore <= 100, "Reputation exceeds maximum");

        auditorReputation[auditor] = newScore;
        auditorReputationInitialized[auditor] = true;

        emit AuditorReputationUpdated(auditor, newScore, block.timestamp);
    }

    function getClaimVotes(uint256 claimId)
        external
        view
        returns (
            address[] memory voters,
            uint8[] memory votes,
            uint256[] memory reputations
        )
    {
        require(_claimExists(claimId), "Claim does not exist");

        address[] memory currentVoters = claimVoters[claimId];
        uint8[] memory currentVotes = new uint8[](currentVoters.length);
        uint256[] memory currentReputations = new uint256[](currentVoters.length);

        for (uint256 i = 0; i < currentVoters.length; i++) {
            address voter = currentVoters[i];

            currentVotes[i] = auditorVotes[claimId][voter];
            currentReputations[i] = auditorReputation[voter];
        }

        return (currentVoters, currentVotes, currentReputations);
    }

    function sendToManualReview(uint256 claimId) external {
        require(
            hasRole(ADMIN_ROLE, msg.sender) || hasRole(CLAIM_OFFICER_ROLE, msg.sender),
            "Caller is not admin or claim officer"
        );
        require(_claimExists(claimId), "Claim does not exist");
        require(
            claims[claimId].status == ClaimStatus.FRAUD_FLAGGED ||
                claims[claimId].status == ClaimStatus.ORACLE_FAILED,
            "Claim cannot be sent to manual review"
        );

        claims[claimId].status = ClaimStatus.MANUAL_REVIEW;

        emit ClaimSentToManualReview(claimId, msg.sender, block.timestamp);
    }

    function calculateSettlement(uint256 claimId)
        public
        view
        returns (
            uint256 claimAmount,
            uint256 deductible,
            uint256 afterDeductible,
            uint256 insurerPays,
            uint256 claimantResponsibility
        )
    {
        require(_claimExists(claimId), "Claim does not exist");

        claimAmount = claims[claimId].claimAmount;

        uint256 rateDeductible = (claimAmount * deductibleRateBps) / 10000;
        deductible = rateDeductible < deductibleCapWei
            ? rateDeductible
            : deductibleCapWei;

        if (deductible > claimAmount) {
            deductible = claimAmount;
        }

        afterDeductible = claimAmount - deductible;
        insurerPays = (afterDeductible * insurerShareBps) / 10000;
        claimantResponsibility = claimAmount - insurerPays;
    }

    function updateSettlementParams(
        uint256 _deductibleRateBps,
        uint256 _deductibleCapWei,
        uint256 _insurerShareBps
    ) external onlyRole(ADMIN_ROLE) {
        require(_deductibleRateBps <= 10000, "Deductible rate exceeds maximum");
        require(_insurerShareBps <= 10000, "Insurer share exceeds maximum");

        deductibleRateBps = _deductibleRateBps;
        deductibleCapWei = _deductibleCapWei;
        insurerShareBps = _insurerShareBps;

        emit SettlementParamsUpdated(
            _deductibleRateBps,
            _deductibleCapWei,
            _insurerShareBps,
            block.timestamp
        );
    }

    function settleClaim(uint256 claimId) external nonReentrant onlyRole(ADMIN_ROLE) {
        require(_claimExists(claimId), "Claim does not exist");
        require(claims[claimId].status == ClaimStatus.APPROVED, "Claim is not approved");
        require(settlementRecords[claimId].settledAt == 0, "Claim already settled");

        (
            uint256 claimAmount,
            uint256 deductible,
            ,
            uint256 insurerPays,
            uint256 claimantResponsibility
        ) = calculateSettlement(claimId);

        require(address(this).balance >= insurerPays, "Insufficient contract balance");

        address recipient = claims[claimId].claimantWallet;

        claims[claimId].status = ClaimStatus.SETTLED;

        settlementRecords[claimId] = SettlementRecord({
            claimId: claimId,
            recipient: recipient,
            amount: insurerPays,
            settlementReference: "",
            settledAt: block.timestamp,
            paidOnChain: true
        });

        emit SettlementCalculated(
            claimId,
            claimAmount,
            deductible,
            insurerPays,
            claimantResponsibility
        );

        (bool success, ) = payable(recipient).call{value: insurerPays}("");
        require(success, "Settlement transfer failed");

        emit ClaimSettled(claimId, recipient, insurerPays, block.timestamp);
    }

    function recordOnlySettlement(
        uint256 claimId,
        string memory settlementReference
    ) external onlyRole(ADMIN_ROLE) {
        require(_claimExists(claimId), "Claim does not exist");
        require(claims[claimId].status == ClaimStatus.APPROVED, "Claim is not approved");
        require(settlementRecords[claimId].settledAt == 0, "Claim already settled");
        require(bytes(settlementReference).length > 0, "Settlement reference required");

        uint256 amount = claims[claimId].claimAmount;
        address recipient = claims[claimId].claimantWallet;

        claims[claimId].status = ClaimStatus.SETTLED;

        settlementRecords[claimId] = SettlementRecord({
            claimId: claimId,
            recipient: recipient,
            amount: amount,
            settlementReference: settlementReference,
            settledAt: block.timestamp,
            paidOnChain: false
        });

        emit ClaimSettledRecordOnly(
            claimId,
            amount,
            settlementReference,
            block.timestamp
        );
    }

    function fundContract() external payable onlyRole(ADMIN_ROLE) {
        require(msg.value > 0, "Funding amount required");

        emit ContractFunded(msg.sender, msg.value);
    }

    function withdrawExcess(uint256 amount) external nonReentrant onlyRole(ADMIN_ROLE) {
        require(amount > 0, "Withdrawal amount required");
        require(address(this).balance >= amount, "Insufficient contract balance");

        (bool success, ) = payable(msg.sender).call{value: amount}("");
        require(success, "Withdrawal failed");

        emit ExcessWithdrawn(msg.sender, amount);
    }

    function getRejectionReasonHash(uint256 claimId) external view returns (bytes32) {
        require(_claimExists(claimId), "Claim does not exist");
        return claimRejectionReasonHash[claimId];
    }

    function getSettlementRecord(uint256 claimId) external view returns (SettlementRecord memory) {
        require(_claimExists(claimId), "Claim does not exist");
        require(settlementRecords[claimId].settledAt != 0, "Settlement does not exist");

        return settlementRecords[claimId];
    }

    // =============================================================
    // Internal Helpers
    // =============================================================

    function _packageExists(uint256 packageId) internal view returns (bool) {
        return policyPackages[packageId].packageId != 0;
    }

    function _policyExists(uint256 policyId) internal view returns (bool) {
        return policies[policyId].policyId != 0;
    }

    function _claimExists(uint256 claimId) internal view returns (bool) {
        return claims[claimId].claimId != 0;
    }

    function _oracleRequestExists(uint256 requestId) internal view returns (bool) {
        return oracleRequests[requestId].requestId != 0;
    }


}
