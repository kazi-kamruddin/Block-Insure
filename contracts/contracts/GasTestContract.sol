// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

contract GasTestContract {
    mapping(bytes32 => bool) public storedHashes;
    bytes32 public merkleRoot;

    function storeHashes(bytes32[] calldata hashes) external {
        for (uint256 index = 0; index < hashes.length; index++) {
            storedHashes[hashes[index]] = true;
        }
    }

    function storeMerkleRoot(bytes32 root) external {
        merkleRoot = root;
    }
}
