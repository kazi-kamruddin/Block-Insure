const { amount, digest } = require("./manifest");
const { generatedInputLabel } = require("./campaignHandoff");
const { formatEther } = require("../../backEnd/node_modules/ethers");

const bootstrapRole = /^setup\.(oracle[12]|auditor[1-4]|bank|medical-reserve|registry-baseline)$/;
const setup = /^setup\.identity-[a-z0-9]+$/;
const isOneTime = (step) => step.category === "bootstrap" || bootstrapRole.test(step.id) || setup.test(step.id);

function generatedManifest({ manifest, manifestHash, routing, repetitions }) {
  if (!Number.isInteger(repetitions) || repetitions < 1 || repetitions > 5) throw new Error("Choose between one and five repetitions");
  if (routing.fixtureManifestSha256 !== manifestHash || routing.manual.case !== "insurer-association-correction" ||
      routing.manual.claimAmountEth !== manifest.cases.manual.grossEth || routing.manual.route !== manifest.cases.manual.route ||
      routing.manual.hospitalBillEth !== routing.manual.referenceBillEth || routing.manual.referenceBillEth !== routing.manual.claimAmountEth) {
    throw new Error("Generated manual case differs from the reviewed ownership correction");
  }
  const operations = manifest.operations.filter(isOneTime);
  const pattern = manifest.operations.filter((step) => !isOneTime(step));
  const originalPublication = pattern.find(({ id }) => id === "manual.publish");
  operations.splice(operations.findIndex((step) => setup.test(step.id)), 0, {
    ...originalPublication, id: "setup.registry-baseline", category: "setup", expectedAfter: "Initial shared registry snapshot verified",
  });
  const withCorrection = pattern.flatMap((step) => step.id === "manual.oracle-request" ? [
    { ...originalPublication, id: "manual.corrected-publish", expectedAfter: "Corrected ownership snapshot published" }, step,
  ] : [step]);
  const required = repetitionReserveRequirements(manifest);
  const initial = { medical: amount(manifest.deployment.medicalReserveEth, "medical reserve"),
    refund: amount(manifest.deployment.refundReserveEth, "refund reserve") };
  for (let repetition = 1; repetition <= repetitions; repetition += 1) {
    if (repetition > 1) for (const [reserve, target, method] of [["medical", "InsuranceManager", "fundContract"],
      ["refund", "PolicyBenefitsManager", "receive"]]) {
      const deficit = repetitionReserveDeficit({ availableWei: repetition === 2 ? initial[reserve] - required[reserve] : 0n,
        requiredWei: required[reserve] });
      if (deficit > 0n) operations.push({ id: `rep${repetition}/reserve.${reserve}`, templateId: `reserve.${reserve}`,
        repetition, category: "setup", kind: "transaction", role: "admin", target, method, arguments: [],
        valueEth: formatEther(deficit), expectedAfter: "Next repetition reserve replenished to measured requirement" });
    }
    operations.push(...withCorrection.map((step) => ({ ...step, templateId: step.id, id: `rep${repetition}/${step.id}`, repetition })));
  }
  return { ...manifest, operations, repetitions, offchainInputSource: generatedInputLabel,
    reviewedRoutingHash: digest(JSON.stringify(routing)), baseManifestHash: manifestHash,
    expectedTransactionsPerChain: operations.filter((step) => step.kind === "transaction").length };
}

function repetitionReserveDeficit({ availableWei, requiredWei }) {
  const deficit = requiredWei - availableWei;
  return deficit > 0n ? deficit : 0n;
}

function repetitionReserveRequirements(manifest) {
  const premiums = manifest.operations.filter((step) => step.category === "premium" && step.kind === "transaction" && (step.repetition ?? 1) === 1)
    .reduce((sum, step) => sum + amount(step.valueEth, step.id), 0n);
  return {
    medical: amount(manifest.cases.routine.payoutEth, "routine payout") +
      3n * amount(manifest.cases.manual.payoutEth, "manual, appeal and clarification payout") +
      amount(manifest.cases.surgery.payoutEth, "surgery payout") - premiums,
    refund: 2n * amount(manifest.deployment.premiumEth, "premium"),
  };
}

module.exports = { bootstrapRole, generatedManifest, isOneTime, repetitionReserveDeficit, repetitionReserveRequirements };
