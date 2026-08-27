const fs = require("fs");
const path = require("path");
const Recrypt = require("@ironcorelabs/recrypt-node-binding");

const api = new Recrypt.Api256();
const KEY_DIRECTORY =
  process.env.EVIDENCE_KEY_DIRECTORY || path.join(__dirname, "..", ".local-keys");
const PROXY_SIGNING_KEY_PATH = path.join(KEY_DIRECTORY, "pre-proxy-signing.json");
let proxySigningKeys;

const encodeCryptoObject = (value) => {
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
    return `b64:${Buffer.from(value).toString("base64")}`;
  }
  if (Array.isArray(value)) return value.map(encodeCryptoObject);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, encodeCryptoObject(child)])
    );
  }
  return value;
};

const decodeCryptoObject = (value) => {
  if (typeof value === "string" && value.startsWith("b64:")) {
    return Buffer.from(value.slice(4), "base64");
  }
  if (Array.isArray(value)) return value.map(decodeCryptoObject);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, decodeCryptoObject(child)])
    );
  }
  return value;
};

const serializeCryptoObject = (value) =>
  JSON.stringify(encodeCryptoObject(value));

const deserializeCryptoObject = (serialized) => {
  const value = typeof serialized === "string" ? JSON.parse(serialized) : serialized;
  return decodeCryptoObject(value);
};

const loadProxySigningKeys = () => {
  if (proxySigningKeys) return proxySigningKeys;
  const configured = process.env.PRE_PROXY_SIGNING_KEYS_JSON;
  if (configured) {
    proxySigningKeys = deserializeCryptoObject(configured);
    return proxySigningKeys;
  }

  fs.mkdirSync(KEY_DIRECTORY, { recursive: true });
  if (fs.existsSync(PROXY_SIGNING_KEY_PATH)) {
    proxySigningKeys = deserializeCryptoObject(
      fs.readFileSync(PROXY_SIGNING_KEY_PATH, "utf8")
    );
    return proxySigningKeys;
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error("PRE_PROXY_SIGNING_KEYS_JSON is required in production");
  }
  proxySigningKeys = api.generateEd25519KeyPair();
  fs.writeFileSync(
    PROXY_SIGNING_KEY_PATH,
    serializeCryptoObject(proxySigningKeys),
    { encoding: "utf8", mode: 0o600 }
  );
  return proxySigningKeys;
};

const transformEncryptedKey = (serializedCapsule, serializedTransformKey) => {
  const capsule = deserializeCryptoObject(serializedCapsule);
  const transformKey = deserializeCryptoObject(serializedTransformKey);
  const signingKeys = loadProxySigningKeys();
  return serializeCryptoObject(
    api.transform(capsule, transformKey, signingKeys.privateKey)
  );
};

const getProxyPublicSigningKey = () =>
  serializeCryptoObject(loadProxySigningKeys().publicKey);

module.exports = {
  deserializeCryptoObject,
  encodeCryptoObject,
  getProxyPublicSigningKey,
  serializeCryptoObject,
  transformEncryptedKey,
};
