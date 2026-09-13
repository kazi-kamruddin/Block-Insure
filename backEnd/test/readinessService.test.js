const assert = require("node:assert/strict");
const test = require("node:test");
const {
  buildHealthPayload,
  checkBlockchainReadiness,
} = require("../services/readinessService");

const environment = {
  RPC_URL: "http://127.0.0.1:8545",
  CHAIN_ID: "31337",
  VITE_CONTRACT_ADDRESS: "0x1111111111111111111111111111111111111111",
  EVIDENCE_REGISTRY_ADDRESS: "0x2222222222222222222222222222222222222222",
};

test("readiness verifies the RPC chain and deployed manager bytecode", async () => {
  const calls = [];
  const rpcRequest = async (_url, method, params) => {
    calls.push({ method, params });
    if (method === "eth_chainId") return "0x7a69";
    if (method === "eth_getCode") return "0x6001600055";
    throw new Error("unexpected method");
  };
  const payload = await buildHealthPayload({
    databaseConnected: true,
    environment,
    rpcRequest,
  });

  assert.equal(payload.success, true);
  assert.deepEqual(payload.services, {
    database: "connected",
    blockchainRpc: "connected",
    contract: "deployed",
    chainId: 31337,
    expectedChainId: 31337,
    evidenceEncryption: "client-aes256gcm-with-recrypt-pre",
    evidenceTransparency: "anchored",
  });
  assert.deepEqual(calls.map((call) => call.method), ["eth_chainId", "eth_getCode"]);
  assert.equal(calls[1].params[0], environment.VITE_CONTRACT_ADDRESS);
});

test("readiness fails closed when RPC is unavailable without exposing its error", async () => {
  const payload = await buildHealthPayload({
    databaseConnected: true,
    environment,
    rpcRequest: async () => {
      throw new Error("connection refused with sensitive upstream details");
    },
  });

  assert.equal(payload.success, false);
  assert.equal(payload.status, "not_ready");
  assert.equal(payload.services.database, "connected");
  assert.equal(payload.services.blockchainRpc, "unavailable");
  assert.equal(payload.services.contract, "unchecked");
  assert.doesNotMatch(JSON.stringify(payload), /sensitive|refused/i);
});

test("readiness rejects the wrong chain and an address without deployed code", async (t) => {
  await t.test("wrong chain", async () => {
    const result = await checkBlockchainReadiness({
      environment,
      rpcRequest: async () => "0x1",
    });
    assert.deepEqual(result, {
      ready: false,
      blockchainRpc: "wrong_chain",
      contract: "unchecked",
      chainId: 1,
      expectedChainId: 31337,
    });
  });

  await t.test("missing deployment", async () => {
    const result = await checkBlockchainReadiness({
      environment,
      rpcRequest: async (_url, method) =>
        method === "eth_chainId" ? "0x7a69" : "0x",
    });
    assert.deepEqual(result, {
      ready: false,
      blockchainRpc: "connected",
      contract: "not_deployed",
      chainId: 31337,
      expectedChainId: 31337,
    });
  });
});
