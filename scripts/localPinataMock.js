const crypto = require("node:crypto");
const http = require("node:http");

const host = "127.0.0.1";
const port = Number(process.env.LOCAL_PINATA_PORT || 5055);
const expectedToken = process.env.LOCAL_PINATA_TOKEN || "block-insure-local-test-only-token";
const maximumBodyBytes = 12 * 1024 * 1024;
const pinnedContent = new Map();

const sendJson = (response, statusCode, payload) => {
  const body = JSON.stringify(payload);
  response.writeHead(statusCode, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
  });
  response.end(body);
};

const authorized = (request) =>
  request.headers.authorization === `Bearer ${expectedToken}`;

const receiveBody = (request) =>
  new Promise((resolve, reject) => {
    const chunks = [];
    let received = 0;
    request.on("data", (chunk) => {
      received += chunk.length;
      if (received > maximumBodyBytes) {
        reject(Object.assign(new Error("Synthetic upload exceeds limit"), { statusCode: 413 }));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.once("end", () => resolve(Buffer.concat(chunks)));
    request.once("error", reject);
  });

const server = http.createServer(async (request, response) => {
  try {
    if (request.method === "GET" && request.url === "/health") {
      return sendJson(response, 200, {
        success: true,
        service: "local-pinata-simulator",
        pinned: pinnedContent.size,
      });
    }

    if (!authorized(request)) {
      return sendJson(response, 401, { error: "Unauthorized" });
    }

    if (request.method === "POST" && request.url === "/pinning/pinFileToIPFS") {
      const body = await receiveBody(request);
      const digest = crypto.createHash("sha256").update(body).digest("hex");
      const cid = `bafy-block-insure-local-${digest}`;
      pinnedContent.set(cid, body);
      return sendJson(response, 200, {
        IpfsHash: cid,
        PinSize: body.length,
        Timestamp: new Date().toISOString(),
      });
    }

    if (request.method === "DELETE" && request.url.startsWith("/pinning/unpin/")) {
      const cid = decodeURIComponent(request.url.slice("/pinning/unpin/".length));
      pinnedContent.delete(cid);
      response.writeHead(204, { "cache-control": "no-store" });
      return response.end();
    }

    return sendJson(response, 404, { error: "Route not found" });
  } catch (error) {
    if (!response.headersSent) {
      sendJson(response, error.statusCode || 500, { error: error.message });
    }
  }
});

server.listen(port, host, () => {
  console.log(`[Local Pinata] Ready at http://${host}:${port}; in-memory synthetic evidence only`);
});

const shutdown = () => server.close(() => process.exit(0));
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
