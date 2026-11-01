const { test, expect } = require("@playwright/test");
const fs = require("node:fs"), path = require("node:path"), os = require("node:os");
const { performance } = require("node:perf_hooks");
const { transformEncryptedKey } = require("../../backEnd/services/preTransformService");

test("@workflow @measurement bounded browser AES/WASM, native proxy and frozen-model measurements", async ({ page, browserName }) => {
  test.skip(!process.env.RELEASE_MEASUREMENTS_DIR, "Requires the bounded release measurement stage");
  test.setTimeout(240000);
  await page.goto("/");
  await page.evaluate(async () => {
    const { Api256 } = await import("/src/services/recryptBrowser.js");
    const api = new Api256(), owner = api.generateKeyPair(), signing = api.generateEd25519KeyPair();
    const auditors = Array.from({ length: 4 }, () => api.generateKeyPair());
    const transforms = auditors.map((auditor) => api.generateTransformKey(owner.privateKey, auditor.publicKey, signing.privateKey));
    const encode = (v) => v instanceof Uint8Array ? `b64:${btoa(String.fromCharCode(...v))}` : Array.isArray(v) ? v.map(encode) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, encode(x)])) : v;
    const decode = (v) => typeof v === "string" && v.startsWith("b64:") ? Uint8Array.from(atob(v.slice(4)), (c) => c.charCodeAt(0)) : Array.isArray(v) ? v.map(decode) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, decode(x)])) : v;
    window.__releaseSynthetic = { api, owner, signing, auditors, transforms, encode, decode };
  });
  const rows = [];
  // Fixed before measurement: 3 supported sizes, 10 observations and 1 discarded warmup per size, 4 recipients.
  for (const bytes of [64 * 1024, 1024 * 1024, 8 * 1024 * 1024]) for (let repetition = -1; repetition < 10; repetition++) {
    const encrypted = await page.evaluate(async (size) => {
      const s = window.__releaseSynthetic, plaintext = new Uint8Array(size).fill(73);
      const material = s.api.generatePlaintext(), iv = crypto.getRandomValues(new Uint8Array(12)), aad = new TextEncoder().encode("release-synthetic-benchmark-v1");
      const key = await crypto.subtle.importKey("raw", s.api.deriveSymmetricKey(material), "AES-GCM", false, ["encrypt"]);
      let start = performance.now();
      const capsule = s.api.encrypt(material, s.owner.publicKey, s.signing.privateKey);
      const capsuleEncryptMs = performance.now() - start;
      start = performance.now();
      const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: aad }, key, plaintext);
      const aesEncryptMs = performance.now() - start;
      s.current = { plaintext, iv, aad, ciphertext };
      return { capsule: JSON.stringify(s.encode(capsule)), transforms: s.transforms.map((v) => JSON.stringify(s.encode(v))), capsuleEncryptMs, aesEncryptMs, envelopeBytes: ciphertext.byteLength + 20 };
    }, bytes);
    const transformed = [], proxyTransformMs = [];
    for (const transform of encrypted.transforms) {
      const start = performance.now(); transformed.push(transformEncryptedKey(encrypted.capsule, transform)); proxyTransformMs.push(performance.now() - start);
    }
    const decrypted = await page.evaluate(async (capsules) => {
      const s = window.__releaseSynthetic, result = [];
      for (const [index, capsule] of capsules.entries()) {
        let start = performance.now();
        const material = s.api.decrypt(s.decode(JSON.parse(capsule)), s.auditors[index].privateKey);
        const recipientCapsuleDecryptMs = performance.now() - start;
        const key = await crypto.subtle.importKey("raw", s.api.deriveSymmetricKey(material), "AES-GCM", false, ["decrypt"]);
        start = performance.now();
        const plaintext = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: s.current.iv, additionalData: s.current.aad }, key, s.current.ciphertext));
        const aesDecryptMs = performance.now() - start;
        if (plaintext.length !== s.current.plaintext.length || !plaintext.every((v) => v === 73)) throw new Error("Synthetic browser round trip differs");
        result.push({ recipientCapsuleDecryptMs, aesDecryptMs });
      }
      return result;
    }, transformed);
    if (repetition >= 0) rows.push({ bytes, repetition, recipients: 4, envelopeBytes: encrypted.envelopeBytes, capsuleEncryptMs: encrypted.capsuleEncryptMs, aesEncryptMs: encrypted.aesEncryptMs, proxyTransformMs, recipientTimings: decrypted });
  }
  expect(rows).toHaveLength(30);
  const fixture = require("../../backEnd/test/helpers/shadowFixture")();
  const { assessProtocol } = require("../../oracle/protocolAssessment");
  const model = [];
  for (let repetition = -1; repetition < 10; repetition++) {
    const start = performance.now(), result = assessProtocol(fixture.packet, fixture.authoritative);
    if (repetition >= 0) model.push({ repetition, pipelineMs: performance.now() - start, score: result.score, verified: result.verified, model: result.model });
  }
  fs.writeFileSync(path.join(process.env.RELEASE_MEASUREMENTS_DIR, "component-measurements.json"), JSON.stringify({ schema: "block-insure-release-components-v1", measuredAt: new Date().toISOString(),
    environment: { node: process.version, os: `${os.platform()} ${os.release()}`, cpu: os.cpus()[0]?.model, browserName, browserVersion: page.context().browser().version() },
    design: { sizesBytes: [65536, 1048576, 8388608], repetitions: 10, warmupsDiscardedPerSize: 1, recipients: 4 }, rows, model,
    limitations: ["Synthetic component harness using application WebCrypto/WASM binding and real native proxy service; excludes wallet, HTTP, database, Pinata and identity enrollment.",
      "Browser and proxy clocks measure their own operations; no cross-clock subtraction. Four recipient observations in one repetition are clustered, not four independent trials.",
      "Model timing uses one complete controlled context fixture and the frozen pipeline; not natural-fraud accuracy, generalization or production capacity."] }, null, 2) + "\n", { flag: "wx" });
});
