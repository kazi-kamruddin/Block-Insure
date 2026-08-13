// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

interface IOracleConsumer {
    function hasRole(bytes32 role, address account) external view returns (bool);

    function isOracleRequestProcessable(uint256 claimId) external view returns (bool);

    function finalizeOracleResult(
        uint256 requestId,
        uint256 claimId,
        bool verified,
        bytes32 resultHash,
        uint8 finalizationCode
    ) external;
}

contract OracleCoordinator {
    bytes32 private constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    uint8 public constant FINALIZED_EXACT_QUORUM = 1;
    uint8 public constant FINALIZED_CONFLICT = 2;
    uint8 public constant FINALIZED_TIMEOUT = 3;

    struct OracleRequest {
        uint256 requestId;
        uint256 claimId;
        bytes32 queryHash;
        uint256 requestedAt;
        uint256 requestBlock;
        uint256 commitDeadlineBlock;
        uint256 revealDeadlineBlock;
        uint64 claimVersion;
        uint64 registryVersion;
        bytes32 registryRoot;
        bytes32 modelVersion;
        uint8 requiredConfirmations;
        uint8 expectedResponses;
        bool isFulfilled;
        bool verifiedResult;
        bytes32 resultHash;
        uint8 finalizationCode;
    }

    struct RegistrySnapshot {
        bytes32 root;
        bytes32 treeVersionHash;
        uint256 publishedAt;
        uint256 publishedAtBlock;
        uint256 leafCount;
    }

    address public immutable manager;
    uint256 public requestCounter = 1;
    uint8 public quorumThreshold = 2;
    uint256 public commitWindowBlocks = 25;
    uint256 public revealWindowBlocks = 25;

    uint64 public currentRegistryVersion;
    bytes32 public currentRegistryRoot;
    uint256 public currentRegistryTimestamp;
    uint256 public currentRegistryBlock;

    mapping(uint64 => RegistrySnapshot) private registrySnapshots;
    mapping(uint256 => OracleRequest) private requests;
    mapping(uint256 => uint256) public requestByClaimId;
    mapping(uint256 => uint8) public commitmentCount;
    mapping(uint256 => uint8) public revealCount;
    mapping(uint256 => mapping(address => bool)) public eligibleForRequest;
    mapping(uint256 => mapping(address => bytes32)) public commitments;
    mapping(uint256 => mapping(address => bool)) public hasRevealed;
    mapping(uint256 => mapping(bytes32 => uint8)) public exactResultCount;

    address[] private activeOracles;
    mapping(address => uint256) private activeOracleIndexPlusOne;

    event OracleRequested(
        uint256 indexed requestId,
        uint256 indexed claimId,
        bytes32 indexed queryHash,
        uint64 claimVersion,
        uint64 registryVersion,
        bytes32 registryRoot,
        bytes32 modelVersion,
        uint8 requiredConfirmations,
        uint8 expectedResponses,
        uint256 commitDeadlineBlock,
        uint256 revealDeadlineBlock
    );
    event OracleCommitmentSubmitted(
        uint256 indexed requestId,
        address indexed oracle,
        bytes32 commitment,
        uint8 commitmentCount
    );
    event OracleResultRevealed(
        uint256 indexed requestId,
        address indexed oracle,
        bytes32 indexed exactResultDigest,
        bool verified,
        bytes32 resultHash,
        uint8 exactResultCount,
        uint8 revealCount
    );
    event OracleRequestFinalized(
        uint256 indexed requestId,
        uint256 indexed claimId,
        bool verified,
        bytes32 resultHash,
        uint8 finalizationCode
    );
    event OracleRegistrationUpdated(address indexed oracle, bool active);
    event ConsensusConfigUpdated(
        uint8 quorumThreshold,
        uint256 commitWindowBlocks,
        uint256 revealWindowBlocks
    );
    event RegistrySnapshotPublished(
        uint64 indexed version,
        bytes32 indexed root,
        bytes32 indexed treeVersionHash,
        uint256 leafCount,
        uint256 timestamp,
        uint256 blockNumber
    );

    modifier onlyManager() {
        require(msg.sender == manager, "Caller is not manager");
        _;
    }

    modifier onlyManagerAdmin() {
        require(
            msg.sender == manager || IOracleConsumer(manager).hasRole(ADMIN_ROLE, msg.sender),
            "Caller is not manager admin"
        );
        _;
    }

    constructor(address managerAddress) {
        require(managerAddress != address(0), "Manager address required");
        manager = managerAddress;
    }

    function setOracle(address oracle, bool active) external onlyManager {
        require(oracle != address(0), "Oracle address required");
        uint256 indexPlusOne = activeOracleIndexPlusOne[oracle];

        if (active && indexPlusOne == 0) {
            activeOracles.push(oracle);
            activeOracleIndexPlusOne[oracle] = activeOracles.length;
        } else if (!active && indexPlusOne != 0) {
            uint256 index = indexPlusOne - 1;
            uint256 lastIndex = activeOracles.length - 1;
            if (index != lastIndex) {
                address replacement = activeOracles[lastIndex];
                activeOracles[index] = replacement;
                activeOracleIndexPlusOne[replacement] = index + 1;
            }
            activeOracles.pop();
            delete activeOracleIndexPlusOne[oracle];
        }

        emit OracleRegistrationUpdated(oracle, active);
    }

    function getActiveOracles() external view returns (address[] memory) {
        return activeOracles;
    }

    function isActiveOracle(address oracle) public view returns (bool) {
        return activeOracleIndexPlusOne[oracle] != 0;
    }

    function updateConsensusConfig(
        uint8 threshold,
        uint256 commitBlocks,
        uint256 revealBlocks
    ) external onlyManagerAdmin {
        require(threshold >= 2, "Quorum threshold must be at least 2");
        require(commitBlocks > 0, "Commit window required");
        require(revealBlocks > 0, "Reveal window required");
        quorumThreshold = threshold;
        commitWindowBlocks = commitBlocks;
        revealWindowBlocks = revealBlocks;
        emit ConsensusConfigUpdated(threshold, commitBlocks, revealBlocks);
    }

    function publishRegistrySnapshot(
        bytes32 root,
        uint256 leafCount,
        bytes32 treeVersionHash
    ) external onlyManagerAdmin returns (uint64 version) {
        require(root != bytes32(0), "Registry root required");
        require(treeVersionHash != bytes32(0), "Tree version hash required");
        require(leafCount > 0, "Registry cannot be empty");

        version = currentRegistryVersion + 1;
        currentRegistryVersion = version;
        currentRegistryRoot = root;
        currentRegistryTimestamp = block.timestamp;
        currentRegistryBlock = block.number;
        registrySnapshots[version] = RegistrySnapshot({
            root: root,
            treeVersionHash: treeVersionHash,
            publishedAt: block.timestamp,
            publishedAtBlock: block.number,
            leafCount: leafCount
        });

        emit RegistrySnapshotPublished(
            version,
            root,
            treeVersionHash,
            leafCount,
            block.timestamp,
            block.number
        );
    }

    function getRegistrySnapshot(uint64 version) external view returns (RegistrySnapshot memory) {
        require(version > 0 && version <= currentRegistryVersion, "Registry version does not exist");
        return registrySnapshots[version];
    }

    function createRequest(
        uint256 claimId,
        bytes32 queryHash,
        uint64 claimVersion,
        bytes32 modelVersion
    ) external onlyManager returns (uint256 requestId) {
        require(currentRegistryVersion > 0, "Registry snapshot is not published");
        require(activeOracles.length >= quorumThreshold, "Insufficient active oracles");
        require(activeOracles.length <= type(uint8).max, "Too many active oracles");
        require(queryHash != bytes32(0), "Query hash required");
        require(claimVersion > 0, "Claim version required");
        require(modelVersion != bytes32(0), "Model version required");

        requestId = requestCounter++;
        uint256 commitDeadline = block.number + commitWindowBlocks;
        uint256 revealDeadline = commitDeadline + revealWindowBlocks;
        uint8 expectedResponses = uint8(activeOracles.length);

        requests[requestId] = OracleRequest({
            requestId: requestId,
            claimId: claimId,
            queryHash: queryHash,
            requestedAt: block.timestamp,
            requestBlock: block.number,
            commitDeadlineBlock: commitDeadline,
            revealDeadlineBlock: revealDeadline,
            claimVersion: claimVersion,
            registryVersion: currentRegistryVersion,
            registryRoot: currentRegistryRoot,
            modelVersion: modelVersion,
            requiredConfirmations: quorumThreshold,
            expectedResponses: expectedResponses,
            isFulfilled: false,
            verifiedResult: false,
            resultHash: bytes32(0),
            finalizationCode: 0
        });
        requestByClaimId[claimId] = requestId;

        for (uint256 i = 0; i < activeOracles.length; i++) {
            eligibleForRequest[requestId][activeOracles[i]] = true;
        }

        emit OracleRequested(
            requestId,
            claimId,
            queryHash,
            claimVersion,
            currentRegistryVersion,
            currentRegistryRoot,
            modelVersion,
            quorumThreshold,
            expectedResponses,
            commitDeadline,
            revealDeadline
        );
    }

    function getRequest(uint256 requestId) external view returns (OracleRequest memory) {
        require(_requestExists(requestId), "Oracle request does not exist");
        return requests[requestId];
    }

    function getRequestByClaimId(uint256 claimId) external view returns (OracleRequest memory) {
        uint256 requestId = requestByClaimId[claimId];
        require(requestId != 0, "Oracle request does not exist");
        return requests[requestId];
    }

    function commitOracleResult(uint256 requestId, bytes32 commitment) external {
        require(_requestExists(requestId), "Oracle request does not exist");
        OracleRequest storage requestData = requests[requestId];
        require(!requestData.isFulfilled, "Oracle request already fulfilled");
        require(eligibleForRequest[requestId][msg.sender], "Oracle is not eligible for request");
        require(IOracleConsumer(manager).isOracleRequestProcessable(requestData.claimId), "Claim is not oracle pending");
        require(block.number <= requestData.commitDeadlineBlock, "Oracle commit phase ended");
        require(commitment != bytes32(0), "Oracle commitment required");
        require(commitments[requestId][msg.sender] == bytes32(0), "Oracle already committed");

        commitments[requestId][msg.sender] = commitment;
        commitmentCount[requestId]++;
        emit OracleCommitmentSubmitted(requestId, msg.sender, commitment, commitmentCount[requestId]);
    }

    function revealOracleResult(
        uint256 requestId,
        bool verified,
        bytes32 resultHash,
        uint64 revealedClaimVersion,
        uint64 revealedRegistryVersion,
        bytes32 revealedModelVersion,
        bytes32 salt
    ) external {
        require(_requestExists(requestId), "Oracle request does not exist");
        OracleRequest storage requestData = requests[requestId];
        require(!requestData.isFulfilled, "Oracle request already fulfilled");
        require(eligibleForRequest[requestId][msg.sender], "Oracle is not eligible for request");
        require(IOracleConsumer(manager).isOracleRequestProcessable(requestData.claimId), "Claim is not oracle pending");
        require(
            block.number > requestData.commitDeadlineBlock ||
                commitmentCount[requestId] == requestData.expectedResponses,
            "Oracle reveal phase has not started"
        );
        require(block.number <= requestData.revealDeadlineBlock, "Oracle reveal phase ended");
        require(!hasRevealed[requestId][msg.sender], "Oracle already revealed");
        require(resultHash != bytes32(0), "Result hash required");
        require(revealedClaimVersion == requestData.claimVersion, "Claim version mismatch");
        require(revealedRegistryVersion == requestData.registryVersion, "Registry version mismatch");
        require(revealedModelVersion == requestData.modelVersion, "Model version mismatch");

        bytes32 expectedCommitment = keccak256(
            abi.encode(
                requestId,
                revealedClaimVersion,
                revealedRegistryVersion,
                verified,
                resultHash,
                revealedModelVersion,
                salt
            )
        );
        require(commitments[requestId][msg.sender] == expectedCommitment, "Reveal does not match commitment");

        bytes32 exactResultDigest = keccak256(
            abi.encode(
                verified,
                resultHash,
                revealedClaimVersion,
                revealedRegistryVersion,
                revealedModelVersion
            )
        );
        hasRevealed[requestId][msg.sender] = true;
        revealCount[requestId]++;
        exactResultCount[requestId][exactResultDigest]++;

        uint8 matchingCount = exactResultCount[requestId][exactResultDigest];
        emit OracleResultRevealed(
            requestId,
            msg.sender,
            exactResultDigest,
            verified,
            resultHash,
            matchingCount,
            revealCount[requestId]
        );

        if (matchingCount >= requestData.requiredConfirmations) {
            _finalize(requestData, verified, resultHash, FINALIZED_EXACT_QUORUM);
        } else if (revealCount[requestId] == requestData.expectedResponses) {
            _finalize(requestData, false, bytes32(0), FINALIZED_CONFLICT);
        }
    }

    function resolveTimedOutRequest(uint256 claimId) external {
        uint256 requestId = requestByClaimId[claimId];
        require(requestId != 0, "Oracle request does not exist");
        OracleRequest storage requestData = requests[requestId];
        require(!requestData.isFulfilled, "Oracle request already fulfilled");
        require(block.number > requestData.revealDeadlineBlock, "Oracle request has not timed out");
        _finalize(requestData, false, bytes32(0), FINALIZED_TIMEOUT);
    }

    function _finalize(
        OracleRequest storage requestData,
        bool verified,
        bytes32 resultHash,
        uint8 finalizationCode
    ) internal {
        requestData.isFulfilled = true;
        requestData.verifiedResult = verified;
        requestData.resultHash = resultHash;
        requestData.finalizationCode = finalizationCode;

        IOracleConsumer(manager).finalizeOracleResult(
            requestData.requestId,
            requestData.claimId,
            verified,
            resultHash,
            finalizationCode
        );
        emit OracleRequestFinalized(
            requestData.requestId,
            requestData.claimId,
            verified,
            resultHash,
            finalizationCode
        );
    }

    function _requestExists(uint256 requestId) internal view returns (bool) {
        return requests[requestId].requestId != 0;
    }
}
