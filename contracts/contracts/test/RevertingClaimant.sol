// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

interface IInsuranceClaims {
    function purchasePolicy(uint256 packageId) external payable returns (uint256);
    function submitClaim(
        uint256 policyId,
        uint256 claimAmount,
        uint256 incidentDate,
        string memory claimType,
        string memory hospitalId,
        bytes32 invoiceHash,
        bytes32 documentHash,
        string memory documentCID
    ) external returns (uint256);
    function withdrawSettlement(uint256 claimId) external;
}

contract RevertingClaimant {
    function purchase(address manager, uint256 packageId) external payable returns (uint256) {
        return IInsuranceClaims(manager).purchasePolicy{value: msg.value}(packageId);
    }

    function submit(address manager, uint256 policyId, uint256 incidentDate)
        external
        returns (uint256)
    {
        return IInsuranceClaims(manager).submitClaim(
            policyId,
            0.2 ether,
            incidentDate,
            "HOSPITALIZATION",
            "HOSP-REVERT",
            keccak256("reverting-invoice"),
            keccak256("reverting-document"),
            "ipfs://reverting-document"
        );
    }

    function withdraw(address manager, uint256 claimId) external {
        IInsuranceClaims(manager).withdrawSettlement(claimId);
    }

    receive() external payable {
        revert("Recipient rejects ETH");
    }
}
