// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

interface IBenefitWithdrawal {
    function withdrawBenefit() external;
}

contract RevertingBenefitRecipient {
    function withdraw(address benefitsManager) external {
        IBenefitWithdrawal(benefitsManager).withdrawBenefit();
    }

    receive() external payable {
        revert("Recipient rejects ETH");
    }
}
