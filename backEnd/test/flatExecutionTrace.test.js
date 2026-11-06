const test = require("node:test");
const assert = require("node:assert/strict");
const { ethers } = require("ethers");
const { verifyWalletExecution } = require("../services/transactionExecutionService");
const actor = "0x" + "2".repeat(40), target = "0x" + "1".repeat(40), relay = "0x" + "3".repeat(40);
const hash = ethers.id("flat-proof"), blockHash = ethers.id("proof-block");
const iface = new ethers.Interface(require("../abi/InsuranceManager.json").abi);
const input = iface.encodeFunctionData("requestOracleVerification", [4]);
function frames() {
  const frame = (traceAddress, from, to, data, subtraces = 0) => ({ type: "call", traceAddress, subtraces,
    transactionHash: hash, blockHash, action: { callType: "call", from, to, input: data }, result: { gasUsed: "0x100", output: "0x" } });
  return [frame([], relay, actor, "0x1234", 1), frame([0], actor, target, input)];
}
async function verify(rows, change = {}) {
  const methods = [];
  const result = await verifyWalletExecution({ contract: { target, interface: iface, runner: { send: async method => {
    methods.push(method);
    if (method === "debug_traceTransaction") throw Object.assign(Error("Method not found"), { code: -32601 });
    assert.equal(method, "trace_transaction"); return rows;
  } } }, transaction: { from: relay, to: actor, data: "0x1234", blockHash }, transactionHash: hash,
    walletAddress: actor, method: "requestOracleVerification", matches: args => String(args[0]) === "4", ...change });
  return { result, methods };
}
test("flat trace fallback proves a sponsored operation with transaction and ancestry binding", async () => {
  const { result, methods } = await verify(frames());
  assert.equal(result.actor, actor); assert.equal(result.proof, "SUCCESSFUL_FLAT_CALL_TRACE");
  assert.deepEqual(methods, ["debug_traceTransaction", "trace_transaction"]);
});
for (const [name, mutate] of [
  ["another transaction", rows => { rows[1].transactionHash = ethers.id("other"); }],
  ["another inclusion block", rows => { rows.forEach(row => row.blockHash = ethers.id("other")); }],
  ["missing root", rows => rows.shift()],
  ["missing intermediate ancestor", rows => { rows[1].traceAddress = [0, 0]; }],
  ["duplicate path", rows => rows.push(rows[1])],
  ["reverted ancestor", rows => { rows[0].error = "execution reverted"; }],
  ["missing successful CALL result", rows => { delete rows[1].result; }],
  ["malformed successful CALL result", rows => { rows[1].result = "unverified"; }],
  ["forged outer actor", rows => { rows[0].action.from = actor; }],
  ["wrong outer calldata", rows => { rows[0].action.input = "0xdead"; }],
  ["incorrect child count", rows => { rows[0].subtraces = 2; }],
  ["noninteger path", rows => { rows[1].traceAddress = [0.5]; }],
  ["DELEGATECALL as target proof", rows => { rows[1].action.callType = "delegatecall"; }],
  ["wrong internal actor", rows => { rows[1].action.from = relay; }],
  ["ambiguous actor calls", rows => { rows[0].subtraces = 2; rows.push({ ...rows[1], traceAddress: [1] }); }],
]) test(`flat execution proof rejects ${name}`, async () => {
  const rows = frames(); mutate(rows); await assert.rejects(verify(rows));
});
test("flat trace budget rejects an oversized response", async () => {
  await assert.rejects(verify(Array.from({ length: 2001 }, () => frames()[0])));
});
test("provider outage does not multiply into another tracing request", async () => {
  let calls = 0;
  await assert.rejects(verifyWalletExecution({ contract: { target, interface: iface, runner: { send: async () => {
    calls++; throw Object.assign(Error("rate limited"), { code: 429 });
  } } }, transaction: { from: relay, to: relay }, transactionHash: hash, walletAddress: actor,
    method: "requestOracleVerification", matches: () => true }));
  assert.equal(calls, 1);
});
