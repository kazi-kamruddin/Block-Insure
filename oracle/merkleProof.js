const crypto = require("crypto");

const normalizeHash = (value) => String(value || "").trim().toLowerCase();
const stripHexPrefix = (value) => normalizeHash(value).replace(/^0x/, "");

const hashPair = (leftHash, rightHash) => {
  const pairInput = `${stripHexPrefix(leftHash)}${stripHexPrefix(rightHash)}`;
  return `0x${crypto.createHash("sha256").update(pairInput).digest("hex")}`;
};

const verifyRegistryProof = (merkleProof) => {
  if (
    !merkleProof?.found ||
    !merkleProof?.leafHash ||
    !merkleProof?.rootHash ||
    !Array.isArray(merkleProof.proof)
  ) {
    return false;
  }

  let computedHash = merkleProof.leafHash;

  for (const step of merkleProof.proof) {
    if (
      !step?.siblingHash ||
      !["left", "right"].includes(step.position)
    ) {
      return false;
    }

    computedHash =
      step.position === "left"
        ? hashPair(step.siblingHash, computedHash)
        : hashPair(computedHash, step.siblingHash);
  }

  return normalizeHash(computedHash) === normalizeHash(merkleProof.rootHash);
};

module.exports = {
  hashPair,
  verifyRegistryProof,
};
