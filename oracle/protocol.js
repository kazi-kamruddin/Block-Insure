const { ethers } = require("ethers");

const codeHash = (value) => ethers.keccak256(ethers.toUtf8Bytes(value));

const buildResultHash = ({ request, verified, verificationCode, leafHash }) =>
  ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(
      [
        "uint256",
        "uint256",
        "bytes32",
        "uint64",
        "uint64",
        "bytes32",
        "bytes32",
        "bool",
        "bytes32",
        "bytes32",
      ],
      [
        request.requestId,
        request.claimId,
        request.queryHash,
        request.claimVersion,
        request.registryVersion,
        request.registryRoot,
        request.modelVersion,
        verified,
        codeHash(verificationCode),
        leafHash || ethers.ZeroHash,
      ]
    )
  );

const buildSalt = ({ privateKey, requestId, oracleAddress }) =>
  ethers.keccak256(
    ethers.solidityPacked(
      ["bytes32", "uint256", "address"],
      [privateKey, requestId, oracleAddress]
    )
  );

const buildCommitment = (request, verified, resultHash, salt) =>
  ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(
      ["uint256", "uint64", "uint64", "bool", "bytes32", "bytes32", "bytes32"],
      [
        request.requestId,
        request.claimVersion,
        request.registryVersion,
        verified,
        resultHash,
        request.modelVersion,
        salt,
      ]
    )
  );

module.exports = {
  buildCommitment,
  buildResultHash,
  buildSalt,
  codeHash,
};
