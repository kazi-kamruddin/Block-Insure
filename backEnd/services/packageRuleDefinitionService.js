const { ethers } = require("ethers");
const code = (value) => ethers.id(value);
const fail = (message) => Object.assign(new Error(message), { statusCode: 422 });

const normalizeRuleDefinition = (input) => {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw fail("Complete economic rules are required before package publication.");
  const codes = (values, name, required = false) => {
    if (!Array.isArray(values) || values.length > 32 || (required && !values.length)) throw fail(`Supply 1 to 32 ${name}.`);
    return [...new Set(values.map((value) => {
      if (typeof value !== "string" || !/^[A-Z][A-Z0-9_]{0,63}$/.test(value)) throw fail(`Use canonical uppercase ${name}.`);
      return value;
    }))];
  };
  const integer = (value, fallback, maximum, name, minimum = 0) => {
    const result = Number(value ?? fallback);
    if (!Number.isSafeInteger(result) || result < minimum || result > maximum) throw fail(`Invalid ${name}.`);
    return result;
  };
  const amount = (value, name) => {
    try { const wei = ethers.parseEther(String(value ?? "0")); if (wei < 0n || wei >= 2n ** 128n) throw Error(); return wei; }
    catch { throw fail(`Invalid ${name}.`); }
  };
  const allowedClaimTypes = codes(input.allowedClaimTypes, "allowed claim types", true);
  const excludedClaimTypes = codes(input.excludedClaimTypes || [], "excluded claim types");
  if (allowedClaimTypes.some((value) => excludedClaimTypes.includes(value))) throw fail("A service cannot be both allowed and excluded.");
  const requiredDocumentTypes = codes(input.requiredDocumentTypes, "primary document type", true);
  if (requiredDocumentTypes.length !== 1 || Number(input.minimumDocumentCommitments ?? 1) !== 1) throw fail("This release requires exactly one primary invoice commitment.");
  if (requiredDocumentTypes[0] !== "HOSPITAL_BILL") throw fail("The supported primary evidence type is HOSPITAL_BILL; additional evidence belongs to the later evidence-bundle workflow.");
  const allowedServices = allowedClaimTypes.map(code), excludedServices = excludedClaimTypes.map(code), requiredDocuments = requiredDocumentTypes.map(code);
  const root = (values) => values.length ? ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(["bytes32[]"], [values])) : ethers.ZeroHash;
  const normalizedRules = {
    waitingPeriod: integer(input.waitingPeriodDays, 0, 3650, "waiting period") * 86400,
    reinstatementWaitingPeriod: integer(input.reinstatementWaitingPeriodDays, 0, 3650, "reinstatement waiting period") * 86400,
    claimDeadline: integer(input.claimDeadlineDays, 365, 3650, "claim deadline", 1) * 86400,
    minimumDocumentCommitments: 1,
    deductibleRateBps: integer(input.deductibleRateBps, 1000, 10000, "deductible rate"),
    insurerShareBps: integer(input.insurerShareBps, 8000, 10000, "insurer share", 1),
    deductibleCapWei: amount(input.deductibleCapEth, "deductible cap"),
    maximumClaimWei: amount(input.maximumClaimEth, "maximum claim"),
    exclusionsRoot: root(excludedServices), requiredDocumentsRoot: root(requiredDocuments),
  };
  if (input.settlementFormulaVersion && input.settlementFormulaVersion !== "BLOCK_INSURE_SETTLEMENT_V1") throw fail("Unsupported settlement formula.");
  return { normalizedRules, allowedServices, excludedServices, requiredDocuments, allowedClaimTypes, excludedClaimTypes, requiredDocumentTypes };
};

const buildRulePublication = (packageId, version, definition) => {
  const normalized = normalizeRuleDefinition(definition);
  const { normalizedRules, ...lists } = normalized;
  const ruleDocument = JSON.stringify({ packageId: String(packageId), version: String(version),
    ...Object.fromEntries(Object.entries(normalizedRules).map(([key, value]) => [key, value.toString()])), ...lists });
  return { ...normalized, ruleDocument, rules: { version, ...normalizedRules,
    settlementFormulaVersion: ethers.id("BLOCK_INSURE_SETTLEMENT_V1"), policyRuleVersion: ethers.id(ruleDocument) } };
};
module.exports = { normalizeRuleDefinition, buildRulePublication };
