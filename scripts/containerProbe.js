// Synthetic installation probe. Mount read-only into /app/probe.js; no real configuration.
const fs = require("node:fs"), assert = require("node:assert/strict");
const mode = process.argv[2];
assert.equal(process.getuid(), 1000, "Release Node services must run as the node user");
for (const file of ["backEnd/.env", "oracle/.env", "deploy/production.env", "backEnd/.local-keys", "reference", "tmp"]) assert.equal(fs.existsSync(`/app/${file}`), false, `Private context entered image: ${file}`);
const protocol = require("/app/oracle/runtimeProtocol").loadProtocolArtifact();
const advisory = require("/app/oracle/advisoryBundle").loadAdvisoryBundle();
assert.equal(advisory.bundleHash, protocol.bundleHash);
if (mode === "api") {
  const api = new (require("/app/backEnd/node_modules/@ironcorelabs/recrypt-node-binding").Api256)();
  const owner = api.generateKeyPair(), auditor = api.generateKeyPair(), signer = api.generateEd25519KeyPair();
  const plaintext = api.generatePlaintext();
  const encrypted = api.encrypt(plaintext, owner.publicKey, signer.privateKey);
  const delegation = api.generateTransformKey(owner.privateKey, auditor.publicKey, signer.privateKey);
  const transformed = api.transform(encrypted, delegation, signer.privateKey);
  assert.deepEqual(api.decrypt(transformed, auditor.privateKey), plaintext);
} else if (mode === "oracle") {
  fs.writeFileSync("/state/probe", "synthetic"); fs.unlinkSync("/state/probe");
} else throw new Error("Select api or oracle probe");
console.log(JSON.stringify({ passed: true, mode, node: process.version, uid: process.getuid(), modelIdentityHash: protocol.modelIdentityHash,
  scope: "Installation, immutable package and native PRE/cursor-write probe; not full runtime or external-provider acceptance" }));
