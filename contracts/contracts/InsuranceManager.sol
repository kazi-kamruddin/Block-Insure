// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "./OracleCoordinator.sol";
import "./interfaces/IClaimAdjudicator.sol";

contract InsuranceManager is AccessControl, Pausable, ReentrancyGuard {
    // =============================================================
    // Roles
    // =============================================================

    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    bytes32 public constant CLAIM_OFFICER_ROLE = keccak256("CLAIM_OFFICER_ROLE");
    bytes32 public constant ORACLE_ROLE = keccak256("ORACLE_ROLE");
    bytes32 public constant AUDITOR_ROLE = keccak256("AUDITOR_ROLE");
    bytes32 public constant EMERGENCY_ROLE = keccak256("EMERGENCY_ROLE");

    uint8 public constant VOTE_VALID = 1;
    uint8 public constant VOTE_INVALID = 2;

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
        PAYOUT_READY,
        REJECTED,
        SETTLED,
        CLOSED,
        FUNDING_REQUIRED,
        APPEALED
    }    

    enum PolicyStatus {
        PENDING_PAYMENT,
        ACTIVE,
        GRACE_PERIOD,
        LAPSED,
        CANCELLED,
        EXPIRED,
        RENEWED
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
        PolicyStatus status;
        uint256 premiumAmount;
        uint256 premiumInterval;
        uint256 nextPremiumDueDate;
        uint256 gracePeriodEnd;
        uint256 lastPaidTimestamp;
        uint256 totalPremiumPaid;
        uint256 installmentsPaid;
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

    struct SettlementRecord {
        uint256 claimId;
        address recipient;
        uint256 amount;
        uint256 settledAt;
    }

    enum RejectionReason {
        NONE,
        ORACLE_CONFLICT,
        ORACLE_TIMEOUT,
        ORACLE_INVALID,
        AUDITOR_QUORUM_REJECTED,
        REVIEW_TIMEOUT,
        INVALID_POLICY_RULE
    }

    // =============================================================
    // Storage
    // =============================================================

    uint256 public packageCounter = 1;
    uint256 public policyCounter = 1;
    uint256 private adminRoleMemberCount = 1;

    mapping(uint256 => PolicyPackage) private policyPackages;
    mapping(uint256 => Policy) private policies;

    uint256 public claimCounter = 1;

    mapping(uint256 => Claim) private claims;
    mapping(uint256 => ClaimDocument[]) private claimDocuments;
    mapping(uint256 => uint256) private claimBaseRiskScore;
    mapping(uint256 => uint64) public claimVersion;
    mapping(uint256 => uint256) public claimCountPerPolicy;
    mapping(uint256 => uint256) public claimResolvedAt;

    uint256 public maxClaimsPerPolicy = 5;

    mapping(bytes32 => bool) private usedDocumentHashes;
    mapping(bytes32 => bool) private usedInvoiceHashes;
    mapping(address => mapping(uint256 => mapping(bytes32 => bool))) private userDateClaimTypeUsed;

    mapping(uint256 => uint256) private oracleRequestByClaimId;
    OracleCoordinator public oracleCoordinator;
    IClaimAdjudicator public claimAdjudicator;

    mapping(uint256 => SettlementRecord) private settlementRecords;
    mapping(uint256 => uint256) public manualReviewEligibleAt;
    mapping(uint256 => RejectionReason) public rejectionReason;

    bytes32 public oracleModelVersion;

    uint256 public deductibleRateBps = 1000;
    uint256 public deductibleCapWei = 0.02 ether;
    uint256 public insurerShareBps = 8000;
    uint256 private constant DEFAULT_PREMIUM_INTERVAL_SECONDS = 30 days;
    uint256 private constant DEFAULT_GRACE_PERIOD_SECONDS = 7 days;

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

    event PolicyExpired(uint256 indexed policyId, uint256 timestamp);
    event PolicyStatusChanged(
        uint256 indexed policyId,
        PolicyStatus previousStatus,
        PolicyStatus newStatus,
        uint256 timestamp
    );
    event PremiumPaid(
        uint256 indexed policyId,
        address indexed payer,
        uint256 amount,
        uint256 paidAt,
        uint256 nextPremiumDueDate,
        uint256 installmentsPaid,
        uint256 totalPremiumPaid
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

    event OracleTimedOut(
        uint256 indexed requestId,
        uint256 indexed claimId,
        uint256 resolvedAtBlock
    );

    event OracleModelVersionUpdated(bytes32 indexed modelVersion, uint256 timestamp);

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

    event ClaimAppealFinalized(
        uint256 indexed claimId,
        bool reopened,
        address indexed finalizedBy,
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

    event ClaimClosed(
        uint256 indexed claimId,
        address indexed closedBy,
        uint256 timestamp
    );

    event ClaimDecisionRecorded(
        uint256 indexed claimId,
        uint64 indexed claimVersion,
        bool approved,
        RejectionReason rejectionReason,
        bytes32 decisionHash,
        uint256 timestamp
    );
    event PayoutAllocated(
        uint256 indexed claimId,
        address indexed claimant,
        uint256 amount,
        bool funded
    );
    event ClaimFundingRequired(uint256 indexed claimId, uint256 amount, uint256 shortfall);
    event ClaimFundingActivated(uint256 indexed claimId, address indexed activatedBy, uint256 amount);
    event SettlementWithdrawn(
        uint256 indexed claimId,
        address indexed claimant,
        uint256 amount,
        uint256 timestamp
    );
    event ManualReviewEligibilitySet(uint256 indexed claimId, uint256 eligibleAt);
    event ClaimAdjudicatorConfigured(address indexed adjudicator);


    event ContractFunded(
        address indexed fundedBy,
        uint256 amount
    );

    event ExcessWithdrawn(
        address indexed withdrawnBy,
        uint256 amount
    );

    event AuditorOutcomeObserved(
        bytes32 indexed observationId,
        address indexed auditor,
        bool successful,
        bytes32 indexed groundTruthHash,
        uint256 successfulOutcomes,
        uint256 failedOutcomes,
        uint256 betaMeanScore,
        uint256 timestamp
    );

    // =============================================================
    // Constructor
    // =============================================================

    constructor() {
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(ADMIN_ROLE, msg.sender);
        oracleModelVersion = keccak256("BLOCK_INSURE_FRAUD_MODEL_V1");
        oracleCoordinator = new OracleCoordinator(address(this));
    }

    function configureClaimAdjudicator(address adjudicator) external onlyRole(ADMIN_ROLE) {
        require(address(claimAdjudicator) == address(0), "Adjudicator already configured");
        require(adjudicator != address(0), "Invalid adjudicator");
        require(IClaimAdjudicator(adjudicator).manager() == address(this), "Adjudicator manager mismatch");
        claimAdjudicator = IClaimAdjudicator(adjudicator);
        emit ClaimAdjudicatorConfigured(adjudicator);
    }

    modifier onlyAdminOrEmergency() {
        require(
            hasRole(ADMIN_ROLE, msg.sender) || hasRole(EMERGENCY_ROLE, msg.sender),
            "Caller is not admin or emergency responder"
        );
        _;
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

        if (role == ORACLE_ROLE) {
            oracleCoordinator.setOracle(callerConfirmation, false);
        }

        if (role == AUDITOR_ROLE && address(claimAdjudicator) != address(0)) {
            claimAdjudicator.setAuditor(callerConfirmation, false);
        }

        _revokeRole(role, callerConfirmation);
    }

    function _grantProjectRoleInternal(bytes32 role, address account) internal {
        require(account != address(0), "Invalid account");
        require(role != DEFAULT_ADMIN_ROLE, "Cannot manage default admin role");

        if (role == ADMIN_ROLE && !hasRole(ADMIN_ROLE, account)) {
            adminRoleMemberCount++;
        }

        if (role == ORACLE_ROLE && !hasRole(ORACLE_ROLE, account)) {
            oracleCoordinator.setOracle(account, true);
        }

        if (
            role == AUDITOR_ROLE &&
            !hasRole(AUDITOR_ROLE, account) &&
            address(claimAdjudicator) != address(0)
        ) {
            claimAdjudicator.setAuditor(account, true);
        }

        _grantRole(role, account);

    }

    function _revokeProjectRoleInternal(bytes32 role, address account) internal {
        require(account != address(0), "Invalid account");
        require(role != DEFAULT_ADMIN_ROLE, "Cannot manage default admin role");

        if (role == ADMIN_ROLE && hasRole(ADMIN_ROLE, account)) {
            require(adminRoleMemberCount > 1, "Cannot revoke final admin");
            adminRoleMemberCount--;
        }

        if (role == ORACLE_ROLE && hasRole(ORACLE_ROLE, account)) {
            oracleCoordinator.setOracle(account, false);
        }

        if (
            role == AUDITOR_ROLE &&
            hasRole(AUDITOR_ROLE, account) &&
            address(claimAdjudicator) != address(0)
        ) {
            claimAdjudicator.setAuditor(account, false);
        }

        _revokeRole(role, account);
    }

    function getActiveOracles() external view returns (address[] memory) {
        return oracleCoordinator.getActiveOracles();
    }

    // =============================================================
    // Emergency Controls
    // =============================================================

    // Pause blocks policy purchases, claim submissions, oracle confirmations,
    // and on-chain settlements. Only an admin can restore normal operation.
    function pause() external onlyAdminOrEmergency {
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
        uint256 nextPremiumDueDate = _nextDueDate(startDate, endDate);
        uint256 gracePeriodEnd = _gracePeriodEnd(nextPremiumDueDate, endDate);

        policies[newPolicyId] = Policy({
            policyId: newPolicyId,
            packageId: packageId,
            holderWallet: msg.sender,
            startDate: startDate,
            endDate: endDate,
            coverageAmount: selectedPackage.coverageAmount,
            premiumPaid: msg.value,
            isActive: true,
            status: PolicyStatus.ACTIVE,
            premiumAmount: selectedPackage.premiumAmount,
            premiumInterval: DEFAULT_PREMIUM_INTERVAL_SECONDS,
            nextPremiumDueDate: nextPremiumDueDate,
            gracePeriodEnd: gracePeriodEnd,
            lastPaidTimestamp: block.timestamp,
            totalPremiumPaid: msg.value,
            installmentsPaid: 1
        });

        policyCounter++;

        emit PolicyPurchased(
            newPolicyId,
            packageId,
            msg.sender,
            selectedPackage.coverageAmount,
            endDate
        );

        emit PremiumPaid(
            newPolicyId,
            msg.sender,
            msg.value,
            block.timestamp,
            nextPremiumDueDate,
            1,
            msg.value
        );

        return newPolicyId;
    }

    function getPolicy(uint256 policyId) external view returns (Policy memory) {
        require(_policyExists(policyId), "Policy does not exist");
        return policies[policyId];
    }

    function getEffectivePolicyStatus(uint256 policyId) public view returns (PolicyStatus) {
        require(_policyExists(policyId), "Policy does not exist");
        return _effectivePolicyStatus(policies[policyId]);
    }

    function refreshPolicyStatus(uint256 policyId) public returns (PolicyStatus) {
        require(_policyExists(policyId), "Policy does not exist");

        Policy storage selectedPolicy = policies[policyId];

        _syncPolicyStatus(policyId, selectedPolicy);

        return selectedPolicy.status;
    }

    function payPremium(uint256 policyId) external payable whenNotPaused {
        require(_policyExists(policyId), "Policy does not exist");

        Policy storage selectedPolicy = policies[policyId];

        _syncPolicyStatus(policyId, selectedPolicy);

        require(selectedPolicy.holderWallet == msg.sender, "Caller is not policy holder");
        require(selectedPolicy.status == PolicyStatus.ACTIVE || selectedPolicy.status == PolicyStatus.GRACE_PERIOD, "Policy is not payable");
        require(msg.value == selectedPolicy.premiumAmount, "Incorrect premium amount");

        _recordPremiumPayment(policyId, selectedPolicy, msg.value);
    }

    function reinstatePolicy(uint256 policyId) external payable whenNotPaused {
        require(_policyExists(policyId), "Policy does not exist");

        Policy storage selectedPolicy = policies[policyId];

        _syncPolicyStatus(policyId, selectedPolicy);

        require(selectedPolicy.holderWallet == msg.sender, "Caller is not policy holder");
        require(selectedPolicy.status == PolicyStatus.LAPSED, "Policy is not lapsed");
        require(block.timestamp <= selectedPolicy.endDate, "Policy has expired");
        require(msg.value == selectedPolicy.premiumAmount, "Incorrect premium amount");

        _recordPremiumPayment(policyId, selectedPolicy, msg.value);

    }

    function cancelPolicy(uint256 policyId) external {
        require(_policyExists(policyId), "Policy does not exist");

        Policy storage selectedPolicy = policies[policyId];

        _syncPolicyStatus(policyId, selectedPolicy);

        require(
            selectedPolicy.holderWallet == msg.sender || hasRole(ADMIN_ROLE, msg.sender),
            "Caller cannot cancel policy"
        );
        require(selectedPolicy.status != PolicyStatus.CANCELLED, "Policy already cancelled");
        require(selectedPolicy.status != PolicyStatus.EXPIRED, "Policy already expired");

        _setPolicyStatus(policyId, selectedPolicy, PolicyStatus.CANCELLED);
        selectedPolicy.isActive = false;

    }

    function deactivateExpiredPolicy(uint256 policyId) external {
        require(_policyExists(policyId), "Policy does not exist");

        Policy storage selectedPolicy = policies[policyId];

        _syncPolicyStatus(policyId, selectedPolicy);
        require(selectedPolicy.status == PolicyStatus.EXPIRED, "Policy has not expired");

        emit PolicyExpired(policyId, block.timestamp);
    }

    // =============================================================
    // Registry Merkle Commitment
    // =============================================================

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

        Policy storage selectedPolicy = policies[policyId];

        require(selectedPolicy.holderWallet == msg.sender, "Caller is not policy holder");
        _syncPolicyStatus(policyId, selectedPolicy);
        require(selectedPolicy.status == PolicyStatus.ACTIVE, "Policy is not active");
        require(incidentDate >= selectedPolicy.startDate && incidentDate <= selectedPolicy.endDate, "Incident date outside policy period");
        require(incidentDate <= block.timestamp, "Incident date cannot be in the future");
        require(claimAmount > 0, "Claim amount must be greater than zero");
        require(claimAmount <= selectedPolicy.coverageAmount, "Claim amount exceeds coverage");
        require(bytes(claimType).length > 0, "Claim type required");
        require(bytes(hospitalId).length > 0, "Hospital ID required");
        require(invoiceHash != bytes32(0), "Invoice hash required");
        require(documentHash != bytes32(0), "Document hash required");
        require(bytes(documentCID).length > 0, "Document CID required");
        require(
            claimCountPerPolicy[policyId] < maxClaimsPerPolicy,
            "Maximum claims per policy reached"
        );

        claimCountPerPolicy[policyId]++;

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
        claimVersion[newClaimId] = 1;

        claimDocuments[newClaimId].push(
            ClaimDocument({
                documentHash: documentHash,
                documentCID: documentCID,
                uploadedAt: block.timestamp,
                documentType: policyPackages[selectedPolicy.packageId].requiredDocumentType
            })
        );

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
            uint256 delay = address(claimAdjudicator) == address(0)
                ? 2 days
                : claimAdjudicator.routingDelay();
            manualReviewEligibleAt[newClaimId] = block.timestamp + delay;

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

        return _requestOracleVerification(claimId);
    }

    function _requestOracleVerification(uint256 claimId) internal returns (uint256) {
        require(_claimExists(claimId), "Claim does not exist");
        require(
            claims[claimId].status == ClaimStatus.DUPLICATE_CHECKED ||
                claims[claimId].status == ClaimStatus.APPEALED,
            "Claim is not ready for oracle"
        );
        require(oracleRequestByClaimId[claimId] == 0, "Oracle request already exists");

        Claim memory selectedClaim = claims[claimId];

        bytes32 queryHash = keccak256(
            abi.encode(
                selectedClaim.claimId,
                selectedClaim.policyId,
                selectedClaim.claimantWallet,
                selectedClaim.claimAmount,
                selectedClaim.incidentDate,
                keccak256(bytes(selectedClaim.claimType)),
                keccak256(bytes(selectedClaim.hospitalId)),
                selectedClaim.invoiceHash,
                selectedClaim.documentHash,
                claimVersion[claimId],
                oracleModelVersion
            )
        );

        uint256 newRequestId = oracleCoordinator.createRequest(
            claimId,
            queryHash,
            claimVersion[claimId],
            oracleModelVersion
        );

        oracleRequestByClaimId[claimId] = newRequestId;
        claims[claimId].status = ClaimStatus.ORACLE_PENDING;

        emit OracleRequested(newRequestId, claimId, "HOSPITAL");

        return newRequestId;
    }

    function isOracleRequestProcessable(uint256 claimId) external view returns (bool) {
        return
            msg.sender == address(oracleCoordinator) &&
            !paused() &&
            _claimExists(claimId) &&
            claims[claimId].status == ClaimStatus.ORACLE_PENDING;
    }

    function finalizeOracleResult(
        uint256 requestId,
        uint256 claimId,
        bool verified,
        bytes32 resultHash,
        uint8 finalizationCode
    ) external {
        require(msg.sender == address(oracleCoordinator), "Caller is not oracle coordinator");
        require(_claimExists(claimId), "Claim does not exist");
        require(oracleRequestByClaimId[claimId] == requestId, "Oracle request mismatch");
        require(claims[claimId].status == ClaimStatus.ORACLE_PENDING, "Claim is not oracle pending");

        if (verified) {
            claims[claimId].status = ClaimStatus.ORACLE_VERIFIED;
            _addOracleVerificationScore(claimId);
            _allocatePayout(claimId, resultHash);
        } else {
            claims[claimId].status = ClaimStatus.ORACLE_FAILED;
            RejectionReason reason = finalizationCode == 2
                ? RejectionReason.ORACLE_CONFLICT
                : finalizationCode == 3
                    ? RejectionReason.ORACLE_TIMEOUT
                    : RejectionReason.ORACLE_INVALID;
            rejectionReason[claimId] = reason;
            manualReviewEligibleAt[claimId] = block.timestamp + claimAdjudicator.routingDelay();
            emit ManualReviewEligibilitySet(claimId, manualReviewEligibleAt[claimId]);
        }

        emit OracleResultSubmitted(
            requestId,
            claimId,
            verified,
            verified ? "LOW" : "HIGH"
        );

        if (finalizationCode == 3) {
            emit OracleTimedOut(requestId, claimId, block.number);
        }
    }

    function updateOracleModelVersion(bytes32 modelVersion) external onlyRole(ADMIN_ROLE) {
        require(modelVersion != bytes32(0), "Model version required");
        oracleModelVersion = modelVersion;
        emit OracleModelVersionUpdated(modelVersion, block.timestamp);
    }

    function submitAppeal(uint256 claimId, string calldata appealReasonHash) external {
        _submitAppeal(claimId, appealReasonHash, bytes32(0), "");
    }

    function submitAppealWithEvidence(
        uint256 claimId,
        string calldata appealReasonHash,
        bytes32 evidenceHash,
        string calldata evidenceCID
    ) external {
        require(evidenceHash != bytes32(0), "Evidence hash required");
        require(bytes(evidenceCID).length > 0, "Evidence CID required");
        _submitAppeal(claimId, appealReasonHash, evidenceHash, evidenceCID);
    }

    function _submitAppeal(
        uint256 claimId,
        string memory appealReasonHash,
        bytes32 evidenceHash,
        string memory evidenceCID
    ) internal {
        require(_claimExists(claimId), "Claim does not exist");
        require(claims[claimId].claimantWallet == msg.sender, "Caller is not claimant");
        require(claims[claimId].status == ClaimStatus.REJECTED, "Claim is not rejected");
        require(bytes(appealReasonHash).length > 0, "Appeal reason hash required");

        if (evidenceHash != bytes32(0)) {
            claimDocuments[claimId].push(ClaimDocument({
                documentHash: evidenceHash,
                documentCID: evidenceCID,
                uploadedAt: block.timestamp,
                documentType: "APPEAL_EVIDENCE"
            }));
            emit DocumentAdded(claimId, evidenceHash, evidenceCID);
        }

        uint64 newVersion = claimVersion[claimId] + 1;
        claimAdjudicator.beginAppeal(claimId, newVersion);
        claimVersion[claimId] = newVersion;
        delete claimResolvedAt[claimId];
        delete rejectionReason[claimId];
        oracleRequestByClaimId[claimId] = 0;
        claims[claimId].riskScore = claimBaseRiskScore[claimId];
        claims[claimId].status = ClaimStatus.APPEALED;

        emit ClaimAppealed(claimId, msg.sender, appealReasonHash, block.timestamp);
        _requestOracleVerification(claimId);
    }

    function castVote(uint256 claimId, uint8 vote) external {
        require(_claimExists(claimId), "Claim does not exist");
        require(claims[claimId].status == ClaimStatus.MANUAL_REVIEW, "Claim is not in manual review");
        claimAdjudicator.castVote(claimId, claimVersion[claimId], msg.sender, vote);
        emit AuditorVoteCast(claimId, msg.sender, vote, block.timestamp);
    }

    function sendToManualReview(uint256 claimId) external {
        require(_claimExists(claimId), "Claim does not exist");
        require(
            claims[claimId].status == ClaimStatus.FRAUD_FLAGGED ||
                claims[claimId].status == ClaimStatus.ORACLE_FAILED,
            "Claim cannot be sent to manual review"
        );
        bool operator = hasRole(ADMIN_ROLE, msg.sender) || hasRole(CLAIM_OFFICER_ROLE, msg.sender);
        require(
            operator || block.timestamp >= manualReviewEligibleAt[claimId],
            "Manual review routing deadline active"
        );

        claimAdjudicator.startReview(claimId, claimVersion[claimId]);
        claims[claimId].status = ClaimStatus.MANUAL_REVIEW;
        emit ClaimSentToManualReview(claimId, msg.sender, block.timestamp);
    }

    function finalizeExpiredManualReview(uint256 claimId) external {
        require(_claimExists(claimId), "Claim does not exist");
        require(claims[claimId].status == ClaimStatus.MANUAL_REVIEW, "Claim is not in manual review");
        claimAdjudicator.finalizeExpiredReview(claimId, claimVersion[claimId]);
    }

    function finalizeManualReview(
        uint256 claimId,
        uint64 version,
        bool approved,
        uint8 reasonCode
    ) external {
        require(msg.sender == address(claimAdjudicator), "Caller is not adjudicator");
        require(_claimExists(claimId), "Claim does not exist");
        require(claimVersion[claimId] == version, "Claim version mismatch");
        require(claims[claimId].status == ClaimStatus.MANUAL_REVIEW, "Claim is not in manual review");

        bytes32 decisionHash = keccak256(abi.encode(claimId, version, approved, reasonCode));
        if (approved) {
            _allocatePayout(claimId, decisionHash);
        } else {
            RejectionReason reason = reasonCode == 6
                ? RejectionReason.REVIEW_TIMEOUT
                : RejectionReason.AUDITOR_QUORUM_REJECTED;
            _rejectFromAuditorQuorum(claimId, reason, decisionHash);
        }
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
        require(
            claimAdjudicator.totalOutstandingLiabilityWei() == 0,
            "Approved claim liabilities are active"
        );

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

    function activateFundedClaim(uint256 claimId) external whenNotPaused {
        require(_claimExists(claimId), "Claim does not exist");
        require(claims[claimId].status == ClaimStatus.FUNDING_REQUIRED, "Claim does not need funding");
        uint256 amount = claimAdjudicator.allocatedSettlementWei(claimId);
        require(address(this).balance >= amount, "Settlement remains underfunded");
        claimAdjudicator.fundPayout{value: amount}(claimId, claims[claimId].claimantWallet);
        claims[claimId].status = ClaimStatus.PAYOUT_READY;
        emit ClaimFundingActivated(claimId, msg.sender, amount);
    }

    function withdrawSettlement(uint256 claimId) external whenNotPaused nonReentrant {
        require(_claimExists(claimId), "Claim does not exist");
        Claim storage selectedClaim = claims[claimId];
        require(selectedClaim.claimantWallet == msg.sender, "Caller is not claimant");
        require(selectedClaim.status == ClaimStatus.PAYOUT_READY, "Settlement is not ready");
        uint256 amount = claimAdjudicator.withdrawPayout(claimId, payable(msg.sender));

        selectedClaim.status = ClaimStatus.SETTLED;
        claimResolvedAt[claimId] = block.timestamp;
        settlementRecords[claimId] = SettlementRecord({
            claimId: claimId,
            recipient: msg.sender,
            amount: amount,
            settledAt: block.timestamp
        });

        emit SettlementWithdrawn(claimId, msg.sender, amount, block.timestamp);
        emit ClaimSettled(claimId, msg.sender, amount, block.timestamp);

    }

    function _allocatePayout(uint256 claimId, bytes32 decisionHash) internal {
        (
            uint256 claimAmount,
            uint256 deductible,
            ,
            uint256 insurerPays,
            uint256 claimantResponsibility
        ) = calculateSettlement(claimId);
        require(insurerPays > 0, "Settlement is zero");

        claimResolvedAt[claimId] = block.timestamp;
        rejectionReason[claimId] = RejectionReason.NONE;
        bool funded = address(this).balance >= insurerPays;
        if (funded) {
            claimAdjudicator.allocatePayout{value: insurerPays}(
                claimId,
                claimVersion[claimId],
                claims[claimId].claimantWallet,
                insurerPays,
                decisionHash
            );
            claims[claimId].status = ClaimStatus.PAYOUT_READY;
        } else {
            claimAdjudicator.allocatePayout(
                claimId,
                claimVersion[claimId],
                claims[claimId].claimantWallet,
                insurerPays,
                decisionHash
            );
            claims[claimId].status = ClaimStatus.FUNDING_REQUIRED;
            emit ClaimFundingRequired(claimId, insurerPays, insurerPays - address(this).balance);
        }

        emit SettlementCalculated(
            claimId,
            claimAmount,
            deductible,
            insurerPays,
            claimantResponsibility
        );
        emit PayoutAllocated(claimId, claims[claimId].claimantWallet, insurerPays, funded);
        emit ClaimApproved(claimId, msg.sender, block.timestamp);
        emit ClaimDecisionRecorded(
            claimId,
            claimVersion[claimId],
            true,
            RejectionReason.NONE,
            decisionHash,
            block.timestamp
        );
    }

    function _rejectFromAuditorQuorum(
        uint256 claimId,
        RejectionReason reason,
        bytes32 decisionHash
    ) internal {
        claims[claimId].status = ClaimStatus.REJECTED;
        rejectionReason[claimId] = reason;
        claimResolvedAt[claimId] = block.timestamp;
        claimAdjudicator.recordRejection(
            claimId,
            claimVersion[claimId],
            uint8(reason),
            decisionHash
        );
        emit ClaimRejected(claimId, msg.sender, decisionHash);
        emit ClaimDecisionRecorded(
            claimId,
            claimVersion[claimId],
            false,
            reason,
            decisionHash,
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
        require(
            address(this).balance - amount >= claimAdjudicator.totalUnfundedLiabilityWei(),
            "Withdrawal would consume approved claim reserves"
        );

        (bool success, ) = payable(msg.sender).call{value: amount}("");
        require(success, "Withdrawal failed");

        emit ExcessWithdrawn(msg.sender, amount);
    }

    function getSettlementRecord(uint256 claimId) external view returns (SettlementRecord memory) {
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

    function _nextDueDate(uint256 fromTimestamp, uint256 endDate) internal pure returns (uint256) {
        uint256 nextDueDate = fromTimestamp + DEFAULT_PREMIUM_INTERVAL_SECONDS;

        if (nextDueDate > endDate) {
            return endDate;
        }

        return nextDueDate;
    }

    function _gracePeriodEnd(uint256 nextPremiumDueDate, uint256 endDate) internal pure returns (uint256) {
        uint256 graceEnd = nextPremiumDueDate + DEFAULT_GRACE_PERIOD_SECONDS;

        if (graceEnd > endDate) {
            return endDate;
        }

        return graceEnd;
    }

    function _effectivePolicyStatus(Policy memory selectedPolicy) internal view returns (PolicyStatus) {
        if (selectedPolicy.status == PolicyStatus.CANCELLED) {
            return PolicyStatus.CANCELLED;
        }

        if (block.timestamp > selectedPolicy.endDate) {
            return PolicyStatus.EXPIRED;
        }

        if (block.timestamp > selectedPolicy.gracePeriodEnd) {
            return PolicyStatus.LAPSED;
        }

        if (block.timestamp > selectedPolicy.nextPremiumDueDate) {
            return PolicyStatus.GRACE_PERIOD;
        }

        return PolicyStatus.ACTIVE;
    }

    function _syncPolicyStatus(uint256 policyId, Policy storage selectedPolicy) internal {
        PolicyStatus effectiveStatus = _effectivePolicyStatus(selectedPolicy);

        _setPolicyStatus(policyId, selectedPolicy, effectiveStatus);
    }

    function _setPolicyStatus(
        uint256 policyId,
        Policy storage selectedPolicy,
        PolicyStatus newStatus
    ) internal {
        PolicyStatus previousStatus = selectedPolicy.status;

        selectedPolicy.status = newStatus;
        selectedPolicy.isActive = newStatus == PolicyStatus.ACTIVE;

        if (previousStatus != newStatus) {
            emit PolicyStatusChanged(policyId, previousStatus, newStatus, block.timestamp);

            if (newStatus == PolicyStatus.EXPIRED) {
                emit PolicyExpired(policyId, block.timestamp);
            }
        }
    }

    function _recordPremiumPayment(
        uint256 policyId,
        Policy storage selectedPolicy,
        uint256 amount
    ) internal {
        selectedPolicy.lastPaidTimestamp = block.timestamp;
        selectedPolicy.totalPremiumPaid += amount;
        selectedPolicy.premiumPaid = selectedPolicy.totalPremiumPaid;
        selectedPolicy.installmentsPaid += 1;
        selectedPolicy.nextPremiumDueDate = _nextDueDate(block.timestamp, selectedPolicy.endDate);
        selectedPolicy.gracePeriodEnd = _gracePeriodEnd(
            selectedPolicy.nextPremiumDueDate,
            selectedPolicy.endDate
        );

        _setPolicyStatus(policyId, selectedPolicy, PolicyStatus.ACTIVE);

        emit PremiumPaid(
            policyId,
            msg.sender,
            amount,
            block.timestamp,
            selectedPolicy.nextPremiumDueDate,
            selectedPolicy.installmentsPaid,
            selectedPolicy.totalPremiumPaid
        );
    }


}
