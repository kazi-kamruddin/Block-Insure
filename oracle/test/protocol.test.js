const assert = require("node:assert/strict");
const test = require("node:test");
const { ethers } = require("ethers");
const {
  buildCommitment,
  buildResultHash,
  buildSalt,
} = require("../protocol");

const request = {
  requestId: 7n,
  claimId: 19n,
  queryHash: ethers.keccak256(ethers.toUtf8Bytes("claim-query")),
  claimVersion: 2n,
  registryVersion: 4n,
  registryRoot: ethers.keccak256(ethers.toUtf8Bytes("registry-root")),
  modelVersion: ethers.keccak256(ethers.toUtf8Bytes("model-v1")),
};

test("canonical result hashes ignore oracle identity and timestamps", () => {
  const common = {
    request,
    verified: true,
    verificationCode: "VERIFIED",
    leafHash: ethers.keccak256(ethers.toUtf8Bytes("leaf")),
  };

  assert.equal(buildResultHash(common), buildResultHash({ ...common }));
});

test("canonical result hashes change when any bound version changes", () => {
  const common = {
    request,
    verified: true,
    verificationCode: "VERIFIED",
    leafHash: ethers.keccak256(ethers.toUtf8Bytes("leaf")),
  };
  const changed = {
    ...common,
    request: { ...request, registryVersion: request.registryVersion + 1n },
  };

  assert.notEqual(buildResultHash(common), buildResultHash(changed));
});

test("different oracle secrets produce different commitments for the same result", () => {
  const first = ethers.Wallet.createRandom();
  const second = ethers.Wallet.createRandom();
  const resultHash = buildResultHash({
    request,
    verified: false,
    verificationCode: "HOSPITAL_REJECTED",
    leafHash: ethers.ZeroHash,
  });
  const firstSalt = buildSalt({
    privateKey: first.privateKey,
    requestId: request.requestId,
    oracleAddress: first.address,
  });
  const secondSalt = buildSalt({
    privateKey: second.privateKey,
    requestId: request.requestId,
    oracleAddress: second.address,
  });

  assert.notEqual(
    buildCommitment(request, false, resultHash, firstSalt),
    buildCommitment(request, false, resultHash, secondSalt)
  );
});
