const normalize = value => String(value || "").toLowerCase();
const fail = (message, statusCode = 409) => { throw Object.assign(new Error(message), { statusCode }); };

function flatCallTree(rows, transaction, transactionHash) {
  if (!Array.isArray(rows) || !rows.length || rows.length > 2000) fail("Invalid or oversized flat execution trace");
  const nodes = new Map();
  for (const row of rows) {
    if (!row || !Array.isArray(row.traceAddress) || row.traceAddress.length > 64 ||
        row.traceAddress.some(index => !Number.isSafeInteger(index) || index < 0) ||
        !Number.isSafeInteger(row.subtraces) || row.subtraces < 0 || row.subtraces > 2000 ||
        normalize(row.transactionHash) !== normalize(transactionHash)) fail("Unbound or malformed flat execution trace");
    const key = row.traceAddress.join(".");
    if (nodes.has(key)) fail("Duplicate execution trace path");
    if (row.type === "call" && (!row.action || (!row.error &&
        (!row.result || typeof row.result !== "object" || Array.isArray(row.result) ||
          !/^0x[\da-f]+$/i.test(row.result.gasUsed || "") || !/^0x(?:[\da-f]{2})*$/i.test(row.result.output || "")))))
      fail("Incomplete call execution trace");
    nodes.set(key, { row, children: [], frame: { type: row.type === "call" ? String(row.action.callType).toUpperCase() : row.type,
      from: row.action?.from, to: row.action?.to, input: row.action?.input, error: row.error, calls: [] } });
  }
  const root = nodes.get("");
  if (!root || root.frame.type !== "CALL" || normalize(root.frame.from) !== normalize(transaction.from) ||
      normalize(root.frame.to) !== normalize(transaction.to) || normalize(root.frame.input) !== normalize(transaction.data) ||
      !/^0x[\da-f]{64}$/i.test(root.row.blockHash || "") ||
      (transaction.blockHash && normalize(root.row.blockHash) !== normalize(transaction.blockHash))) fail("Flat trace does not bind the outer transaction");
  for (const node of nodes.values()) {
    if (normalize(node.row.blockHash) !== normalize(root.row.blockHash)) fail("Execution trace spans different blocks");
    const address = node.row.traceAddress;
    if (address.length) {
      const parent = nodes.get(address.slice(0, -1).join("."));
      if (!parent || address.at(-1) >= parent.row.subtraces) fail("Execution trace ancestor is unavailable");
      parent.children.push(node);
    }
  }
  for (const node of nodes.values()) {
    if (node.children.length !== node.row.subtraces) fail("Execution trace is incomplete");
    node.frame.calls = node.children.map(child => child.frame);
  }
  return root.frame;
}

const methodUnavailable = error => {
  const code = error?.error?.code ?? error?.info?.error?.code ?? error?.code;
  return Number(code) === -32601 || (Number(code) === -32600 && /not available|not support|method not found/i.test(
    String(error?.error?.message || error?.info?.error?.message || error?.message || "")));
};

function trustedEvents(contract, receipt, name, matches) {
  const found = [];
  for (const log of receipt.logs || []) {
    if (normalize(log.address) !== normalize(contract.target)) continue;
    let event;
    try { event = contract.interface.parseLog(log); } catch { continue; }
    if (event?.name === name && matches(event.args)) found.push({ event, log });
  }
  return found;
}

// Events without an actor cannot establish which Admin acted. For relayed calls
// require a successful CALL frame from the authenticated wallet to the exact
// contract/method/arguments. RPCs without call traces fail closed, not by guessing.
async function verifyWalletExecution({ contract, transaction, transactionHash, walletAddress, method, matches }) {
  const target = normalize(contract.target), wallet = normalize(walletAddress);
  const decode = input => {
    try {
      const parsed = contract.interface.parseTransaction({ data: input || "0x" });
      return parsed?.name === method && matches(parsed.args) ? parsed : null;
    } catch { return null; }
  };
  if (normalize(transaction.to) === target && normalize(transaction.from) === wallet) {
    const parsed = decode(transaction.data);
    if (!parsed) fail("Transaction does not execute the expected operation");
    return { parsed, actor: wallet, proof: "DIRECT_CALL" };
  }
  const provider = contract.runner.provider || contract.runner;
  if (typeof provider.send !== "function") fail("Sponsored execution requires verified call-trace support");
  let trace, timer, flat = false;
  const deadline = Date.now() + 10000;
  const read = async (rpcMethod, params) => {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error("Trace timeout");
    try { return await Promise.race([
      provider.send(rpcMethod, params),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("Trace timeout")), remaining); }),
    ]); } finally { clearTimeout(timer); }
  };
  try {
    try { trace = await read("debug_traceTransaction", [transactionHash, { tracer: "callTracer", timeout: "5s" }]); }
    catch (error) {
      if (!methodUnavailable(error)) throw error;
      trace = await read("trace_transaction", [transactionHash]); flat = true;
    }
  } catch { fail("Sponsored execution proof is unavailable; retry confirmation with an execution-trace capable RPC"); }
  if (flat) trace = flatCallTree(trace, transaction, transactionHash);
  const stack = [{ frame: trace, depth: 0 }], found = [];
  let visited = 0;
  while (stack.length) {
    const { frame, depth } = stack.pop();
    if (++visited > 2000 || depth > 64) fail("Execution trace exceeds confirmation limits");
    if (!frame || typeof frame !== "object" || frame.error || frame.revertReason) continue;
    if (frame.type === "CALL" && normalize(frame.from) === wallet && normalize(frame.to) === target) {
      const parsed = decode(frame.input);
      if (parsed) found.push(parsed);
    }
    if (frame.calls && !Array.isArray(frame.calls)) fail("Malformed execution trace");
    for (const child of frame.calls || []) stack.push({ frame: child, depth: depth + 1 });
  }
  if (found.length !== 1) fail("Execution does not uniquely prove this wallet's operation", 403);
  return { parsed: found[0], actor: wallet, proof: flat ? "SUCCESSFUL_FLAT_CALL_TRACE" : "SUCCESSFUL_CALL_TRACE" };
}
module.exports = { trustedEvents, verifyWalletExecution };
