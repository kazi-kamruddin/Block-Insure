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

const normalizePrivateKey = (privateKey) => {
  const value = String(privateKey || "").trim();
  const normalized = value.startsWith("0x") ? value : `0x${value}`;
  if (!ethers.isHexString(normalized, 32)) {
    throw new Error("Oracle private key must contain exactly 32 bytes");
  }
  return normalized;
};

const buildSalt = ({ privateKey, requestId, oracleAddress }) =>
  ethers.keccak256(
    ethers.solidityPacked(
      ["bytes32", "uint256", "address"],
      [normalizePrivateKey(privateKey), requestId, oracleAddress]
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
  normalizePrivateKey,
};
