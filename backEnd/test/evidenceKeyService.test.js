const assert = require("node:assert/strict");
const test = require("node:test");
const crypto = require("node:crypto");

test("application RSA key wraps and unwraps an evidence AES key", () => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  const previousPublicKey = process.env.EVIDENCE_RSA_PUBLIC_KEY_PEM;
  const previousPrivateKey = process.env.EVIDENCE_RSA_PRIVATE_KEY_PEM;
  const servicePath = require.resolve("../services/evidenceKeyService");

  process.env.EVIDENCE_RSA_PUBLIC_KEY_PEM = publicKey;
  process.env.EVIDENCE_RSA_PRIVATE_KEY_PEM = privateKey;
  delete require.cache[servicePath];

  try {
    const {
      getEvidenceKeyMaterial,
      unwrapEvidenceKey,
    } = require("../services/evidenceKeyService");
    const rawAesKey = crypto.randomBytes(32);
    const keyMaterial = getEvidenceKeyMaterial();
    const wrappedKey = crypto.publicEncrypt(
      {
        key: keyMaterial.publicKeyPem,
        padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
        oaepHash: "sha256",
      },
      rawAesKey
    );

    assert.match(keyMaterial.keyId, /^local-rsa-[a-f0-9]{16}$/);
    assert.deepEqual(
      unwrapEvidenceKey(wrappedKey.toString("base64")),
      rawAesKey
    );
  } finally {
    if (previousPublicKey === undefined) {
      delete process.env.EVIDENCE_RSA_PUBLIC_KEY_PEM;
    } else {
      process.env.EVIDENCE_RSA_PUBLIC_KEY_PEM = previousPublicKey;
    }
    if (previousPrivateKey === undefined) {
      delete process.env.EVIDENCE_RSA_PRIVATE_KEY_PEM;
    } else {
      process.env.EVIDENCE_RSA_PRIVATE_KEY_PEM = previousPrivateKey;
    }
    delete require.cache[servicePath];
  }
});
