const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const test = require("node:test");
const Recrypt = require("@ironcorelabs/recrypt-node-binding");
const { ethers } = require("ethers");
const { SiweMessage } = require("siwe");
const {
  deserializeCryptoObject,
  serializeCryptoObject,
  transformEncryptedKey,
} = require("../services/preTransformService");
const {
  buildConsistencyProof,
  buildInclusionProof,
  canonicalize,
  hashLeaf,
  merkleTreeHash,
  verifyConsistencyProof,
  verifyInclusionProof,
} = require("../services/evidenceTransparencyService");
const {
  eventIdentity,
  findReorgRollbackHeight,
  jsonSafe,
} = require("../services/blockchainIndexerService");

test("PRE proxy transforms a key without gaining plaintext access", () => {
  const api = new Recrypt.Api256();
  const owner = api.generateKeyPair();
  const auditor = api.generateKeyPair();
  const outsider = api.generateKeyPair();
  const ownerSigning = api.generateEd25519KeyPair();
  const plaintext = api.generatePlaintext();
  const encrypted = api.encrypt(plaintext, owner.publicKey, ownerSigning.privateKey);
  const transformKey = api.generateTransformKey(
    owner.privateKey,
    auditor.publicKey,
    ownerSigning.privateKey
  );
  const transformed = deserializeCryptoObject(
    transformEncryptedKey(
      serializeCryptoObject(encrypted),
      serializeCryptoObject(transformKey)
    )
  );

  assert.deepEqual(api.decrypt(encrypted, owner.privateKey), plaintext);
  assert.deepEqual(api.decrypt(transformed, auditor.privateKey), plaintext);
  assert.throws(() => api.decrypt(transformed, outsider.privateKey));
  const service = require("../services/preTransformService");
  assert.equal(service.decrypt, undefined, "proxy service must expose no decrypt operation");
});

test("AES-256-GCM rejects modified ciphertext and moved claim metadata", () => {
  const key = crypto.randomBytes(32);
  const iv = crypto.randomBytes(12);
  const aad = Buffer.from(
    canonicalize({ claimId: "7", claimVersion: 1, uploader: "0xabc", evidenceType: "BILL" })
  );
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(aad);
  const ciphertext = Buffer.concat([cipher.update("medical evidence"), cipher.final()]);
  const tag = cipher.getAuthTag();

  const tampered = Buffer.from(ciphertext);
  tampered[0] ^= 1;
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAAD(aad);
  decipher.setAuthTag(tag);
  assert.throws(() => Buffer.concat([decipher.update(tampered), decipher.final()]));

  const moved = crypto.createDecipheriv("aes-256-gcm", key, iv);
  moved.setAAD(Buffer.from(canonicalize({ claimId: "8", claimVersion: 1 })));
  moved.setAuthTag(tag);
  assert.throws(() => Buffer.concat([moved.update(ciphertext), moved.final()]));
});

test("RFC6962-style inclusion and consistency proofs expose rewritten history", () => {
  const leaves = Array.from({ length: 7 }, (_, index) =>
    hashLeaf(canonicalize({ event: "EVIDENCE_ADDED", index }))
  );
  const root = merkleTreeHash(leaves);
  const inclusion = buildInclusionProof(leaves, 4);
  assert.equal(
    verifyInclusionProof({
      leafHash: leaves[4],
      leafIndex: 4,
      treeSize: leaves.length,
      proof: inclusion,
      rootHash: root,
    }),
    true
  );

  const oldSize = 3;
  const oldRoot = merkleTreeHash(leaves.slice(0, oldSize));
  const consistency = buildConsistencyProof(leaves, oldSize);
  assert.equal(
    verifyConsistencyProof({
      oldSize,
      newSize: leaves.length,
      oldRoot,
      newRoot: root,
      proof: consistency,
    }),
    true
  );
  const rewritten = [...leaves];
  rewritten[1] = hashLeaf(canonicalize({ event: "REWRITTEN", index: 1 }));
  assert.equal(
    verifyConsistencyProof({
      oldSize,
      newSize: rewritten.length,
      oldRoot,
      newRoot: merkleTreeHash(rewritten),
      proof: consistency,
    }),
    false
  );
});

test("indexer serialization is deterministic for bigint event arguments", () => {
  assert.deepEqual(jsonSafe({ claimId: 7n, nested: [1n, 2n] }), {
    claimId: "7",
    nested: ["1", "2"],
  });
});

