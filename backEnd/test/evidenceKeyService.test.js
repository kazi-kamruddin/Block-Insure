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

test("historical RSA keys remain available after evidence-key rotation", () => {
  const active = crypto.generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  const previous = crypto.generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  const previousEnvironment = {
    publicKey: process.env.EVIDENCE_RSA_PUBLIC_KEY_PEM,
    privateKey: process.env.EVIDENCE_RSA_PRIVATE_KEY_PEM,
    previousKeys: process.env.EVIDENCE_RSA_PREVIOUS_KEYS_JSON,
  };
  const servicePath = require.resolve("../services/evidenceKeyService");
  const historicalKeyId = "historical-key-for-test";

  process.env.EVIDENCE_RSA_PUBLIC_KEY_PEM = active.publicKey;
  process.env.EVIDENCE_RSA_PRIVATE_KEY_PEM = active.privateKey;
  process.env.EVIDENCE_RSA_PREVIOUS_KEYS_JSON = JSON.stringify({
    [historicalKeyId]: { privateKeyPem: previous.privateKey },
  });
  delete require.cache[servicePath];

  try {
    const { unwrapEvidenceKey } = require("../services/evidenceKeyService");
    const rawAesKey = crypto.randomBytes(32);
    const wrappedKey = crypto.publicEncrypt(
      {
        key: previous.publicKey,
        padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
        oaepHash: "sha256",
      },
      rawAesKey
    );

    assert.deepEqual(
      unwrapEvidenceKey(wrappedKey.toString("base64"), historicalKeyId),
      rawAesKey
    );
  } finally {
    const restore = (name, value) => {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    };
    restore("EVIDENCE_RSA_PUBLIC_KEY_PEM", previousEnvironment.publicKey);
    restore("EVIDENCE_RSA_PRIVATE_KEY_PEM", previousEnvironment.privateKey);
    restore("EVIDENCE_RSA_PREVIOUS_KEYS_JSON", previousEnvironment.previousKeys);
    delete require.cache[servicePath];
  }
});
