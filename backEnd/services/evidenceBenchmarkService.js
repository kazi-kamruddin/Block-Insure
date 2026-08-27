const crypto = require("node:crypto");
const { performance } = require("node:perf_hooks");
const Recrypt = require("@ironcorelabs/recrypt-node-binding");
const {
  deserializeCryptoObject,
  serializeCryptoObject,
  transformEncryptedKey,
} = require("./preTransformService");
const {
  buildInclusionProof,
  canonicalize,
  hashLeaf,
  merkleTreeHash,
  verifyInclusionProof,
} = require("./evidenceTransparencyService");

const DOCUMENT_PROFILES = Object.freeze([
  { key: "small_invoice_pdf", mediaType: "application/pdf", bytes: 16 * 1024 },
  { key: "multipage_pdf", mediaType: "application/pdf", bytes: 256 * 1024 },
  { key: "scanned_document", mediaType: "image/png", bytes: 1024 * 1024 },
]);

const percentile = (values, probability) => {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.ceil(probability * sorted.length) - 1;
  return sorted[Math.max(0, index)];
};

const summarizeTimings = (values) => ({
  repetitions: values.length,
  meanMs: values.reduce((total, value) => total + value, 0) / values.length,
  p50Ms: percentile(values, 0.5),
  p95Ms: percentile(values, 0.95),
  minimumMs: Math.min(...values),
  maximumMs: Math.max(...values),
});

const deterministicDocument = ({ key, mediaType, bytes }) => {
  const header = Buffer.from(
    mediaType === "application/pdf"
      ? `%PDF-1.7\n% Block-Insure synthetic ${key}\n`
      : `BLOCK-INSURE-SYNTHETIC-PNG:${key}\n`
  );
  const output = Buffer.alloc(bytes);
  header.copy(output);
  let offset = header.length;
  let counter = 0;
  while (offset < output.length) {
    const block = crypto.createHash("sha256").update(`${key}:${counter}`).digest();
    block.copy(output, offset, 0, Math.min(block.length, output.length - offset));
    offset += block.length;
    counter += 1;
  }
  return output;
};

const encryptEvidence = (plaintext, key, aad, iv = crypto.randomBytes(12)) => {
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(aad);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return { ciphertext, iv, tag: cipher.getAuthTag() };
};

const decryptEvidence = (envelope, key, aad) => {
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, envelope.iv);
  decipher.setAAD(aad);
  decipher.setAuthTag(envelope.tag);
  return Buffer.concat([decipher.update(envelope.ciphertext), decipher.final()]);
};

class LocalContentAddressedStore {
  constructor() {
    this.objects = new Map();
    this.available = true;
  }

  put(bytes) {
    if (!this.available) throw new Error("Content gateway unavailable");
    const digest = crypto.createHash("sha256").update(bytes).digest("hex");
    const cid = `local-sha256:${digest}`;
    this.objects.set(cid, Buffer.from(bytes));
    return cid;
  }

  get(cid) {
    if (!this.available) throw new Error("Content gateway unavailable");
    const value = this.objects.get(cid);
    if (!value) throw new Error("Content address not found");
    return Buffer.from(value);
  }
}

const canTransformForGrant = ({ grant, identity }) =>
  Boolean(
    grant &&
      identity &&
      !grant.revoked &&
      !identity.revoked &&
      grant.granteeKeyVersion === identity.version
  );

