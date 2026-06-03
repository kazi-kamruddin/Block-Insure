require("dotenv").config();

const dns = require("dns");
const mongoose = require("mongoose");

const File = require("../models/File");
const {
  GENESIS_EVIDENCE_HASH,
  buildEvidenceChainHash,
  normalizeClaimId,
} = require("../services/evidenceChainService");

dns.setDefaultResultOrder("ipv4first");

if (process.env.FORCE_PUBLIC_DNS === "true") {
  dns.setServers(["8.8.8.8", "1.1.1.1"]);
}

const backfillClaim = async (claimId) => {
  const files = await File.find({ claimId }).sort({ createdAt: 1, _id: 1 });
  let previousEvidenceHash = GENESIS_EVIDENCE_HASH;

  for (let index = 0; index < files.length; index += 1) {
    const fileRecord = files[index];
    const evidenceChainHash = buildEvidenceChainHash({
      claimId,
      evidenceChainIndex: index,
      previousEvidenceHash,
      sha256Hash: fileRecord.sha256Hash,
      ipfsCID: fileRecord.ipfsCID,
      documentType: fileRecord.documentType,
      uploaderWallet: fileRecord.uploaderWallet,
    });

    fileRecord.previousEvidenceHash = previousEvidenceHash;
    fileRecord.evidenceChainIndex = index;
    fileRecord.evidenceChainHash = evidenceChainHash;

    await fileRecord.save();

    previousEvidenceHash = evidenceChainHash;
  }

  return files.length;
};

const runBackfill = async () => {
  if (!process.env.MONGODB_URI) {
    throw new Error("MONGODB_URI is missing in .env");
  }

  await mongoose.connect(process.env.MONGODB_URI);

  const rawClaimIds = await File.distinct("claimId");
  const claimIds = rawClaimIds
    .map(normalizeClaimId)
    .filter(Boolean)
    .sort((left, right) => Number(left) - Number(right));
  let updatedDocuments = 0;

  for (const claimId of claimIds) {
    updatedDocuments += await backfillClaim(claimId);
  }

  console.log("Evidence hash chain backfill completed");
  console.log(`Claims processed: ${claimIds.length}`);
  console.log(`Documents linked: ${updatedDocuments}`);

  await mongoose.connection.close();
};

runBackfill().catch(async (error) => {
  console.error("Evidence hash chain backfill failed:", error.message);
  await mongoose.connection.close();
  process.exit(1);
});
