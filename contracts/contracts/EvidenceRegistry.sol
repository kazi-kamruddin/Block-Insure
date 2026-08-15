// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

interface IEvidenceRoleManager {
    function hasRole(bytes32 role, address account) external view returns (bool);
}

contract EvidenceRegistry {
    using ECDSA for bytes32;
    using MessageHashUtils for bytes32;

    bytes32 private constant ADMIN_ROLE = keccak256("ADMIN_ROLE");

    struct EncryptionIdentity {
        bytes publicKey;
        bytes signingPublicKey;
        uint64 version;
        uint64 registeredAt;
        uint64 revokedAt;
        bytes32 schemeVersion;
    }

    struct AnchoredTreeHead {
        uint64 treeSize;
        uint64 anchoredAt;
        uint64 anchoredBlock;
        bytes32 rootHash;
        bytes32 previousRootHash;
        address signer;
    }

    address public immutable manager;
    address public treeHeadSigner;
    uint64 public currentTreeSize;
    bytes32 public currentRootHash;

    mapping(address => EncryptionIdentity) private encryptionIdentities;
    mapping(uint64 => AnchoredTreeHead) private treeHeads;

    event EncryptionIdentityRegistered(
        address indexed account,
        uint64 indexed version,
        bytes32 indexed schemeVersion,
        bytes32 publicKeyHash
    );
    event EncryptionIdentityRevoked(address indexed account, uint64 indexed version, uint64 revokedAt);
    event EvidenceTreeHeadAnchored(
        uint64 indexed treeSize,
        bytes32 indexed rootHash,
        bytes32 indexed previousRootHash,
        address signer,
        bytes signature
    );
    event TreeHeadSignerUpdated(address indexed previousSigner, address indexed newSigner);

    constructor(address managerAddress) {
        require(managerAddress != address(0), "Invalid manager");
        manager = managerAddress;
        treeHeadSigner = msg.sender;
    }

    function setTreeHeadSigner(address newSigner) external {
        require(
            IEvidenceRoleManager(manager).hasRole(ADMIN_ROLE, msg.sender),
            "Caller is not manager admin"
        );
        require(newSigner != address(0), "Invalid tree-head signer");
        emit TreeHeadSignerUpdated(treeHeadSigner, newSigner);
        treeHeadSigner = newSigner;
    }

    function registerEncryptionIdentity(
        bytes calldata publicKey,
        bytes calldata signingPublicKey,
        bytes32 schemeVersion
    ) external {
        require(publicKey.length >= 64, "Encryption public key required");
        require(signingPublicKey.length >= 32, "Signing public key required");
        require(schemeVersion != bytes32(0), "Scheme version required");
        EncryptionIdentity storage identity = encryptionIdentities[msg.sender];
        uint64 version = identity.version + 1;
        encryptionIdentities[msg.sender] = EncryptionIdentity({
            publicKey: publicKey,
            signingPublicKey: signingPublicKey,
            version: version,
            registeredAt: uint64(block.timestamp),
            revokedAt: 0,
            schemeVersion: schemeVersion
        });
        emit EncryptionIdentityRegistered(
            msg.sender,
            version,
            schemeVersion,
            keccak256(abi.encode(publicKey, signingPublicKey))
        );
    }

    function revokeEncryptionIdentity() external {
        EncryptionIdentity storage identity = encryptionIdentities[msg.sender];
        require(identity.version > 0 && identity.revokedAt == 0, "No active identity");
        identity.revokedAt = uint64(block.timestamp);
        emit EncryptionIdentityRevoked(msg.sender, identity.version, identity.revokedAt);
    }

    function anchorEvidenceTreeHead(
        uint64 treeSize,
        bytes32 rootHash,
        bytes32 previousRootHash,
        bytes calldata signature
    ) external {
        require(
            IEvidenceRoleManager(manager).hasRole(ADMIN_ROLE, msg.sender),
            "Caller is not manager admin"
        );
        require(treeSize > currentTreeSize, "Tree size must increase");
        require(rootHash != bytes32(0), "Root required");
        require(previousRootHash == currentRootHash, "Previous root mismatch");
        bytes32 digest = treeHeadDigest(treeSize, rootHash, previousRootHash);
        address signer = digest.toEthSignedMessageHash().recover(signature);
        require(signer == treeHeadSigner, "Invalid tree-head signature");

        treeHeads[treeSize] = AnchoredTreeHead({
            treeSize: treeSize,
            anchoredAt: uint64(block.timestamp),
            anchoredBlock: uint64(block.number),
            rootHash: rootHash,
            previousRootHash: previousRootHash,
            signer: signer
        });
        currentTreeSize = treeSize;
        currentRootHash = rootHash;
        emit EvidenceTreeHeadAnchored(treeSize, rootHash, previousRootHash, signer, signature);
    }

    function treeHeadDigest(uint64 treeSize, bytes32 rootHash, bytes32 previousRootHash)
        public
        view
        returns (bytes32)
    {
        return keccak256(abi.encode(address(this), block.chainid, treeSize, rootHash, previousRootHash));
    }

    function getEncryptionIdentity(address account)
        external
        view
        returns (EncryptionIdentity memory)
    {
        require(encryptionIdentities[account].version > 0, "Identity not registered");
        return encryptionIdentities[account];
    }

    function getTreeHead(uint64 treeSize) external view returns (AnchoredTreeHead memory) {
        require(treeHeads[treeSize].treeSize > 0, "Tree head not found");
        return treeHeads[treeSize];
    }
}