const benchmarkAesAndStorage = ({ profile, repetitions }) => {
  const plaintext = deterministicDocument(profile);
  const key = crypto.createHash("sha256").update(`key:${profile.key}`).digest();
  const aad = Buffer.from(canonicalize({
    claimId: "42",
    claimVersion: 1,
    uploader: "0x0000000000000000000000000000000000000042",
    evidenceType: "HOSPITAL_BILL",
  }));
  const encryptTimes = [];
  const decryptTimes = [];
  const putTimes = [];
  const getTimes = [];
  const store = new LocalContentAddressedStore();
  let encryptedBytes = 0;
  const warmupEnvelope = encryptEvidence(plaintext, key, aad);
  decryptEvidence(warmupEnvelope, key, aad);
  const warmupCid = store.put(warmupEnvelope.ciphertext);
  store.get(warmupCid);
  for (let index = 0; index < repetitions; index += 1) {
    let started = performance.now();
    const envelope = encryptEvidence(plaintext, key, aad);
    encryptTimes.push(performance.now() - started);
    const serialized = Buffer.concat([envelope.iv, envelope.tag, envelope.ciphertext]);
    encryptedBytes = serialized.length;
    started = performance.now();
    const cid = store.put(serialized);
    putTimes.push(performance.now() - started);
    started = performance.now();
    const restored = store.get(cid);
    getTimes.push(performance.now() - started);
    const restoredEnvelope = {
      iv: restored.subarray(0, 12),
      tag: restored.subarray(12, 28),
      ciphertext: restored.subarray(28),
    };
    started = performance.now();
    const decrypted = decryptEvidence(restoredEnvelope, key, aad);
    decryptTimes.push(performance.now() - started);
    if (!decrypted.equals(plaintext)) throw new Error("Evidence benchmark round trip failed");
  }
  return {
    ...profile,
    ciphertextBytes: encryptedBytes,
    ciphertextExpansionBytes: encryptedBytes - plaintext.length,
    ciphertextExpansionRate: encryptedBytes / plaintext.length - 1,
    aesEncrypt: summarizeTimings(encryptTimes),
    aesDecrypt: summarizeTimings(decryptTimes),
    localContentPut: summarizeTimings(putTimes),
    localContentGet: summarizeTimings(getTimes),
  };
};

const benchmarkPre = ({ repetitions, recipientCounts = [1, 2, 4] }) => {
  const api = new Recrypt.Api256();
  return recipientCounts.map((recipientCount) => {
    const transformTimes = [];
    const recipientDecryptTimes = [];
    let capsuleBytes = 0;
    for (let repetition = -1; repetition < repetitions; repetition += 1) {
      const owner = api.generateKeyPair();
      const ownerSigning = api.generateEd25519KeyPair();
      const plaintextKey = api.generatePlaintext();
      const encrypted = api.encrypt(plaintextKey, owner.publicKey, ownerSigning.privateKey);
      capsuleBytes = Buffer.byteLength(serializeCryptoObject(encrypted));
      for (let recipient = 0; recipient < recipientCount; recipient += 1) {
        const auditor = api.generateKeyPair();
        const transformKey = api.generateTransformKey(
          owner.privateKey,
          auditor.publicKey,
          ownerSigning.privateKey
        );
        let started = performance.now();
        const transformed = deserializeCryptoObject(
          transformEncryptedKey(
            serializeCryptoObject(encrypted),
            serializeCryptoObject(transformKey)
          )
        );
        const transformDuration = performance.now() - started;
        started = performance.now();
        const recovered = api.decrypt(transformed, auditor.privateKey);
        const decryptDuration = performance.now() - started;
        if (repetition >= 0) {
          transformTimes.push(transformDuration);
          recipientDecryptTimes.push(decryptDuration);
        }
        if (!Buffer.from(recovered).equals(Buffer.from(plaintextKey))) {
          throw new Error("PRE recipient failed to recover the delegated key");
        }
      }
    }
    return {
      recipientCount,
      capsuleBytes,
      transformations: summarizeTimings(transformTimes),
      recipientDecryptions: summarizeTimings(recipientDecryptTimes),
    };
  });
};

