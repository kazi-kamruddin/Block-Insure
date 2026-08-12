// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IInsurancePolicySource {
    enum PolicyStatus {
        PENDING_PAYMENT,
        ACTIVE,
        GRACE_PERIOD,
        LAPSED,
        CANCELLED,
        EXPIRED,
        RENEWED
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

    function getPolicy(uint256 policyId) external view returns (Policy memory);
    function getEffectivePolicyStatus(uint256 policyId) external view returns (PolicyStatus);
}

contract PolicyBenefitsManager is AccessControl, Pausable, ReentrancyGuard {
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    uint256 public constant MAX_BENEFICIARIES = 3;
    uint256 public constant BPS_DENOMINATOR = 10_000;

    enum BenefitType {
        DEATH,
        SURRENDER,
        MATURITY
    }

    enum BenefitStatus {
        NONE,
        REQUESTED,
        APPROVED,
        REJECTED,
        PAID
    }

    struct BenefitTerms {
        bool configured;
        bool deathBenefitEnabled;
        bool surrenderEnabled;
        bool maturityEnabled;
        uint16 deathBenefitBps;
        uint16 surrenderValueBps;
        uint16 maturityBonusBps;
        uint16 minimumSurrenderInstallments;
        uint32 version;
        bytes32 termsHash;
    }

    struct Beneficiary {
        address account;
        uint16 shareBps;
    }

    struct BenefitRequest {
        uint256 requestId;
        uint256 policyId;
        uint256 packageId;
        BenefitType benefitType;
        BenefitStatus status;
        address requester;
        uint256 amount;
        bytes32 evidenceHash;
        bytes32 decisionReasonHash;
        uint32 termsVersion;
        uint256 requestedAt;
        uint256 resolvedAt;
        uint256 paidAt;
    }

    IInsurancePolicySource public immutable insuranceManager;
    uint256 public requestCounter = 1;
    uint256 public totalReservedLiabilityWei;

    mapping(uint256 => BenefitTerms) private benefitTermsByPackage;
    mapping(uint256 => Beneficiary[]) private beneficiariesByPolicy;
    mapping(uint256 => BenefitRequest) private benefitRequests;
    mapping(uint256 => mapping(BenefitType => uint256)) public requestByPolicyAndType;

    event BenefitTermsPublished(
        uint256 indexed packageId,
        uint32 indexed version,
        bytes32 indexed termsHash
    );
    event BeneficiariesUpdated(uint256 indexed policyId, address indexed holder);
    event BenefitRequested(
        uint256 indexed requestId,
        uint256 indexed policyId,
        BenefitType indexed benefitType,
        uint256 amount,
        address requester
    );
    event BenefitApproved(uint256 indexed requestId, uint256 amount);
    event BenefitRejected(uint256 indexed requestId, bytes32 reasonHash);
    event BenefitPaid(uint256 indexed requestId, uint256 amount);
    event BenefitsFunded(address indexed sender, uint256 amount);
    event ExcessBenefitsWithdrawn(address indexed recipient, uint256 amount);

    constructor(address insuranceManagerAddress, address initialAdmin) {
        require(insuranceManagerAddress != address(0), "Invalid insurance manager");
        require(initialAdmin != address(0), "Invalid admin");

        insuranceManager = IInsurancePolicySource(insuranceManagerAddress);
        _grantRole(DEFAULT_ADMIN_ROLE, initialAdmin);
        _grantRole(ADMIN_ROLE, initialAdmin);
    }

    function publishBenefitTerms(
        uint256 packageId,
        bool deathBenefitEnabled,
        bool surrenderEnabled,
        bool maturityEnabled,
        uint16 deathBenefitBps,
        uint16 surrenderValueBps,
        uint16 maturityBonusBps,
        uint16 minimumSurrenderInstallments,
        uint32 version,
        bytes32 termsHash
    ) external onlyRole(ADMIN_ROLE) {
        require(packageId > 0, "Invalid package");
        require(version > 0, "Version required");
        require(termsHash != bytes32(0), "Terms hash required");
        require(deathBenefitBps <= BPS_DENOMINATOR, "Invalid death benefit");
        require(surrenderValueBps <= BPS_DENOMINATOR, "Invalid surrender value");
        require(maturityBonusBps <= BPS_DENOMINATOR, "Invalid maturity bonus");

        BenefitTerms memory currentTerms = benefitTermsByPackage[packageId];
        require(!currentTerms.configured || version > currentTerms.version, "Version must increase");
        require(!deathBenefitEnabled || deathBenefitBps > 0, "Death rate required");
        require(!surrenderEnabled || surrenderValueBps > 0, "Surrender rate required");

        benefitTermsByPackage[packageId] = BenefitTerms({
            configured: true,
            deathBenefitEnabled: deathBenefitEnabled,
            surrenderEnabled: surrenderEnabled,
            maturityEnabled: maturityEnabled,
            deathBenefitBps: deathBenefitBps,
            surrenderValueBps: surrenderValueBps,
            maturityBonusBps: maturityBonusBps,
            minimumSurrenderInstallments: minimumSurrenderInstallments,
            version: version,
            termsHash: termsHash
        });

        emit BenefitTermsPublished(packageId, version, termsHash);
    }

    function setBeneficiaries(
        uint256 policyId,
        address[] calldata accounts,
        uint16[] calldata sharesBps
    ) external whenNotPaused {
        IInsurancePolicySource.Policy memory policy = insuranceManager.getPolicy(policyId);
        require(policy.holderWallet == msg.sender, "Caller is not policy holder");
        uint256 deathRequestId = requestByPolicyAndType[policyId][BenefitType.DEATH];
        require(
            deathRequestId == 0 ||
                benefitRequests[deathRequestId].status == BenefitStatus.REJECTED,
            "Beneficiaries locked after death request"
        );
        require(accounts.length > 0 && accounts.length <= MAX_BENEFICIARIES, "Use one to three beneficiaries");
        require(accounts.length == sharesBps.length, "Beneficiary input mismatch");

        uint256 totalShares;
        delete beneficiariesByPolicy[policyId];

        for (uint256 i = 0; i < accounts.length; i++) {
            require(accounts[i] != address(0), "Invalid beneficiary");
            require(accounts[i] != policy.holderWallet, "Holder cannot be beneficiary");
            require(sharesBps[i] > 0, "Share must be positive");

            for (uint256 j = 0; j < i; j++) {
                require(accounts[j] != accounts[i], "Duplicate beneficiary");
            }

            totalShares += sharesBps[i];
            beneficiariesByPolicy[policyId].push(
                Beneficiary({account: accounts[i], shareBps: sharesBps[i]})
            );
        }

        require(totalShares == BPS_DENOMINATOR, "Shares must total 100 percent");
        emit BeneficiariesUpdated(policyId, msg.sender);
    }

    function requestBenefit(
        uint256 policyId,
        BenefitType benefitType,
        bytes32 evidenceHash
    ) external whenNotPaused returns (uint256) {
        uint256 previousRequestId = requestByPolicyAndType[policyId][benefitType];
        require(
            previousRequestId == 0 ||
                benefitRequests[previousRequestId].status == BenefitStatus.REJECTED,
            "Benefit already requested"
        );

        IInsurancePolicySource.Policy memory policy = insuranceManager.getPolicy(policyId);
        IInsurancePolicySource.PolicyStatus effectiveStatus = insuranceManager.getEffectivePolicyStatus(policyId);
        BenefitTerms memory terms = benefitTermsByPackage[policy.packageId];
        require(terms.configured, "Benefit terms not configured");

        uint256 amount;
        if (benefitType == BenefitType.DEATH) {
            require(terms.deathBenefitEnabled, "Death benefit disabled");
            require(evidenceHash != bytes32(0), "Death evidence required");
            require(_isBeneficiary(policyId, msg.sender), "Caller is not a beneficiary");
            require(beneficiariesByPolicy[policyId].length > 0, "Beneficiaries not configured");
            amount = (policy.coverageAmount * terms.deathBenefitBps) / BPS_DENOMINATOR;
        } else if (benefitType == BenefitType.SURRENDER) {
            require(terms.surrenderEnabled, "Surrender disabled");
            require(policy.holderWallet == msg.sender, "Caller is not policy holder");
            require(effectiveStatus == IInsurancePolicySource.PolicyStatus.CANCELLED, "Cancel policy before surrender");
            require(policy.installmentsPaid >= terms.minimumSurrenderInstallments, "Minimum installments not met");
            amount = (policy.totalPremiumPaid * terms.surrenderValueBps) / BPS_DENOMINATOR;
        } else {
            require(terms.maturityEnabled, "Maturity disabled");
            require(policy.holderWallet == msg.sender, "Caller is not policy holder");
            require(effectiveStatus == IInsurancePolicySource.PolicyStatus.EXPIRED, "Policy has not matured");
            amount =
                (policy.totalPremiumPaid * (BPS_DENOMINATOR + terms.maturityBonusBps)) /
                BPS_DENOMINATOR;
        }

        require(amount > 0, "Benefit amount is zero");
        uint256 requestId = requestCounter++;
        benefitRequests[requestId] = BenefitRequest({
            requestId: requestId,
            policyId: policyId,
            packageId: policy.packageId,
            benefitType: benefitType,
            status: BenefitStatus.REQUESTED,
            requester: msg.sender,
            amount: amount,
            evidenceHash: evidenceHash,
            decisionReasonHash: bytes32(0),
            termsVersion: terms.version,
            requestedAt: block.timestamp,
            resolvedAt: 0,
            paidAt: 0
        });
        requestByPolicyAndType[policyId][benefitType] = requestId;

        emit BenefitRequested(requestId, policyId, benefitType, amount, msg.sender);
        return requestId;
    }

    function approveBenefit(uint256 requestId) external onlyRole(ADMIN_ROLE) whenNotPaused {
        BenefitRequest storage benefitRequest = _getBenefitRequest(requestId);
        require(benefitRequest.status == BenefitStatus.REQUESTED, "Benefit is not pending");
        require(address(this).balance >= totalReservedLiabilityWei + benefitRequest.amount, "Insufficient benefit reserve");

        benefitRequest.status = BenefitStatus.APPROVED;
        benefitRequest.resolvedAt = block.timestamp;
        totalReservedLiabilityWei += benefitRequest.amount;
        emit BenefitApproved(requestId, benefitRequest.amount);
    }

    function rejectBenefit(uint256 requestId, bytes32 reasonHash) external onlyRole(ADMIN_ROLE) {
        BenefitRequest storage benefitRequest = _getBenefitRequest(requestId);
        require(benefitRequest.status == BenefitStatus.REQUESTED, "Benefit is not pending");
        require(reasonHash != bytes32(0), "Reason required");

        benefitRequest.status = BenefitStatus.REJECTED;
        benefitRequest.decisionReasonHash = reasonHash;
        benefitRequest.resolvedAt = block.timestamp;
        emit BenefitRejected(requestId, reasonHash);
    }

    function settleBenefit(uint256 requestId) external onlyRole(ADMIN_ROLE) whenNotPaused nonReentrant {
        BenefitRequest storage benefitRequest = _getBenefitRequest(requestId);
        require(benefitRequest.status == BenefitStatus.APPROVED, "Benefit is not approved");

        benefitRequest.status = BenefitStatus.PAID;
        benefitRequest.paidAt = block.timestamp;
        totalReservedLiabilityWei -= benefitRequest.amount;

        if (benefitRequest.benefitType == BenefitType.DEATH) {
            Beneficiary[] memory beneficiaries = beneficiariesByPolicy[benefitRequest.policyId];
            uint256 distributed;
            for (uint256 i = 0; i < beneficiaries.length; i++) {
                uint256 payment = i == beneficiaries.length - 1
                    ? benefitRequest.amount - distributed
                    : (benefitRequest.amount * beneficiaries[i].shareBps) / BPS_DENOMINATOR;
                distributed += payment;
                _sendValue(beneficiaries[i].account, payment);
            }
        } else {
            IInsurancePolicySource.Policy memory policy = insuranceManager.getPolicy(benefitRequest.policyId);
            _sendValue(policy.holderWallet, benefitRequest.amount);
        }

        emit BenefitPaid(requestId, benefitRequest.amount);
    }

    function withdrawExcess(address payable recipient, uint256 amount) external onlyRole(ADMIN_ROLE) nonReentrant {
        require(recipient != address(0), "Invalid recipient");
        require(address(this).balance >= totalReservedLiabilityWei + amount, "Amount exceeds excess reserve");
        _sendValue(recipient, amount);
        emit ExcessBenefitsWithdrawn(recipient, amount);
    }

    function pause() external onlyRole(ADMIN_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(ADMIN_ROLE) {
        _unpause();
    }

    function getBenefitTerms(uint256 packageId) external view returns (BenefitTerms memory) {
        return benefitTermsByPackage[packageId];
    }

    function getBeneficiaries(uint256 policyId) external view returns (Beneficiary[] memory) {
        return beneficiariesByPolicy[policyId];
    }

    function getBenefitRequest(uint256 requestId) external view returns (BenefitRequest memory) {
        return _getBenefitRequest(requestId);
    }

    function calculateBenefit(uint256 policyId, BenefitType benefitType) external view returns (uint256) {
        IInsurancePolicySource.Policy memory policy = insuranceManager.getPolicy(policyId);
        BenefitTerms memory terms = benefitTermsByPackage[policy.packageId];
        if (!terms.configured) return 0;
        if (benefitType == BenefitType.DEATH && terms.deathBenefitEnabled) {
            return (policy.coverageAmount * terms.deathBenefitBps) / BPS_DENOMINATOR;
        }
        if (benefitType == BenefitType.SURRENDER && terms.surrenderEnabled) {
            return (policy.totalPremiumPaid * terms.surrenderValueBps) / BPS_DENOMINATOR;
        }
        if (benefitType == BenefitType.MATURITY && terms.maturityEnabled) {
            return
                (policy.totalPremiumPaid * (BPS_DENOMINATOR + terms.maturityBonusBps)) /
                BPS_DENOMINATOR;
        }
        return 0;
    }

    function availableReserveWei() external view returns (uint256) {
        return address(this).balance - totalReservedLiabilityWei;
    }

    function _getBenefitRequest(uint256 requestId) internal view returns (BenefitRequest storage) {
        require(requestId > 0 && requestId < requestCounter, "Benefit request does not exist");
        return benefitRequests[requestId];
    }

    function _isBeneficiary(uint256 policyId, address account) internal view returns (bool) {
        Beneficiary[] storage beneficiaries = beneficiariesByPolicy[policyId];
        for (uint256 i = 0; i < beneficiaries.length; i++) {
            if (beneficiaries[i].account == account) return true;
        }
        return false;
    }

    function _sendValue(address recipient, uint256 amount) internal {
        (bool sent, ) = payable(recipient).call{value: amount}("");
        require(sent, "Benefit transfer failed");
    }

    receive() external payable {
        emit BenefitsFunded(msg.sender, msg.value);
    }
}
