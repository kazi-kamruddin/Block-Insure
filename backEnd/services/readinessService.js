const http = require("node:http");
const https = require("node:https");

const isAddress = (value) => /^0x[a-f\d]{40}$/i.test(String(value || ""));

const requestJsonRpc = (rpcUrl, method, params = [], timeoutMs = 1_500) => {
  const target = new URL(rpcUrl);
  if (!["http:", "https:"].includes(target.protocol)) {
    throw new Error("RPC readiness requires an HTTP or HTTPS endpoint");
  }
  const transport = target.protocol === "https:" ? https : http;
  const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method, params });

  return new Promise((resolve, reject) => {
    const request = transport.request(
      target,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "content-length": Buffer.byteLength(body),
        },
        timeout: timeoutMs,
      },
      (response) => {
        let responseBody = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          responseBody += chunk;
        });
        response.on("end", () => {
          try {
            const payload = JSON.parse(responseBody);
            if (response.statusCode !== 200 || payload.error || payload.result == null) {
              throw new Error("RPC returned an unsuccessful response");
            }
            resolve(payload.result);
          } catch (error) {
            reject(error);
          }
        });
      }
    );
    request.once("timeout", () => request.destroy(new Error("RPC readiness timed out")));
    request.once("error", reject);
    request.end(body);
  });
};

const checkBlockchainReadiness = async ({
  environment = process.env,
  rpcRequest = requestJsonRpc,
} = {}) => {
  if (environment.BLOCKCHAIN_RUNTIME_ENABLED === "false") {
    return {
      ready: true,
      blockchainRpc: "disabled",
      contract: "disabled",
      chainId: null,
      expectedChainId: null,
    };
  }
  const rpcUrl = String(environment.RPC_URL || "").trim();
  const contractAddress = String(environment.VITE_CONTRACT_ADDRESS || "").trim();
  const expectedChainId = Number(environment.CHAIN_ID || 31337);
  const configuredTimeout = Number(environment.RPC_HEALTH_TIMEOUT_MS || 1_500);
  const timeoutMs = Number.isFinite(configuredTimeout)
    ? Math.min(Math.max(configuredTimeout, 250), 10_000)
    : 1_500;

  if (!rpcUrl) {
    return {
      ready: false,
      blockchainRpc: "missing",
      contract: contractAddress ? "unchecked" : "missing",
      chainId: null,
      expectedChainId,
    };
  }
  if (!isAddress(contractAddress)) {
    return {
      ready: false,
      blockchainRpc: "unchecked",
      contract: contractAddress ? "invalid_address" : "missing",
      chainId: null,
      expectedChainId,
    };
  }

  try {
    const chainIdHex = await rpcRequest(rpcUrl, "eth_chainId", [], timeoutMs);
    const chainId = Number(BigInt(chainIdHex));
    if (!Number.isSafeInteger(chainId) || chainId !== expectedChainId) {
      return {
        ready: false,
        blockchainRpc: "wrong_chain",
        contract: "unchecked",
        chainId: Number.isSafeInteger(chainId) ? chainId : null,
        expectedChainId,
      };
    }

    const code = await rpcRequest(
      rpcUrl,
      "eth_getCode",
      [contractAddress, "latest"],
      timeoutMs
    );
    const deployed = typeof code === "string" && !/^0x0*$/i.test(code);
    return {
      ready: deployed,
      blockchainRpc: "connected",
      contract: deployed ? "deployed" : "not_deployed",
      chainId,
      expectedChainId,
    };
  } catch {
    return {
      ready: false,
      blockchainRpc: "unavailable",
      contract: "unchecked",
      chainId: null,
      expectedChainId,
    };
  }
};

const buildHealthPayload = async ({
  databaseConnected,
  environment = process.env,
  rpcRequest,
} = {}) => {
  const blockchain = await checkBlockchainReadiness({ environment, rpcRequest });
  const databaseState = databaseConnected ? "connected" : "disconnected";
  const ready = databaseConnected && blockchain.ready;
  const limited = environment.BLOCKCHAIN_RUNTIME_ENABLED === "false";

  return {
    success: ready,
    status: ready ? (limited ? "limited" : "ready") : "not_ready",
    message: ready
      ? limited
        ? "Backend off-chain preview is ready"
        : "Backend is ready"
      : "Backend dependencies are unavailable",
    services: {
      database: databaseState,
      blockchainRpc: blockchain.blockchainRpc,
      contract: blockchain.contract,
      chainId: blockchain.chainId,
      expectedChainId: blockchain.expectedChainId,
      evidenceEncryption: "client-aes256gcm-with-recrypt-pre",
      evidenceTransparency: environment.EVIDENCE_REGISTRY_ADDRESS
        ? "anchored"
        : "registry-address-missing",
    },
  };
};

module.exports = {
  buildHealthPayload,
  checkBlockchainReadiness,
  requestJsonRpc,
};