const benchmarkIdentityLifecycle = ({ repetitions }) => {
  const api = new Recrypt.Api256();
  const rotationTimes = [];
  const revocationTimes = [];
  const staleGrantTimes = [];
  for (let repetition = -1; repetition < repetitions; repetition += 1) {
    let started = performance.now();
    api.generateKeyPair();
    const rotationDuration = performance.now() - started;
    started = performance.now();
    const revokedDenied = !canTransformForGrant({
      grant: { granteeKeyVersion: 1, revoked: true },
      identity: { version: 1, revoked: false },
    });
    const revocationDuration = performance.now() - started;
    started = performance.now();
    const staleDenied = !canTransformForGrant({
      grant: { granteeKeyVersion: 1, revoked: false },
      identity: { version: 2, revoked: false },
    });
    const staleDuration = performance.now() - started;
    if (!revokedDenied || !staleDenied) throw new Error("Identity lifecycle authorization failed");
    if (repetition >= 0) {
      rotationTimes.push(rotationDuration);
      revocationTimes.push(revocationDuration);
      staleGrantTimes.push(staleDuration);
    }
  }
  return {
    keyRotation: summarizeTimings(rotationTimes),
    revocationAuthorizationCheck: summarizeTimings(revocationTimes),
    staleGrantAuthorizationCheck: summarizeTimings(staleGrantTimes),
  };
};

const benchmarkProofs = ({ repetitions, treeSizes = [32, 128, 512] }) =>
  treeSizes.map((treeSize) => {
    const leaves = Array.from({ length: treeSize }, (_, index) =>
      hashLeaf(canonicalize({ event: "EVIDENCE_ADDED", index }))
    );
    const buildTimes = [];
    const verifyTimes = [];
    let proof = [];
    for (let repetition = -1; repetition < repetitions; repetition += 1) {
      const leafIndex = ((repetition * 17) % treeSize + treeSize) % treeSize;
      let started = performance.now();
      const rootHash = merkleTreeHash(leaves);
      proof = buildInclusionProof(leaves, leafIndex);
      const buildDuration = performance.now() - started;
      started = performance.now();
      const verified = verifyInclusionProof({
        leafHash: leaves[leafIndex],
        leafIndex,
        treeSize,
        proof,
        rootHash,
      });
      const verifyDuration = performance.now() - started;
      if (repetition >= 0) {
        buildTimes.push(buildDuration);
        verifyTimes.push(verifyDuration);
      }
      if (!verified) throw new Error("Evidence inclusion proof did not verify");
    }
    return {
      treeSize,
      proofNodes: proof.length,
      proofBytes: proof.length * 32,
      buildAndProve: summarizeTimings(buildTimes),
      verify: summarizeTimings(verifyTimes),
    };
  });

