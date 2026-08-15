const crypto = require("node:crypto");

const normalizeText = (value) => String(value || "")
  .normalize("NFKD")
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, " ")
  .trim()
  .replace(/\s+/g, " ");

const shingles = (value, width = 3) => {
  const normalized = normalizeText(value).replaceAll(" ", "_");
  if (normalized.length <= width) return new Set([normalized]);
  return new Set(Array.from({ length: normalized.length - width + 1 }, (_, index) => normalized.slice(index, index + width)));
};

const jaccardSimilarity = (left, right) => {
  const union = new Set([...left, ...right]);
  if (union.size === 0) return 1;
  let intersection = 0;
  for (const value of left) if (right.has(value)) intersection += 1;
  return intersection / union.size;
};

const minHashSignature = (value, permutations = 64) => {
  const tokens = [...shingles(value)];
  return Array.from({ length: permutations }, (_, seed) => {
    let minimum = Number.MAX_SAFE_INTEGER;
    for (const token of tokens) {
      const digest = crypto.createHash("sha256").update(`${seed}:${token}`).digest();
      minimum = Math.min(minimum, digest.readUInt32BE(0));
    }
    return minimum;
  });
};

const signatureSimilarity = (left, right) => {
  const length = Math.min(left.length, right.length);
  if (!length) return 0;
  let matches = 0;
  for (let index = 0; index < length; index += 1) if (left[index] === right[index]) matches += 1;
  return matches / length;
};

const daysApart = (left, right) => Math.abs(new Date(left) - new Date(right)) / 86400000;

const analyzeDuplicateCandidate = (candidate, existingClaims) => {
  const authoritativeIdentity = String(candidate.providerSignedInvoiceId || candidate.invoiceHash || "").toLowerCase();
  const exact = existingClaims.find((claim) =>
    authoritativeIdentity &&
    String(claim.providerSignedInvoiceId || claim.invoiceHash || "").toLowerCase() === authoritativeIdentity &&
    String(claim.claimantId || claim.policyId) === String(candidate.claimantId || candidate.policyId) &&
    normalizeText(claim.claimType) === normalizeText(candidate.claimType) &&
    new Date(claim.incidentDate).toISOString().slice(0, 10) === new Date(candidate.incidentDate).toISOString().slice(0, 10)
  );
  if (exact) {
    return { authoritativeDuplicate: true, requiresManualReview: false, action: "AUTHORITATIVE_REJECT", matches: [{ claimId: exact.claimId, score: 1 }] };
  }

  const candidateText = [candidate.invoiceNumber, candidate.providerName, candidate.documentText].join(" ");
  const candidateSignature = minHashSignature(candidateText);
  const matches = existingClaims.map((claim) => {
    const text = [claim.invoiceNumber, claim.providerName, claim.documentText].join(" ");
    const textSimilarity = signatureSimilarity(candidateSignature, minHashSignature(text));
    const amountLeft = Number(candidate.amount || candidate.claimAmount || 0);
    const amountRight = Number(claim.amount || claim.claimAmount || 0);
    const amountSimilarity = Math.max(0, 1 - Math.abs(amountLeft - amountRight) / Math.max(amountLeft, amountRight, 1));
    const dateSimilarity = Math.max(0, 1 - daysApart(candidate.incidentDate, claim.incidentDate) / 30);
    const relationship =
      String(candidate.claimantId || candidate.policyId) === String(claim.claimantId || claim.policyId) ||
      normalizeText(candidate.providerName || candidate.providerId) === normalizeText(claim.providerName || claim.providerId)
        ? 1
        : 0;
    const score = 0.5 * textSimilarity + 0.2 * amountSimilarity + 0.15 * dateSimilarity + 0.15 * relationship;
    return { claimId: claim.claimId, score, textSimilarity, amountSimilarity, dateSimilarity, relationship };
  }).filter((match) => match.score >= 0.62).sort((left, right) => right.score - left.score);

  return {
    authoritativeDuplicate: false,
    requiresManualReview: matches.length > 0,
    action: matches.length > 0 ? "ADVISORY_MANUAL_REVIEW" : "NO_DUPLICATE_SIGNAL",
    matches,
  };
};

module.exports = {
  analyzeDuplicateCandidate,
  jaccardSimilarity,
  minHashSignature,
  normalizeText,
  shingles,
  signatureSimilarity,
};
