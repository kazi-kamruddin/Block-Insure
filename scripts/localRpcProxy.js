const http = require("node:http");

const listenHost = "127.0.0.1";
const listenPort = Number(process.env.E2E_RPC_PROXY_PORT || 18545);
const targetUrl = new URL(
  process.env.E2E_RPC_PROXY_TARGET_URL || "http://127.0.0.1:8545"
);

if (!["127.0.0.1", "localhost", "::1"].includes(targetUrl.hostname)) {
  throw new Error("The E2E RPC proxy target must be loopback-only");
}
if (targetUrl.protocol !== "http:") {
  throw new Error("The E2E RPC proxy supports only the local HTTP Hardhat endpoint");
}
if (!Number.isInteger(listenPort) || listenPort < 1024 || listenPort > 65535) {
  throw new Error("E2E_RPC_PROXY_PORT must be a non-privileged TCP port");
}

let paused = false;

const sendJson = (response, statusCode, payload) => {
  const body = JSON.stringify(payload);
  response.writeHead(statusCode, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
  });
  response.end(body);
};

const server = http.createServer((request, response) => {
  if (request.method === "GET" && request.url === "/__control/status") {
    return sendJson(response, 200, { success: true, paused });
  }
  if (request.method === "POST" && request.url === "/__control/pause") {
    paused = true;
    return sendJson(response, 200, { success: true, paused });
  }
  if (request.method === "POST" && request.url === "/__control/resume") {
    paused = false;
    return sendJson(response, 200, { success: true, paused });
  }
  if (paused) {
    return sendJson(response, 503, {
      success: false,
      message: "Synthetic local RPC outage is active",
    });
  }
  if (request.method !== "POST") {
    return sendJson(response, 405, { success: false, message: "Method not allowed" });
  }

  const upstream = http.request(
    targetUrl,
    {
      method: "POST",
      headers: {
        "content-type": request.headers["content-type"] || "application/json",
      },
      timeout: 5_000,
    },
    (upstreamResponse) => {
      response.writeHead(upstreamResponse.statusCode || 502, {
        "content-type": upstreamResponse.headers["content-type"] || "application/json",
        "cache-control": "no-store",
      });
      upstreamResponse.pipe(response);
    }
  );
  upstream.once("timeout", () => upstream.destroy(new Error("Local RPC proxy timed out")));
  upstream.once("error", () => {
    if (!response.headersSent) {
      sendJson(response, 502, { success: false, message: "Local RPC is unavailable" });
    } else {
      response.destroy();
    }
  });
  request.pipe(upstream);
});

server.listen(listenPort, listenHost, () => {
  console.log(`[RPC Proxy] Listening on http://${listenHost}:${listenPort}`);
  console.log(`[RPC Proxy] Forwarding only to local Hardhat at ${targetUrl.origin}`);
});

const shutdown = () => server.close(() => process.exit(0));
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