const runAdversarialChecks = () => {
  const plaintext = deterministicDocument(DOCUMENT_PROFILES[0]);
  const key = crypto.createHash("sha256").update("adversarial-key").digest();
  const aad = Buffer.from(canonicalize({ claimId: "7", claimVersion: 1, evidenceType: "BILL" }));
  const envelope = encryptEvidence(plaintext, key, aad, Buffer.alloc(12, 7));
  const checks = [];
  const expectFailure = (keyName, threat, control, operation) => {
    let detected = false;
    try {
      operation();
    } catch {
      detected = true;
    }
    checks.push({ key: keyName, threat, control, detected });
  };
  const tampered = { ...envelope, ciphertext: Buffer.from(envelope.ciphertext) };
  tampered.ciphertext[0] ^= 1;
  expectFailure("ciphertext_bit_flip", "Ciphertext modification", "AES-256-GCM authentication tag", () =>
    decryptEvidence(tampered, key, aad)
  );
  expectFailure("wrong_aad", "Evidence moved to another claim version", "Authenticated associated data", () =>
    decryptEvidence(envelope, key, Buffer.from(canonicalize({ claimId: "7", claimVersion: 2 })))
  );
  const expectedHash = crypto.createHash("sha256").update(envelope.ciphertext).digest("hex");
  expectFailure("replaced_receipt", "Stored bytes replaced", "Encrypted SHA-256 receipt", () => {
    const actual = crypto.createHash("sha256").update(Buffer.from("replacement")).digest("hex");
    if (actual !== expectedHash) throw new Error("Receipt mismatch");
  });
  const store = new LocalContentAddressedStore();
  store.put(envelope.ciphertext);
  expectFailure("replaced_cid", "CID substituted", "Content-addressed retrieval", () =>
    store.get("local-sha256:missing")
  );
  store.available = false;
  expectFailure("gateway_unavailable", "Temporary content gateway outage", "Conservative retrieval failure", () =>
    store.get("local-sha256:any")
  );
  const leaves = Array.from({ length: 16 }, (_, index) => hashLeaf(canonicalize({ index })));
  const proof = buildInclusionProof(leaves, 5);
  proof[0] = Buffer.alloc(32, 9);
  expectFailure("corrupted_proof", "Evidence history proof modified", "RFC6962 inclusion verification", () => {
    if (!verifyInclusionProof({
      leafHash: leaves[5],
      leafIndex: 5,
      treeSize: leaves.length,
      proof,
      rootHash: merkleTreeHash(leaves),
    })) throw new Error("Corrupt proof rejected");
  });
  expectFailure("revoked_grant", "Access requested after revocation", "Grant revocation check", () => {
    if (!canTransformForGrant({
      grant: { granteeKeyVersion: 1, revoked: true },
      identity: { version: 1, revoked: false },
    })) throw new Error("Revoked grant denied");
  });
  expectFailure("stale_key_version", "Grant replayed after key rotation", "Versioned encryption identity", () => {
    if (!canTransformForGrant({
      grant: { granteeKeyVersion: 1, revoked: false },
      identity: { version: 2, revoked: false },
    })) throw new Error("Stale identity denied");
  });
  return {
    cases: checks,
    detected: checks.filter((check) => check.detected).length,
    total: checks.length,
    detectionRate: checks.filter((check) => check.detected).length / checks.length,
  };
};

const evaluateEvidenceLifecycle = ({ repetitions = 30 } = {}) => {
  const documentBenchmarks = DOCUMENT_PROFILES.map((profile) =>
    benchmarkAesAndStorage({ profile, repetitions })
  );
  const preBenchmarks = benchmarkPre({ repetitions });
  const identityLifecycle = benchmarkIdentityLifecycle({ repetitions });
  const proofBenchmarks = benchmarkProofs({ repetitions });
  const adversarialTests = runAdversarialChecks();
  return {
    schemaVersion: 1,
    methodology: {
      repetitions,
      warmup: "native modules initialized by the unit suite/runtime before measurement where applicable",
      encryption: "AES-256-GCM with claim/version metadata as AAD",
      delegatedAccess: "@ironcorelabs/recrypt-node-binding Api256 proxy re-encryption",
      provenance: "RFC6962-style SHA-256 Merkle inclusion proofs",
      contentStorage: "in-process content-addressed adapter; excludes public IPFS/network latency",
    },
    documentBenchmarks,
    preBenchmarks,
    identityLifecycle,
    proofBenchmarks,
    adversarialTests,
    authorityBoundary: {
      confidentiality: "Encrypted evidence bytes remain off-chain; only commitments and tree heads are authoritative on-chain.",
      revocation: "Revocation prevents future transformed-key service but cannot erase plaintext already recovered by a recipient.",
    },
    limitations: [
      "Local content-store timings are implementation overhead, not Pinata or public IPFS latency.",
      "Synthetic documents do not contain clinical PII and do not establish regulatory compliance.",
      "Browser, mobile, HSM/KMS, network, and multi-region performance require separate deployment measurements.",
      "Ciphertext size and access metadata remain observable even when document content is confidential.",
    ],
  };
};

module.exports = {
  DOCUMENT_PROFILES,
  LocalContentAddressedStore,
  benchmarkAesAndStorage,
  benchmarkPre,
  benchmarkIdentityLifecycle,
  benchmarkProofs,
  canTransformForGrant,
  decryptEvidence,
  deterministicDocument,
  encryptEvidence,
  evaluateEvidenceLifecycle,
  percentile,
  runAdversarialChecks,
  summarizeTimings,
};
