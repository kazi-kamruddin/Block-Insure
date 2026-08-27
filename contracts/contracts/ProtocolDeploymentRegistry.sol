// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Immutable-version deployment directory and V2 migration commitment.
/// @dev This deliberately avoids an upgrade proxy or a privileged implementation switch.
contract ProtocolDeploymentRegistry {
    struct ComponentDeployment {
        address deployment;
        bytes32 interfaceVersion;
        uint64 registeredAt;
        bool active;
    }

    address public immutable administrator;
    bytes32 public immutable protocolVersion;
    bytes32 public migrationManifestHash;
    mapping(bytes32 => ComponentDeployment) private components;

    event ComponentRegistered(
        bytes32 indexed componentId,
        address indexed deployment,
        bytes32 indexed interfaceVersion,
        bool active
    );
    event MigrationManifestCommitted(bytes32 indexed manifestHash);

    modifier onlyAdministrator() {
        require(msg.sender == administrator, "Administrator only");
        _;
    }

    constructor(bytes32 version, bytes32 manifestHash) {
        require(version != bytes32(0), "Protocol version required");
        administrator = msg.sender;
        protocolVersion = version;
        migrationManifestHash = manifestHash;
    }

    function registerComponent(
        bytes32 componentId,
        address deployment,
        bytes32 interfaceVersion,
        bool active
    ) external onlyAdministrator {
        require(componentId != bytes32(0), "Component required");
        require(deployment != address(0), "Deployment required");
        require(interfaceVersion != bytes32(0), "Interface version required");
        components[componentId] = ComponentDeployment({
            deployment: deployment,
            interfaceVersion: interfaceVersion,
            registeredAt: uint64(block.timestamp),
            active: active
        });
        emit ComponentRegistered(componentId, deployment, interfaceVersion, active);
    }

    function commitMigrationManifest(bytes32 manifestHash) external onlyAdministrator {
        require(manifestHash != bytes32(0), "Manifest hash required");
        migrationManifestHash = manifestHash;
        emit MigrationManifestCommitted(manifestHash);
    }

    function getComponent(bytes32 componentId) external view returns (ComponentDeployment memory) {
        ComponentDeployment memory component = components[componentId];
        require(component.deployment != address(0), "Unknown component");
        return component;
    }
}
