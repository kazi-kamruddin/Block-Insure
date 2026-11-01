// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

interface IPolicyEconomicsManager {
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
    function hasRole(bytes32 role, address account) external view returns (bool);
    function getPolicyPackage(uint256 packageId) external view returns (PolicyPackage memory);
}

contract PolicyEconomics {
    bytes32 private constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    uint16 private constant BPS = 10_000;
    uint256 private immutable PREMIUM_INTERVAL;
    uint256 private immutable ADVANCE_WINDOW;
    uint256 private immutable GRACE_PERIOD;

    struct InstallmentQuote {
        uint256 installmentId;
        uint256 dueAt;
        uint256 endsAt;
        uint256 amountWei;
        uint256 opensAt;
        bool payableNow;
        bool reinstatement;
    }

    struct PackageRules {
        uint64 version;
        uint64 waitingPeriod;
        uint64 reinstatementWaitingPeriod;
        uint64 claimDeadline;
        uint16 minimumDocumentCommitments;
        uint16 deductibleRateBps;
        uint16 insurerShareBps;
        uint128 deductibleCapWei;
        uint128 maximumClaimWei;
        bytes32 exclusionsRoot;
        bytes32 requiredDocumentsRoot;
        bytes32 settlementFormulaVersion;
        bytes32 policyRuleVersion;
    }

    struct PolicyTerms {
        uint256 packageId;
        address holder;
        uint64 startsAt;
        uint64 endsAt;
        uint64 packageRuleVersion;
        uint64 waitingPeriod;
        uint64 reinstatementWaitingPeriod;
        uint64 claimDeadline;
        uint16 minimumDocumentCommitments;
        uint16 deductibleRateBps;
        uint16 insurerShareBps;
        uint128 deductibleCapWei;
        uint128 maximumClaimWei;
        uint256 coverageLimitWei;
        uint256 premiumWei;
        bytes32 exclusionsRoot;
        bytes32 requiredDocumentsRoot;
        bytes32 settlementFormulaVersion;
        bytes32 policyRuleVersion;
    }

    struct CoverageAccount {
        uint256 coverageLimitWei;
        uint256 reservedCoverageWei;
        uint256 settledCoverageWei;
    }

    struct CoverageInterval {
        uint64 startsAt;
        uint64 endsAt;
        uint64 waitingEndsAt;
    }

    struct ClaimReservation {
        uint256 policyId;
        uint256 claimAmountWei;
        uint256 liabilityWei;
        bytes32 invoiceId;
        bool reserved;
        bool settled;
    }

    address public immutable manager;
    uint16 public reserveRatioBps = 500;
    uint256 public minimumCapitalBufferWei = 0.1 ether;
    uint256 public activeExposureWei;
    uint256 public totalReservedCoverageWei;

    mapping(uint256 => uint64) public currentPackageRuleVersion;
    mapping(uint256 => mapping(uint64 => PackageRules)) private packageRules;
    mapping(bytes32 => bool) private allowedServiceCodes;
    mapping(bytes32 => bool) private excludedServiceCodes;
    mapping(uint256 => PolicyTerms) private policyTerms;
    mapping(uint256 => bytes32) public issuedDocumentHash;
    mapping(bytes32 => bytes32[]) private packageAllowedServices;
    mapping(bytes32 => bytes32[]) private packageExcludedServices;
    mapping(uint256 => CoverageAccount) private coverageAccounts;
    mapping(uint256 => CoverageInterval[]) private coverageIntervals;
    mapping(uint256 => ClaimReservation) private claimReservations;
    mapping(bytes32 => uint256) public invoiceClaimId;
    mapping(uint256 => bool) public coverageTerminated;
    mapping(uint256 => bool) public exposureClosed;
    address public benefitsManager;
    mapping(uint256 => bool) public terminalBenefitSettled;

    function configureBenefitsManager(address benefits) external onlyManagerAdmin {
        require(benefitsManager == address(0) && benefits.code.length > 0, "Invalid benefits configuration");
        benefitsManager = benefits;
    }

    function closeTerminalCoverage(uint256 policyId, address caller) external onlyManager {
        require(caller == benefitsManager && caller != address(0), "Caller is not benefits manager");
        require(coverageAccounts[policyId].reservedCoverageWei == 0, "Resolve pending medical claims before a terminal refund");
        require(!terminalBenefitSettled[policyId], "Terminal benefit already settled");
        terminalBenefitSettled[policyId] = true;
        coverageTerminated[policyId] = true;
        _closeExposure(policyId);
    }

    event PackageRulesPublished(uint256 indexed packageId, uint64 indexed version, bytes32 policyRuleVersion);
    event PolicyTermsSnapshotted(uint256 indexed policyId, uint256 indexed packageId, uint64 ruleVersion);
    event CoverageIntervalOpened(uint256 indexed policyId, uint256 indexed intervalIndex, uint64 startsAt, uint64 endsAt, uint64 waitingEndsAt);
    event CoverageIntervalClosed(uint256 indexed policyId, uint256 indexed intervalIndex, uint64 endsAt);
    event CoverageReserved(uint256 indexed policyId, uint256 indexed claimId, uint256 amount, uint256 remainingCoverage);
    event CoverageReleased(uint256 indexed policyId, uint256 indexed claimId, uint256 amount);
    event CoverageSettled(uint256 indexed policyId, uint256 indexed claimId, uint256 amount);
    event SolvencyConfigUpdated(uint16 reserveRatioBps, uint256 minimumCapitalBufferWei);
    event SolvencyWarning(uint256 actualBalanceWei, uint256 requiredBalanceWei);
    event TreasuryFundingAttributed(address indexed funder, bytes32 indexed fundingReference, uint256 amountWei);

    modifier onlyManager() {
        require(msg.sender == manager, "Caller is not manager");
        _;
    }

    modifier onlyManagerAdmin() {
        require(
            IPolicyEconomicsManager(manager).hasRole(ADMIN_ROLE, msg.sender),
            "Caller is not manager admin"
        );
        _;
    }

    constructor(address managerAddress, bool acceleratedTestnet) {
        require(managerAddress != address(0), "Invalid manager");
        require(!acceleratedTestnet || block.chainid == 31337 || block.chainid == 11155111 || block.chainid == 84532, "Test networks only");
        manager = managerAddress;
        PREMIUM_INTERVAL = acceleratedTestnet ? 10 minutes : 90 days;
        ADVANCE_WINDOW = acceleratedTestnet ? 8 minutes : 30 days;
        GRACE_PERIOD = acceleratedTestnet ? 2 minutes : 7 days;
    }

    function calendarProfile() public view returns (bytes32) {
        return PREMIUM_INTERVAL == 90 days ? keccak256("QUARTERLY") : keccak256("ACCELERATED_TESTNET");
    }

    function _premiumIntervalSeconds() internal view returns (uint256) { return PREMIUM_INTERVAL; }
    function _advanceWindowSeconds() internal view returns (uint256) { return ADVANCE_WINDOW; }
    function _gracePeriodSeconds() internal view returns (uint256) { return GRACE_PERIOD; }

    function getPaymentSchedule() external view returns (
        bytes32 profileId, uint256 intervalSeconds, uint256 advanceWindowSeconds, uint256 gracePeriodSeconds
    ) {
        return (calendarProfile(), _premiumIntervalSeconds(), _advanceWindowSeconds(), _gracePeriodSeconds());
    }

    function fundTreasury(bytes32 fundingReference) external payable {
        require(fundingReference != bytes32(0), "Funding reference required");
        require(msg.value > 0, "Funding amount required");
        (bool success, ) = payable(manager).call{value: msg.value}("");
        require(success, "Treasury funding failed");
        emit TreasuryFundingAttributed(msg.sender, fundingReference, msg.value);
    }

    function publishPackageRules(
        uint256 packageId,
        PackageRules calldata rules,
        bytes32[] calldata allowedServices,
        bytes32[] calldata excludedServices
    ) external onlyManagerAdmin {
        require(packageId != 0, "Package required");
        require(rules.version == currentPackageRuleVersion[packageId] + 1, "Version must increase by one");
        require(rules.minimumDocumentCommitments == 1, "Only primary invoice supported");
        require(rules.deductibleRateBps <= BPS && rules.insurerShareBps <= BPS, "Invalid settlement bps");
        require(rules.claimDeadline > 0, "Claim deadline required");
        require(rules.settlementFormulaVersion != bytes32(0), "Formula version required");
        require(rules.policyRuleVersion != bytes32(0), "Rule version required");

        packageRules[packageId][rules.version] = rules;
        currentPackageRuleVersion[packageId] = rules.version;
        bytes32 scope = keccak256(abi.encode(packageId, rules.version));
        packageAllowedServices[scope] = allowedServices;
        packageExcludedServices[scope] = excludedServices;
        for (uint256 i = 0; i < allowedServices.length; i++) {
            require(allowedServices[i] != bytes32(0), "Invalid allowed service");
            allowedServiceCodes[keccak256(abi.encode(scope, allowedServices[i]))] = true;
        }
        for (uint256 i = 0; i < excludedServices.length; i++) {
            require(excludedServices[i] != bytes32(0), "Invalid exclusion");
            excludedServiceCodes[keccak256(abi.encode(scope, excludedServices[i]))] = true;
        }
        emit PackageRulesPublished(packageId, rules.version, rules.policyRuleVersion);
    }

    function getPackageRules(uint256 packageId, uint64 version) external view returns (
        PackageRules memory rules, bytes32[] memory allowed, bytes32[] memory excluded
    ) {
        bytes32 scope = keccak256(abi.encode(packageId, version));
        return (packageRules[packageId][version], packageAllowedServices[scope], packageExcludedServices[scope]);
    }

    function validateAndBindOffer(uint256 packageId, bytes32 expectedIssueHash, uint256 policyId, bytes32 documentHash) external onlyManager {
        require(currentPackageRuleVersion[packageId] > 0 && expectedIssueHash == getPackageIssueHash(packageId), "Offer incomplete or changed");
        require(documentHash != bytes32(0) && issuedDocumentHash[policyId] == bytes32(0), "Invalid document binding");
        issuedDocumentHash[policyId] = documentHash;
    }

    function getPackageIssueHash(uint256 packageId) public view returns (bytes32) {
        return keccak256(abi.encode(IPolicyEconomicsManager(manager).getPolicyPackage(packageId), currentPackageRuleVersion[packageId]));
    }

    /// @notice Fixed periods from issue date. The first period is the advertised
    /// price; only a subsequent short final period is prorated (rounded up).
    /// Reinstatement pays the current calendar period, with no retroactive cover.
    function getInstallmentQuote(uint256 policyId, uint256 paidThrough) public view returns (InstallmentQuote memory q) {
        PolicyTerms memory terms = policyTerms[policyId];
        if (terms.holder == address(0) || coverageTerminated[policyId] ||
            paidThrough >= terms.endsAt || block.timestamp >= terms.endsAt) return q;
        uint256 interval = _premiumIntervalSeconds();
        uint256 period = (paidThrough - terms.startsAt) / interval;
        q.reinstatement = block.timestamp > paidThrough + _gracePeriodSeconds();
        if (q.reinstatement) period = (block.timestamp - terms.startsAt) / interval;
        q.installmentId = period + 1;
        q.dueAt = terms.startsAt + period * interval;
        q.endsAt = q.dueAt + interval;
        if (q.endsAt > terms.endsAt) q.endsAt = terms.endsAt;
        q.amountWei = (terms.premiumWei * (q.endsAt - q.dueAt) + interval - 1) / interval;
        q.opensAt = q.dueAt - _advanceWindowSeconds();
        q.payableNow = block.timestamp >= q.opensAt;
    }

    function acceptInstallment(uint256 policyId, uint256 paidThrough, uint256 expectedInstallmentId, uint256 amount)
        external onlyManager returns (uint256)
    {
        InstallmentQuote memory q = getInstallmentQuote(policyId, paidThrough);
        require(q.payableNow && q.installmentId == expectedInstallmentId, "Installment unavailable or changed");
        require(q.amountWei == amount, "Incorrect premium amount");
        _recordPremium(policyId, uint64(paidThrough), uint64(block.timestamp), uint64(q.endsAt));
        return q.endsAt;
    }

    function configureSolvency(uint16 newReserveRatioBps, uint256 newMinimumCapitalBufferWei)
        external
        onlyManagerAdmin
    {
        require(newReserveRatioBps <= BPS, "Reserve ratio exceeds maximum");
        reserveRatioBps = newReserveRatioBps;
        minimumCapitalBufferWei = newMinimumCapitalBufferWei;
        emit SolvencyConfigUpdated(newReserveRatioBps, newMinimumCapitalBufferWei);
    }

    function recordPolicy(
        uint256 policyId,
        uint256 packageId,
        address holder,
        uint64 startsAt,
        uint64 endsAt,
        uint64 paidThrough,
        uint256 coverageLimitWei,
        uint256 premiumWei,
        bytes32 requiredDocumentType
    ) external onlyManager {
        require(policyTerms[policyId].holder == address(0), "Policy already recorded");
        require(holder != address(0) && startsAt < endsAt, "Invalid policy");
        require(paidThrough > startsAt && paidThrough <= endsAt, "Invalid paid interval");
        require(coverageLimitWei > 0, "Coverage required");
        require(coverageLimitWei <= type(uint128).max, "Coverage exceeds supported precision");

        uint64 version = currentPackageRuleVersion[packageId];
        PackageRules memory configured = packageRules[packageId][version];
        PolicyTerms memory terms;
        terms.packageId = packageId;
        terms.holder = holder;
        terms.startsAt = startsAt;
        terms.endsAt = endsAt;
        terms.packageRuleVersion = version;
        terms.coverageLimitWei = coverageLimitWei;
        terms.premiumWei = premiumWei;

        if (version == 0) {
            terms.claimDeadline = 365 days;
            terms.minimumDocumentCommitments = 1;
            terms.deductibleRateBps = 1000;
            terms.insurerShareBps = 8000;
            terms.deductibleCapWei = 0.02 ether;
            terms.maximumClaimWei = uint128(coverageLimitWei);
            terms.requiredDocumentsRoot = keccak256(abi.encode(requiredDocumentType));
            terms.settlementFormulaVersion = keccak256("BLOCK_INSURE_SETTLEMENT_V1");
            terms.policyRuleVersion = keccak256(
                abi.encode(packageId, coverageLimitWei, premiumWei, requiredDocumentType)
            );
        } else {
            terms.waitingPeriod = configured.waitingPeriod;
            terms.reinstatementWaitingPeriod = configured.reinstatementWaitingPeriod;
            terms.claimDeadline = configured.claimDeadline;
            terms.minimumDocumentCommitments = configured.minimumDocumentCommitments;
            terms.deductibleRateBps = configured.deductibleRateBps;
            terms.insurerShareBps = configured.insurerShareBps;
            terms.deductibleCapWei = configured.deductibleCapWei;
            terms.maximumClaimWei = configured.maximumClaimWei == 0 || configured.maximumClaimWei > coverageLimitWei
                ? uint128(coverageLimitWei)
                : configured.maximumClaimWei;
            terms.exclusionsRoot = configured.exclusionsRoot;
            terms.requiredDocumentsRoot = configured.requiredDocumentsRoot;
            terms.settlementFormulaVersion = configured.settlementFormulaVersion;
            terms.policyRuleVersion = configured.policyRuleVersion;
        }

        policyTerms[policyId] = terms;
        coverageAccounts[policyId].coverageLimitWei = coverageLimitWei;
        activeExposureWei += coverageLimitWei;
        _openInterval(policyId, startsAt, paidThrough, terms.waitingPeriod);
        emit PolicyTermsSnapshotted(policyId, packageId, version);
    }

    function recordPremium(
        uint256 policyId,
        uint64 previousPaidThrough,
        uint64 paidAt,
        uint64 newPaidThrough
    ) external onlyManager {
        _recordPremium(policyId, previousPaidThrough, paidAt, newPaidThrough);
    }

    function _recordPremium(uint256 policyId, uint64 previousPaidThrough, uint64 paidAt, uint64 newPaidThrough) internal {
        PolicyTerms memory terms = policyTerms[policyId];
        require(terms.holder != address(0), "Policy not recorded");
        CoverageInterval[] storage intervals = coverageIntervals[policyId];
        require(intervals.length > 0, "Coverage interval missing");
        CoverageInterval storage latest = intervals[intervals.length - 1];

        if (paidAt <= previousPaidThrough) {
            if (newPaidThrough > latest.endsAt) latest.endsAt = newPaidThrough;
            return;
        }

        if (latest.endsAt > previousPaidThrough) latest.endsAt = previousPaidThrough;
        _openInterval(policyId, paidAt, newPaidThrough, terms.reinstatementWaitingPeriod);
    }

    function closeCoverage(uint256 policyId, uint64 closesAt) external onlyManager {
        coverageTerminated[policyId] = true;
        _closeExposure(policyId);
        CoverageInterval[] storage intervals = coverageIntervals[policyId];
        if (intervals.length == 0) return;
        CoverageInterval storage latest = intervals[intervals.length - 1];
        if (closesAt < latest.endsAt) latest.endsAt = closesAt;
        emit CoverageIntervalClosed(policyId, intervals.length - 1, latest.endsAt);
    }

    function closeExpiredExposure(uint256 policyId) external {
        PolicyTerms memory terms = policyTerms[policyId];
        require(terms.holder != address(0), "Policy not recorded");
        require(block.timestamp > terms.endsAt, "Policy term is active");
        coverageTerminated[policyId] = true;
        _closeExposure(policyId);
    }

    function validateAndReserveClaim(
        uint256 claimId,
        uint256 policyId,
        address claimant,
        uint256 claimAmountWei,
        uint64 incidentAt,
        bytes32 serviceCode,
        bytes32 invoiceId,
        uint16 documentCommitmentCount
    ) external onlyManager returns (uint256 insurerLiabilityWei) {
        PolicyTerms memory terms = policyTerms[policyId];
        require(terms.holder == claimant, "Policy owner mismatch");
        // The retained product is a cancellation refund, not death/maturity
        // cover. Cancelling closes future intervals; paid historical incidents
        // retain their original reporting deadline even after a refund.
        require(claimAmountWei > 0 && claimAmountWei <= terms.maximumClaimWei, "Claim amount not covered");
        require(incidentAt <= block.timestamp, "Incident is in the future");
        require(block.timestamp <= uint256(incidentAt) + terms.claimDeadline, "Claim deadline expired");
        require(documentCommitmentCount >= terms.minimumDocumentCommitments, "Required documents missing");
        require(invoiceId != bytes32(0) && invoiceClaimId[invoiceId] == 0, "Invoice identity already used");
        require(_isCovered(policyId, incidentAt), "Incident outside paid coverage interval");

        if (terms.packageRuleVersion > 0) {
            bytes32 scope = keccak256(abi.encode(terms.packageId, terms.packageRuleVersion));
            require(!excludedServiceCodes[keccak256(abi.encode(scope, serviceCode))], "Service is excluded");
            require(allowedServiceCodes[keccak256(abi.encode(scope, serviceCode))], "Claim type is not eligible");
        }

        (, , , insurerLiabilityWei, ) = _calculate(terms, claimAmountWei);
        require(insurerLiabilityWei > 0, "Settlement is zero");
        CoverageAccount storage account = coverageAccounts[policyId];
        require(
            account.reservedCoverageWei + account.settledCoverageWei + insurerLiabilityWei <= account.coverageLimitWei,
            "Remaining coverage exceeded"
        );

        account.reservedCoverageWei += insurerLiabilityWei;
        totalReservedCoverageWei += insurerLiabilityWei;
        if (exposureClosed[policyId]) {
            activeExposureWei += insurerLiabilityWei;
        }
        invoiceClaimId[invoiceId] = claimId;
        claimReservations[claimId] = ClaimReservation({
            policyId: policyId,
            claimAmountWei: claimAmountWei,
            liabilityWei: insurerLiabilityWei,
            invoiceId: invoiceId,
            reserved: true,
            settled: false
        });
        emit CoverageReserved(policyId, claimId, insurerLiabilityWei, remainingCoverage(policyId));
    }

    function reserveAppeal(uint256 claimId) external onlyManager {
        ClaimReservation storage reservation = claimReservations[claimId];
        // Cancellation refunds do not extinguish a covered medical claim's appeal.
        require(!reservation.reserved && !reservation.settled, "Claim coverage unavailable");
        CoverageAccount storage account = coverageAccounts[reservation.policyId];
        require(
            account.reservedCoverageWei + account.settledCoverageWei + reservation.liabilityWei <= account.coverageLimitWei,
            "Remaining coverage exceeded"
        );
        account.reservedCoverageWei += reservation.liabilityWei;
        totalReservedCoverageWei += reservation.liabilityWei;
        if (exposureClosed[reservation.policyId]) {
            activeExposureWei += reservation.liabilityWei;
        }
        reservation.reserved = true;
        emit CoverageReserved(reservation.policyId, claimId, reservation.liabilityWei, remainingCoverage(reservation.policyId));
    }

    function amendRejectedClaim(uint256 claimId, uint256 amount, bytes32 invoiceId) external onlyManager {
        ClaimReservation storage reservation = claimReservations[claimId];
        require(!reservation.reserved && !reservation.settled, "Claim coverage unavailable");
        PolicyTerms memory terms = policyTerms[reservation.policyId];
        require(amount > 0 && amount <= terms.maximumClaimWei, "Claim amount not covered");
        require(invoiceId != bytes32(0) && (invoiceClaimId[invoiceId] == 0 || invoiceClaimId[invoiceId] == claimId), "Invoice identity already used");
        (, , , uint256 liability, ) = _calculate(terms, amount);
        require(liability > 0, "Settlement is zero");
        // Old invoice identities remain bound to this claim to prevent replay.
        invoiceClaimId[invoiceId] = claimId;
        reservation.invoiceId = invoiceId;
        reservation.claimAmountWei = amount;
        reservation.liabilityWei = liability;
    }

    function releaseClaim(uint256 claimId) external onlyManager {
        ClaimReservation storage reservation = claimReservations[claimId];
        if (!reservation.reserved || reservation.settled) return;
        CoverageAccount storage account = coverageAccounts[reservation.policyId];
        account.reservedCoverageWei -= reservation.liabilityWei;
        totalReservedCoverageWei -= reservation.liabilityWei;
        reservation.reserved = false;
        if (exposureClosed[reservation.policyId]) {
            activeExposureWei -= reservation.liabilityWei;
        }
        emit CoverageReleased(reservation.policyId, claimId, reservation.liabilityWei);
    }

    function settleClaim(uint256 claimId) external onlyManager {
        ClaimReservation storage reservation = claimReservations[claimId];
        require(reservation.reserved && !reservation.settled, "Claim is not reserved");
        CoverageAccount storage account = coverageAccounts[reservation.policyId];
        account.reservedCoverageWei -= reservation.liabilityWei;
        account.settledCoverageWei += reservation.liabilityWei;
        totalReservedCoverageWei -= reservation.liabilityWei;
        reservation.reserved = false;
        reservation.settled = true;
        activeExposureWei -= reservation.liabilityWei;
        emit CoverageSettled(reservation.policyId, claimId, reservation.liabilityWei);
    }

    function calculateSettlement(uint256 claimId)
        external
        view
        returns (
            uint256 claimAmount,
            uint256 deductible,
            uint256 afterDeductible,
            uint256 insurerPays,
            uint256 claimantResponsibility
        )
    {
        ClaimReservation memory reservation = claimReservations[claimId];
        require(reservation.policyId != 0, "Claim not recorded");
        return _calculate(policyTerms[reservation.policyId], reservation.claimAmountWei);
    }

    function minimumTreasuryBalance(uint256 approvedUnfundedLiabilityWei)
        external
        view
        returns (uint256)
    {
        return approvedUnfundedLiabilityWei + minimumCapitalBufferWei + ((activeExposureWei * reserveRatioBps) / BPS);
    }

    function remainingCoverage(uint256 policyId) public view returns (uint256) {
        CoverageAccount memory account = coverageAccounts[policyId];
        return account.coverageLimitWei - account.reservedCoverageWei - account.settledCoverageWei;
    }

    function getPolicyTerms(uint256 policyId) external view returns (PolicyTerms memory) {
        require(policyTerms[policyId].holder != address(0), "Policy not recorded");
        return policyTerms[policyId];
    }

    function getCoverageAccount(uint256 policyId) external view returns (CoverageAccount memory) {
        require(policyTerms[policyId].holder != address(0), "Policy not recorded");
        return coverageAccounts[policyId];
    }

    function getCoverageIntervals(uint256 policyId) external view returns (CoverageInterval[] memory) {
        return coverageIntervals[policyId];
    }

    function getClaimReservation(uint256 claimId) external view returns (ClaimReservation memory) {
        return claimReservations[claimId];
    }

    function _openInterval(uint256 policyId, uint64 startsAt, uint64 endsAt, uint64 waitingPeriod) internal {
        require(startsAt < endsAt, "Empty coverage interval");
        uint64 waitingEndsAt = startsAt + waitingPeriod;
        if (waitingEndsAt > endsAt) waitingEndsAt = endsAt;
        coverageIntervals[policyId].push(CoverageInterval(startsAt, endsAt, waitingEndsAt));
        emit CoverageIntervalOpened(policyId, coverageIntervals[policyId].length - 1, startsAt, endsAt, waitingEndsAt);
    }

    function _closeExposure(uint256 policyId) internal {
        if (exposureClosed[policyId]) return;
        activeExposureWei -= remainingCoverage(policyId);
        exposureClosed[policyId] = true;
    }

    function _isCovered(uint256 policyId, uint64 incidentAt) internal view returns (bool) {
        CoverageInterval[] storage intervals = coverageIntervals[policyId];
        for (uint256 i = intervals.length; i > 0; i--) {
            CoverageInterval storage interval = intervals[i - 1];
            if (incidentAt >= interval.waitingEndsAt && incidentAt <= interval.endsAt) return true;
        }
        return false;
    }

    function _calculate(PolicyTerms memory terms, uint256 claimAmount)
        internal
        pure
        returns (
            uint256,
            uint256 deductible,
            uint256 afterDeductible,
            uint256 insurerPays,
            uint256 claimantResponsibility
        )
    {
        uint256 rateDeductible = (claimAmount * terms.deductibleRateBps) / BPS;
        deductible = rateDeductible < terms.deductibleCapWei ? rateDeductible : terms.deductibleCapWei;
        if (deductible > claimAmount) deductible = claimAmount;
        afterDeductible = claimAmount - deductible;
        insurerPays = (afterDeductible * terms.insurerShareBps) / BPS;
        claimantResponsibility = claimAmount - insurerPays;
        return (claimAmount, deductible, afterDeductible, insurerPays, claimantResponsibility);
    }
}
