const fs = require("node:fs");
const { ethers } = require("../../backEnd/node_modules/ethers");
const { parseOperatorArguments } = require("../operatorArguments");

const from = "0x000000000000000000000000000000000b10c001";
const to = "0x000000000000000000000000000000000b10c002";
const slot = ethers.ZeroHash;
const account = { [from]: { balance: ethers.toQuantity(ethers.parseEther("100")) } };
const store = (value) => ({ ...account, [to]: { code: "0x600260005500", stateDiff: { [slot]: ethers.toBeHex(value, 32) } } });
const create = (bytes) => "0x61" + bytes.toString(16).padStart(4, "0") + "6000f3";

async function probe(url, chainId, sender) {
  const endpoint = new URL(url);
  if (endpoint.protocol !== "https:" || endpoint.username || endpoint.password) throw new Error("Expected HTTPS RPC");
  async function rpc(method, params = []) {
    const response = await fetch(endpoint, {
      method: "POST", headers: { "content-type": "application/json" },
      signal: AbortSignal.timeout(30_000), body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    });
    if (!response.ok) return { unavailable: "HTTP " + response.status };
    const { result, error } = await response.json();
    if (error) return { unavailable: "RPC " + error.code,
      message: String(error.message).replace(/0x[\da-f]{40,}/ig, "[redacted]").slice(0, 150) };
    return result;
  }
  if (BigInt(await rpc("eth_chainId")) !== BigInt(chainId)) throw new Error("Wrong chain");
  const block = await rpc("eth_getBlockByNumber", ["latest", false]);
  const blockGasLimit = Number(BigInt(block.gasLimit));
  const blockTag = block.number;
  const config = await rpc("eth_config");
  const artifacts = ["AcceleratedInsuranceManager", "PolicyEconomics"].map((name) =>
    require("../../contracts/artifacts/contracts/" + name + ".sol/" + name + ".json"));
  const managerData = artifacts[0].bytecode;
  const probes = [
    ["existingSlot", { to, data: "0x" }, store(1)],
    ["newSlot", { to, data: "0x" }, store(0)],
    ["smallCreation", { data: create(1) }, account],
    ["largeCodeDeposit", { data: create(24_000), gas: ethers.toQuantity(50_000_000) }, account],
    ["calldataZero", { to, data: "0x" + "00".repeat(1024) }, { ...account, [to]: { code: "0x00" } }],
    ["calldataNonzero", { to, data: "0x" + "01".repeat(1024) }, { ...account, [to]: { code: "0x00" } }],
    ["managerAtOldCap", { data: managerData, gas: ethers.toQuantity(16_777_216) }, account],
    ["managerAtPlannedLimit", { data: managerData, gas: ethers.toQuantity(84_067_315) }, account],
  ];
  const results = {};
  for (const [name, call, overrides] of probes) {
    const funded = sender && (name.startsWith("manager") || name === "largeCodeDeposit");
    const estimated = await rpc("eth_estimateGas", [{ from: funded ? sender : from, ...call }, blockTag, ...(funded ? [] : [overrides])]);
    results[name] = typeof estimated === "string" ? { estimatedGas: String(BigInt(estimated)) } : estimated;
  }
  const managerCall = { from: sender || from, data: managerData,
    gas: ethers.toQuantity(chainId === 11155111 ? 84_067_315 : 16_777_216),
    maxFeePerGas: ethers.toQuantity(BigInt(block.baseFeePerGas) * 2n), maxPriorityFeePerGas: "0x0" };
  const returned = await rpc("eth_call", [managerCall, blockTag, ...(sender ? [] : [account])]);
  results.managerCall = typeof returned === "string" ? { runtimeBytes: (returned.length - 2) / 2, runtimeHash: ethers.keccak256(returned) } : returned;
  const simulation = await rpc("eth_simulateV1", [{
    validation: true, traceTransfers: false,
    blockStateCalls: [{ ...(!sender && { stateOverrides: account }), calls: [managerCall] }],
  }, blockTag]);
  if (Array.isArray(simulation)) {
    const call = simulation[0].calls?.[0];
    results.managerSimulation = call && Object.fromEntries(Object.entries(call)
      .filter(([name]) => /^(status|gasUsed|executionGasUsed|stateGasUsed)$/i.test(name)));
  } else results.managerSimulation = simulation;
  const recheck = await rpc("eth_getBlockByNumber", [blockTag, false]);
  if (recheck?.hash !== block.hash) throw new Error("Probe block moved");
  return {
    chainId, block: Number(BigInt(block.number)), blockHash: block.hash, blockGasLimit,
    timestamp: Number(BigInt(block.timestamp)), origin: endpoint.origin,
    forkId: config?.current?.forkId ?? null, activationTime: config?.current?.activationTime ?? null,
    amsterdamHeaderFields: ["blockAccessListHash", "slotNumber"].filter((name) => name in block),
    managerInitcodeHash: ethers.keccak256(managerData),
    runtimeBytes: Object.fromEntries(artifacts.map((item) => [item.contractName, (item.deployedBytecode.length - 2) / 2])),
    probes: results,
  };
}

async function main() {
  const args = parseOperatorArguments(process.argv.slice(2), {
    values: ["--output", "--sender"], required: ["--output", "--sender"],
  });
  const sender = ethers.getAddress(args["--sender"]);
  const results = await Promise.all([
    probe("https://ethereum-sepolia-rpc.publicnode.com", 11155111, sender),
    probe("https://sepolia.gateway.tenderly.co", 11155111, sender),
    probe("https://sepolia.base.org", 84532, sender),
  ]);
  fs.writeFileSync(args["--output"], JSON.stringify(results, null, 2) + "\n", { flag: "wx" });
}

if (require.main === module) main().catch(() => {
  console.error("Gas probes could not finish against the selected public RPC endpoints.");
  process.exitCode = 1;
});
