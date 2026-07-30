const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const KEY_DIRECTORY =
  process.env.EVIDENCE_KEY_DIRECTORY ||
  path.join(__dirname, "..", ".local-keys");
const PRIVATE_KEY_PATH = path.join(KEY_DIRECTORY, "evidence-private.pem");
const PUBLIC_KEY_PATH = path.join(KEY_DIRECTORY, "evidence-public.pem");

let cachedKeyMaterial = null;

const fingerprintPublicKey = (publicKeyPem) =>
  crypto
    .createHash("sha256")
    .update(
      crypto
        .createPublicKey(publicKeyPem)
        .export({ type: "spki", format: "der" })
    )
    .digest("hex")
    .slice(0, 16);

const loadConfiguredKeyMaterial = () => {
  const privateKeyPem = String(
    process.env.EVIDENCE_RSA_PRIVATE_KEY_PEM || ""
  ).replaceAll("\\n", "\n");
  const publicKeyPem = String(
    process.env.EVIDENCE_RSA_PUBLIC_KEY_PEM || ""
  ).replaceAll("\\n", "\n");

  if (!privateKeyPem && !publicKeyPem) return null;
  if (!privateKeyPem || !publicKeyPem) {
    throw new Error(
      "Both EVIDENCE_RSA_PRIVATE_KEY_PEM and EVIDENCE_RSA_PUBLIC_KEY_PEM are required"
    );
  }

  return { privateKeyPem, publicKeyPem };
};

const loadOrCreateLocalKeyMaterial = () => {
  fs.mkdirSync(KEY_DIRECTORY, { recursive: true });

  if (fs.existsSync(PRIVATE_KEY_PATH) && fs.existsSync(PUBLIC_KEY_PATH)) {
    return {
      privateKeyPem: fs.readFileSync(PRIVATE_KEY_PATH, "utf8"),
      publicKeyPem: fs.readFileSync(PUBLIC_KEY_PATH, "utf8"),
    };
  }

  const passphrase = process.env.EVIDENCE_RSA_KEY_PASSPHRASE || "";
  const privateKeyEncoding = passphrase
    ? {
        type: "pkcs8",
        format: "pem",
        cipher: "aes-256-cbc",
        passphrase,
      }
    : {
        type: "pkcs8",
        format: "pem",
      };

  const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", {
    modulusLength: 3072,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding,
  });

  fs.writeFileSync(PRIVATE_KEY_PATH, privateKey, {
    encoding: "utf8",
    mode: 0o600,
  });
  fs.writeFileSync(PUBLIC_KEY_PATH, publicKey, {
    encoding: "utf8",
    mode: 0o644,
  });

  return { privateKeyPem: privateKey, publicKeyPem: publicKey };
};

const getEvidenceKeyMaterial = () => {
  if (cachedKeyMaterial) return cachedKeyMaterial;

  const material = loadConfiguredKeyMaterial() || loadOrCreateLocalKeyMaterial();
  cachedKeyMaterial = {
    ...material,
    keyId: `local-rsa-${fingerprintPublicKey(material.publicKeyPem)}`,
  };

  return cachedKeyMaterial;
};

const unwrapEvidenceKey = (wrappedKeyBase64) => {
  const { privateKeyPem } = getEvidenceKeyMaterial();

  return crypto.privateDecrypt(
    {
      key: privateKeyPem,
      passphrase: process.env.EVIDENCE_RSA_KEY_PASSPHRASE || undefined,
      padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
      oaepHash: "sha256",
    },
    Buffer.from(wrappedKeyBase64, "base64")
  );
};

module.exports = {
  getEvidenceKeyMaterial,
  unwrapEvidenceKey,
};
