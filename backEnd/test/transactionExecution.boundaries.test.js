const test = require("node:test");
const assert = require("node:assert/strict");
const { ethers } = require("ethers");
const load = require("./helpers/loadIsolatedModule");
const { verifyWalletExecution } = require("../services/transactionExecutionService");

const actor = "0x" + "2".repeat(40);
const managerAddress = "0x" + "1".repeat(40);
const coordinatorAddress = "0x" + "4".repeat(40);
const relay = "0x" + "3".repeat(40);
const hash = ethers.id("confirmation-boundary");
const managerInterface = new ethers.Interface(require("../abi/InsuranceManager.json").abi);
const coordinatorInterface = new ethers.Interface(require("../abi/OracleCoordinator.json").abi);
const benefitsInterface = new ethers.Interface(require("../abi/PolicyBenefitsManager.json").abi);
const encodedEvent = (iface, address, name, args) => ({ address, ...iface.encodeEventLog(iface.getEvent(name), args) });
const response = () => {
  const result = {};
  return { result, res: { status(code) { result.status = code; return this; }, json(body) { result.body = body; return this; } }, next(error) { result.error = error; } };
};

async function timeoutConfirmation({ sponsored, wrongTarget = false, wrongEmitter = false } = {}) {
  const data = coordinatorInterface.encodeFunctionData("resolveTimedOutRequest", [4]);
  const tx = { from: sponsored ? relay : actor, to: sponsored ? relay : coordinatorAddress, data: sponsored ? "0x" : data };
  const provider = { getTransaction: async () => tx, getTransactionReceipt: async () => ({ status: 1,
    logs: [encodedEvent(managerInterface, wrongEmitter ? coordinatorAddress : managerAddress, "OracleTimedOut", [1, 4, 100])] }),
    send: async () => ({ type: "CALL", from: actor, to: wrongTarget ? managerAddress : coordinatorAddress, input: data }) };
  const contract = { target: managerAddress, interface: managerInterface, runner: provider,
    getClaim: async () => ({ claimId: 4n, policyId: 3n, claimantWallet: actor, claimAmount: 1n,
      incidentDate: 1n, submittedAt: 1n, verificationConfidence: 0n, status: 5n }) };
  const controller = load("controllers/adminController.js", {
    "../services/contractService": { getReadOnlyContract: () => contract,
      getOracleCoordinator: async () => ({ target: coordinatorAddress, interface: coordinatorInterface, runner: provider }) },
    "../models/AdminActionLog": { findOne: () => ({ lean: async () => null }) },
    "../services/adminActionLogService": { logAdminAction: async () => {} },
    "../services/notificationService": { notifyClaimStatusChange: async () => {} },
  });
  const r = response();
  await controller.confirmAdminClaimTransaction({ params: { id: "4" }, body: { action: "RESOLVE_ORACLE_TIMEOUT", transactionHash: hash },
    user: { walletAddress: actor, role: "ADMIN" } }, r.res, r.next);
  return r.result;
}

for (const sponsored of [false, true]) test(`timeout confirmation binds coordinator execution and manager event; sponsored=${sponsored}`, async () => {
  const result = await timeoutConfirmation({ sponsored }); assert.equal(result.error, undefined); assert.equal(result.body.success, true);
});
test("timeout proof cannot substitute the manager for the coordinator", async () => assert.ok((await timeoutConfirmation({ sponsored: true, wrongTarget: true })).error));
test("timeout proof cannot use a coordinator-forged manager event", async () => assert.ok((await timeoutConfirmation({ sponsored: true, wrongEmitter: true })).error));

const benefitCases = [
  ["approveBenefit", "approveBenefitRequest", [1], "BenefitApproved", [1, 100]],
  ["rejectBenefit", "rejectBenefitRequest", [1, ethers.id("reason")], "BenefitRejected", [1, ethers.id("reason")]],
  ["settleBenefit", "settleBenefitRequest", [1], "BenefitAllocated", [1, 100]],
  ["publishBenefitTerms", "confirmPublishedBenefitTerms", [1, false, true, false, 0, 5000, 0, 2, 1, ethers.id("terms")], "BenefitTermsPublished", [1, 1, ethers.id("terms")]],
];
for (const [method, handler, args, eventName, eventArgs] of benefitCases) for (const sponsored of [false, true]) {
  test(`${method} confirms exact retained benefits operation; sponsored=${sponsored}`, async () => {
    const data = benefitsInterface.encodeFunctionData(method, args);
    const provider = {
      getTransaction: async () => ({ from: sponsored ? relay : actor, to: sponsored ? relay : managerAddress, data: sponsored ? "0x" : data }),
      getTransactionReceipt: async () => ({ status: 1, logs: [encodedEvent(benefitsInterface, managerAddress, eventName, eventArgs)] }),
      send: async () => ({ type: "CALL", from: actor, to: managerAddress, input: data }),
    };
    const contract = { target: managerAddress, interface: new ethers.Interface(require("../abi/policyBenefitsAbi")), runner: provider };
    const controller = load("controllers/policyBenefitsController.js", {
      "../services/policyBenefitsService": { getReadOnlyBenefitsContract: () => contract, getBenefitsAddress: () => managerAddress },
      "../services/adminActionLogService": { logAdminAction: async () => {} },
    });
    const r = response();
    await controller[handler]({ params: method === "publishBenefitTerms" ? { packageId: "1" } : { requestId: "1" },
      body: { transactionHash: hash }, user: { walletAddress: actor, role: "ADMIN" } }, r.res, r.next);
    assert.equal(r.result.error, undefined); assert.equal(r.result.body.success, true);
  });
}

async function execution(trace) {
  return verifyWalletExecution({ contract: { target: managerAddress, interface: managerInterface,
    runner: { send: async () => trace } }, transaction: { from: relay, to: relay },
    transactionHash: hash, walletAddress: actor, method: "requestOracleVerification", matches: args => String(args[0]) === "4" });
}
const call = () => ({ type: "CALL", from: actor, to: managerAddress, input: managerInterface.encodeFunctionData("requestOracleVerification", [4]) });
test("delegated wallet CALL retains actor proof under executor DELEGATECALL", async () => {
  const proof = await execution({ type: "CALL", from: relay, to: actor,
    calls: [{ type: "DELEGATECALL", from: actor, to: relay, calls: [call()] }] });
  assert.equal(proof.actor, actor);
});
test("DELEGATECALL to manager alone is not an authorized manager CALL", async () => {
  await assert.rejects(execution({ ...call(), type: "DELEGATECALL" }));
});
test("a failed ancestor with revertReason cannot prove execution", async () => {
  await assert.rejects(execution({ revertReason: "failed batch", calls: [call()] }));
});
test("unrelated successful sibling cannot resurrect a reverted actor call", async () => {
  await assert.rejects(execution({ calls: [{ error: "execution reverted", calls: [call()] }, { type: "CALL", from: relay, to: managerAddress, input: call().input }] }));
});
test("deep provider traces fail within the verification depth budget", async () => {
  let root = call(); for (let index = 0; index < 66; index++) root = { calls: [root] };
  await assert.rejects(execution(root), /limits/);
});
