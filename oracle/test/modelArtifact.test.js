const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const {
  assertRequestModelIdentity,
  loadAndVerifyModelArtifact,
} = require("../modelArtifact");

test("oracle runtime validates and binds the exact frozen model artifact", () => {
  const artifact = loadAndVerifyModelArtifact(
    path.join(__dirname, "..", "..", "backEnd", "model-params.json")
  );
  assert.doesNotThrow(() => assertRequestModelIdentity(artifact.modelIdentityHash, artifact));
  assert.throws(
    () => assertRequestModelIdentity(`0x${"11".repeat(32)}`, artifact),
    /does not match runtime artifact/
  );
});
