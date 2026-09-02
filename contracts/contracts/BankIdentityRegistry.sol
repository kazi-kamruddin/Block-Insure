// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "@openzeppelin/contracts/access/AccessControl.sol";

interface IExternalPremiumManager {
    function paused() external view returns (bool);

    function recordExternalPremium(
        uint256 policyId,
        address policyholder,
        uint256 amountWei
    ) external;
}

/// @notice Establishes independently authorized bank identities for the EFT subsystem.
/// @dev Mandates and scheduled transfers will be added separately; this contract only
///      creates the authority boundary required by that later workflow.
contract BankIdentityRegistry is AccessControl {
    bytes32 public constant BANK_ROLE = keccak256("BANK_ROLE");

    IExternalPremiumManager public immutable insuranceManager;

    mapping(bytes32 => address) public bankWalletByIdHash;
    mapping(address => bytes32) public bankIdHashByWallet;
    mapping(bytes32 => bool) public processedTransferReferences;

    event BankIdentityRegistered(
        bytes32 indexed bankIdHash,
        string bankId,
        address indexed bankWallet
    );
    event EftTransferConfirmed(
        bytes32 indexed transferReference,
        uint256 indexed policyId,
        address indexed policyholder,
        address bankWallet,
        uint256 amountWei,
        bytes32 mandateHash
    );

    constructor(address managerAddress, address admin) {
        require(managerAddress != address(0), "Invalid manager");
        require(admin != address(0), "Invalid administrator");
        insuranceManager = IExternalPremiumManager(managerAddress);
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    function registerBankIdentity(
        string calldata bankId,
        address bankWallet
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(bytes(bankId).length > 0, "Bank ID required");
        require(bankWallet != address(0), "Invalid bank wallet");

        bytes32 bankIdHash = keccak256(bytes(bankId));
        address currentWallet = bankWalletByIdHash[bankIdHash];
        bytes32 currentBankIdHash = bankIdHashByWallet[bankWallet];
        require(currentWallet == address(0) || currentWallet == bankWallet, "Bank ID assigned");
        require(currentBankIdHash == bytes32(0) || currentBankIdHash == bankIdHash, "Wallet assigned");

        bankWalletByIdHash[bankIdHash] = bankWallet;
        bankIdHashByWallet[bankWallet] = bankIdHash;
        _grantRole(BANK_ROLE, bankWallet);
        emit BankIdentityRegistered(bankIdHash, bankId, bankWallet);
    }

    /// @notice Records a bank-confirmed fiat transfer against the policy ledger.
    /// @dev No native currency is moved here: the bank-owned account ledger is the
    ///      source of truth for the simulated BDT debit, while this call creates an
    ///      immutable, replay-protected premium receipt on-chain.
    function confirmEftTransfer(
        uint256 policyId,
        address policyholder,
        uint256 amountWei,
        bytes32 transferReference,
        bytes32 mandateHash
    ) external onlyRole(BANK_ROLE) {
        require(policyholder != address(0), "Invalid policyholder");
        require(amountWei > 0, "Invalid amount");
        require(transferReference != bytes32(0), "Transfer reference required");
        require(!processedTransferReferences[transferReference], "Transfer already processed");
        require(!insuranceManager.paused(), "Insurance manager paused");

        processedTransferReferences[transferReference] = true;
        insuranceManager.recordExternalPremium(
            policyId,
            policyholder,
            amountWei
        );
        emit EftTransferConfirmed(
            transferReference,
            policyId,
            policyholder,
            msg.sender,
            amountWei,
            mandateHash
        );
    }
}
