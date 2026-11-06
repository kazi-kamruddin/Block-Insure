const test = require("node:test"), assert = require("node:assert/strict"), crypto = require("node:crypto");
const { ethers } = require("ethers");
const { createAppealValidators } = require("../appealValidation");
const runtime = require("../runtimeProtocol");
const managerAddress = "0x" + "1".repeat(40), owner = "0x" + "2".repeat(40), other = "0x" + "3".repeat(40), adjudicatorAddress = "0x" + "4".repeat(40);
const managerInterface = new ethers.Interface(require("../abi/InsuranceManager.json").abi);
const adjudicatorInterface = new ethers.Interface(["event AppealStarted(uint256 indexed claimId,uint8 appealRound,uint64 newClaimVersion)"]);
const event = (iface, address, name, args) => ({ address, ...iface.encodeEventLog(iface.getEvent(name), args) });
function fixture(sponsored = true) {
  const payload = { schema: "BLOCK_INSURE_APPEAL_V1", claimId: "4", proposedClaimAmountEth: "0.1" };
  const digest = "0x" + crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex");
  const claim = { claimId: 4n, claimantWallet: owner, hospitalId: "HOSP-001", invoiceHash: ethers.id("invoice"), claimType: "HOSPITALIZATION", claimAmount: ethers.parseEther("0.1") };
  const request = { claimVersion: 2n, requestBlock: 100n };
  const response = { appealCommitment: { payload, appealReasonHash: digest, transactionHash: ethers.id("appeal") },
    query: { claimId: "4", invoiceHash: claim.invoiceHash, hospitalId: claim.hospitalId, claimType: claim.claimType, claimAmountEth: "0.1" } };
  const receipt = { status: 1, blockNumber: 90, logs: [event(managerInterface, managerAddress, "ClaimAppealed", [4, owner, digest, 1]),
    event(adjudicatorInterface, adjudicatorAddress, "AppealStarted", [4, 1, 2])] };
  const provider = { getTransactionReceipt: async () => receipt, getTransaction: async () => ({ from: sponsored ? other : owner, to: sponsored ? other : managerAddress }) };
  const manager = { interface: managerInterface, claimAdjudicator: async () => adjudicatorAddress };
  const validators = createAppealValidators({ crypto, ethers, provider, manager, CONTRACT_ADDRESS: managerAddress,
    normalizeHash: value => String(value || "").trim().toLowerCase(), invoiceIdentity: require("../recordIdentity").invoiceIdentity });
  return { claim, request, response, receipt, manager, provider, digest, validators,
    validate: () => validators.eventBound(request, claim, response) };
}
for (const sponsored of [false, true]) test(`v5 proves actual operation events independent of outer transport; sponsored=${sponsored}`, async () => {
  const f = fixture(sponsored); assert.equal(await f.validate(), true);
});
test("historical v4 direct/sponsored outcomes are preserved, not reinterpreted", async () => {
  assert.equal(await fixture(false).validators.legacy(fixture(false).request, fixture(false).claim, fixture(false).response), true);
  const f = fixture(true); assert.equal(await f.validators.legacy(f.request, f.claim, f.response), false);
  assert.equal(runtime.resolveRequestModel(runtime.loadHistoricalProtocolArtifact().modelIdentityHash).artifact.appealProofVersion, undefined);
  assert.equal(runtime.resolveRequestModel(runtime.loadProtocolArtifact().modelIdentityHash).artifact.appealProofVersion, "trusted-appeal-events-v2");
});
for (const [name, change] of [
  ["wrong manager emitter", f => { f.receipt.logs[0].address = other; }],
  ["wrong claimant", f => { f.receipt.logs[0] = event(managerInterface, managerAddress, "ClaimAppealed", [4, other, f.digest, 1]); }],
  ["wrong reason", f => { f.receipt.logs[0] = event(managerInterface, managerAddress, "ClaimAppealed", [4, owner, ethers.id("wrong"), 1]); }],
  ["wrong claim", f => { f.receipt.logs[0] = event(managerInterface, managerAddress, "ClaimAppealed", [8, owner, f.digest, 1]); }],
  ["wrong adjudicator emitter", f => { f.receipt.logs[1].address = other; }],
  ["stale claim version", f => { f.request.claimVersion = 3n; }],
  ["missing version event", f => { f.receipt.logs.pop(); }],
  ["duplicate version events", f => { f.receipt.logs.push(f.receipt.logs[1]); }],
  ["duplicate appeal events", f => { f.receipt.logs.push(f.receipt.logs[0]); }],
  ["reverted transaction", f => { f.receipt.status = 0; }],
  ["future appeal after pinned request", f => { f.receipt.blockNumber = 101; }],
  ["missing receipt", f => { f.provider.getTransactionReceipt = async () => null; }],
  ["payload hash mismatch", f => { f.response.appealCommitment.payload.proposedClaimAmountEth = "0.2"; }],
  ["query mismatch", f => { f.response.query.claimAmountEth = "0.2"; }],
]) test("v5 rejects " + name, async () => { const f = fixture(); change(f); assert.equal(await f.validate(), false); });
test("access-preparation retry may have round zero and remains version bound", async () => {
  const f = fixture(); f.receipt.logs[1] = event(adjudicatorInterface, adjudicatorAddress, "AppealStarted", [4, 0, 2]);
  assert.equal(await f.validate(), true);
});
test("provider outage retains retryable work rather than manufacturing a successful proof", async () => {
  const f = fixture(); f.provider.getTransactionReceipt = async () => { throw Error("synthetic RPC outage"); };
  await assert.rejects(f.validate(), /outage/);
});
