// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "@openzeppelin/contracts/access/AccessControl.sol";

interface IInsuranceHospitalClaims {
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
        uint8 status;
        uint256 verificationConfidence;
        uint256 submittedAt;
    }

    function getClaim(uint256 claimId) external view returns (Claim memory);
    function claimVersion(uint256 claimId) external view returns (uint64);
}

contract HospitalVerificationRegistry is AccessControl {
    bytes32 public constant HOSPITAL_ROLE = keccak256("HOSPITAL_ROLE");

    struct Verification {
        bool completed;
        bool verified;
        address hospitalWallet;
        bytes32 attestationHash;
        uint64 claimVersion;
        uint256 verifiedAt;
    }

    IInsuranceHospitalClaims public immutable manager;
    mapping(bytes32 => address) public hospitalWalletByIdHash;
    mapping(address => bytes32) public hospitalIdHashByWallet;
    mapping(uint256 => Verification) public hospitalVerifications;

    event HospitalIdentityRegistered(
        bytes32 indexed hospitalIdHash,
        string hospitalId,
        address indexed hospitalWallet
    );
    event HospitalClaimVerified(
        uint256 indexed claimId,
        bytes32 indexed hospitalIdHash,
        address indexed hospitalWallet,
        bool verified,
        bytes32 attestationHash,
        uint64 claimVersion,
        uint256 verifiedAt
    );

    constructor(address managerAddress, address admin) {
        require(managerAddress != address(0) && admin != address(0), "Invalid configuration");
        manager = IInsuranceHospitalClaims(managerAddress);
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    function registerHospitalIdentity(
        string calldata hospitalId,
        address hospitalWallet
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(bytes(hospitalId).length > 0, "Hospital ID required");
        require(hospitalWallet != address(0), "Invalid hospital wallet");
        bytes32 hospitalIdHash = keccak256(bytes(hospitalId));
        address currentWallet = hospitalWalletByIdHash[hospitalIdHash];
        bytes32 currentHospitalIdHash = hospitalIdHashByWallet[hospitalWallet];
        require(currentWallet == address(0) || currentWallet == hospitalWallet, "Hospital ID assigned");
        require(currentHospitalIdHash == bytes32(0) || currentHospitalIdHash == hospitalIdHash, "Wallet assigned");

        hospitalWalletByIdHash[hospitalIdHash] = hospitalWallet;
        hospitalIdHashByWallet[hospitalWallet] = hospitalIdHash;
        _grantRole(HOSPITAL_ROLE, hospitalWallet);
        emit HospitalIdentityRegistered(hospitalIdHash, hospitalId, hospitalWallet);
    }

    function submitHospitalVerification(
        uint256 claimId,
        bool verified,
        bytes32 attestationHash
    ) external onlyRole(HOSPITAL_ROLE) {
        require(attestationHash != bytes32(0), "Attestation hash required");
        IInsuranceHospitalClaims.Claim memory claim = manager.getClaim(claimId);
        require(claim.status == 1 || claim.status == 12, "Claim is not awaiting hospital");
        bytes32 hospitalIdHash = keccak256(bytes(claim.hospitalId));
        require(
            hospitalWalletByIdHash[hospitalIdHash] == msg.sender &&
                hospitalIdHashByWallet[msg.sender] == hospitalIdHash,
            "Claim belongs to another hospital"
        );
        uint64 version = manager.claimVersion(claimId);
        hospitalVerifications[claimId] = Verification({
            completed: true,
            verified: verified,
            hospitalWallet: msg.sender,
            attestationHash: attestationHash,
            claimVersion: version,
            verifiedAt: block.timestamp
        });
        emit HospitalClaimVerified(
            claimId,
            hospitalIdHash,
            msg.sender,
            verified,
            attestationHash,
            version,
            block.timestamp
        );
    }

    function isClaimVerificationComplete(
        uint256 claimId,
        uint64 version
    ) external view returns (bool) {
        Verification memory verification = hospitalVerifications[claimId];
        return verification.completed && verification.claimVersion == version;
    }

    function isClaimVerified(uint256 claimId, uint64 version) external view returns (bool) {
        Verification memory verification = hospitalVerifications[claimId];
        return verification.completed && verification.verified && verification.claimVersion == version;
    }
}
