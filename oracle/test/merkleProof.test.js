const assert = require("node:assert/strict");
const test = require("node:test");
const crypto = require("crypto");
const { hashPair, verifyRegistryProof } = require("../merkleProof");

const hash = (value) =>
  `0x${crypto.createHash("sha256").update(value).digest("hex")}`;

test("verifies a valid registry proof", () => {
  const leftLeaf = hash("left");
  const rightLeaf = hash("right");
  const rootHash = hashPair(leftLeaf, rightLeaf);

  assert.equal(
    verifyRegistryProof({
      found: true,
      leafHash: leftLeaf,
      rootHash,
      proof: [{ position: "right", siblingHash: rightLeaf }],
    }),
    true
  );
});

test("rejects a tampered registry proof", () => {
  const leftLeaf = hash("left");
  const rightLeaf = hash("right");

  assert.equal(
    verifyRegistryProof({
      found: true,
      leafHash: leftLeaf,
      rootHash: hashPair(leftLeaf, rightLeaf),
      proof: [{ position: "right", siblingHash: hash("tampered") }],
    }),
    false
  );
});
