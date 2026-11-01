const { ethers } = require(require.resolve("ethers", { paths: [__dirname, require("node:path").resolve(__dirname, "../backEnd")] }));

// Reference strings are local to their issuer. Equal local patient numbers at
// different hospitals never establish a shared patient identity.
const referenceHash = (kind, hospitalId, reference) => {
  if (typeof hospitalId !== "string" || !hospitalId.trim() || typeof reference !== "string" || !reference.trim()) {
    throw new Error("Hospital and local reference are required");
  }
  return ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(
    ["string", "string", "string"], [`BLOCK_INSURE_${kind}_V2`, hospitalId.trim().toUpperCase(), reference.trim()]
  ));
};
module.exports = {
  invoiceIdentity: (hospitalId, reference) => referenceHash("INVOICE", hospitalId, reference),
  patientIdentity: (hospitalId, reference) => referenceHash("PATIENT", hospitalId, reference),
};
