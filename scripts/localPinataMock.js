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

const extractMultipartFile = (body, contentType) => {
  const boundaryMatch = String(contentType || "").match(/boundary=(?:"([^"]+)"|([^;]+))/i);
  if (!boundaryMatch) throw Object.assign(new Error("Multipart boundary is missing"), { statusCode: 400 });
  const boundary = Buffer.from(`--${boundaryMatch[1] || boundaryMatch[2]}`);
  const headerSeparator = Buffer.from("\r\n\r\n");
  const partStart = body.indexOf(boundary);
  const headerEnd = body.indexOf(headerSeparator, partStart + boundary.length);
  if (partStart < 0 || headerEnd < 0) {
    throw Object.assign(new Error("Multipart file part is invalid"), { statusCode: 400 });
  }
  const contentStart = headerEnd + headerSeparator.length;
  const contentEnd = body.indexOf(Buffer.from(`\r\n--${boundary.toString().slice(2)}`), contentStart);
  if (contentEnd < 0) throw Object.assign(new Error("Multipart file terminator is missing"), { statusCode: 400 });
  return body.subarray(contentStart, contentEnd);
};

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

    if (request.method === "GET" && request.url.startsWith("/ipfs/")) {
      const cid = decodeURIComponent(request.url.slice("/ipfs/".length));
      const content = pinnedContent.get(cid);
      if (!content) return sendJson(response, 404, { error: "Synthetic CID not found" });
      response.writeHead(200, {
        "content-type": "application/octet-stream",
        "content-length": content.length,
        "cache-control": "no-store",
        "access-control-allow-origin": "*",
      });
      return response.end(content);
    }

    if (!authorized(request)) {
      return sendJson(response, 401, { error: "Unauthorized" });
    }

    if (request.method === "POST" && request.url === "/pinning/pinFileToIPFS") {
      const body = await receiveBody(request);
      const file = extractMultipartFile(body, request.headers["content-type"]);
      const digest = crypto.createHash("sha256").update(file).digest("hex");
      const cid = `bafy-block-insure-local-${digest}`;
      pinnedContent.set(cid, file);
      return sendJson(response, 200, {
        IpfsHash: cid,
        PinSize: file.length,
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