test("indexer preserves named ethers-style event arguments", () => {
  const result = {
    toObject: () => ({ claimId: 9n, claimantWallet: "0xabc" }),
  };
  assert.deepEqual(jsonSafe(result), {
    claimId: "9",
    claimantWallet: "0xabc",
  });
});

test("indexer reorg planning rolls back the divergent suffix", () => {
  const indexed = [
    { blockNumber: 10, blockHash: "0xa" },
    { blockNumber: 11, blockHash: "0xb" },
    { blockNumber: 12, blockHash: "0xc" },
  ];
  const canonical = new Map([
    [10, "0xa"],
    [11, "0xreplacement"],
    [12, "0xreplacement-child"],
  ]);
  assert.equal(findReorgRollbackHeight(indexed, canonical), 11);
});

test("indexer event identities make replayed logs idempotent", () => {
  const log = {
    address: "0xABC",
    transactionHash: "0xDEF",
    index: 7,
  };
  const identities = new Set([eventIdentity(log), eventIdentity({ ...log })]);
  assert.equal(identities.size, 1);
});

test("SIWE authentication consumes its nonce exactly once", async () => {
  const User = require("../models/User");
  const { walletLogin } = require("../controllers/authController");
  const originalFindOne = User.findOne;
  const originalFindOneAndUpdate = User.findOneAndUpdate;
  const originalJwtSecret = process.env.JWT_SECRET;
  const wallet = ethers.Wallet.createRandom();
  const nonce = crypto.randomBytes(16).toString("hex");
  const user = {
    _id: "phase4-siwe-user",
    walletAddress: wallet.address.toLowerCase(),
    role: "USER",
    name: "",
    email: "",
    nonce,
    nonceExpiresAt: new Date(Date.now() + 60_000),
  };
  const message = new SiweMessage({
    domain: "localhost",
    address: wallet.address,
    statement: "Authenticate to Block-Insure with current on-chain authorization.",
    uri: "http://localhost",
    version: "1",
    chainId: 31337,
    nonce,
    issuedAt: new Date().toISOString(),
    expirationTime: new Date(Date.now() + 60_000).toISOString(),
    resources: ["urn:block-insure:evidence"],
  }).prepareMessage();
  const signature = await wallet.signMessage(message);
  process.env.JWT_SECRET = "phase4-test-secret-phase4-test-secret";
  User.findOne = async () => user;
  User.findOneAndUpdate = async (filter) => {
    if (!user.nonce || filter.nonce !== user.nonce) return null;
    user.nonce = "";
    user.nonceExpiresAt = null;
    return user;
  };
  const request = {
    body: { message, signature, walletAddress: wallet.address },
    protocol: "http",
    get: (header) => (header === "host" ? "localhost" : ""),
  };
  const response = {
    statusCode: 0,
    payload: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.payload = payload;
      return this;
    },
  };
  try {
    let firstError;
    await walletLogin(request, response, (error) => {
      firstError = error;
    });
    assert.equal(firstError, undefined);
    assert.equal(response.statusCode, 200);
    assert.ok(response.payload.token);

    let replayError;
    await walletLogin(request, response, (error) => {
      replayError = error;
    });
    assert.equal(replayError.statusCode, 401);
    assert.match(replayError.message, /nonce/i);
  } finally {
    User.findOne = originalFindOne;
    User.findOneAndUpdate = originalFindOneAndUpdate;
    if (originalJwtSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = originalJwtSecret;
  }
});

test("a privileged session is denied after its on-chain role is revoked", async () => {
  const contractService = require("../services/contractService");
  const servicePath = require.resolve("../services/onChainAuthorizationService");
  const originalGetReadOnlyContract = contractService.getReadOnlyContract;
  contractService.getReadOnlyContract = () => ({
    AUDITOR_ROLE: async () => ethers.id("AUDITOR_ROLE"),
    hasRole: async () => false,
  });
  delete require.cache[servicePath];
  try {
    const { assertCurrentOnChainRole } = require(servicePath);
    await assert.rejects(
      assertCurrentOnChainRole("AUDITOR", walletAddressForTest()),
      /revoked/
    );
  } finally {
    contractService.getReadOnlyContract = originalGetReadOnlyContract;
    delete require.cache[servicePath];
  }
});

function walletAddressForTest() {
  return "0x0000000000000000000000000000000000000001";
}
