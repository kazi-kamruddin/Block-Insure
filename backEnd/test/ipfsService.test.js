const assert = require("node:assert/strict");
const http = require("node:http");
const test = require("node:test");

const servicePath = require.resolve("../services/ipfsService");

const startServer = (handler) =>
  new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, "127.0.0.1", () => resolve(server));
  });

const stopServer = (server) =>
  new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve()))
  );

const loadService = (server, overrides = {}) => {
  const address = server.address();
  process.env.PINATA_API_BASE_URL = `http://127.0.0.1:${address.port}`;
  process.env.PINATA_JWT = "local-test-token";
  process.env.PINATA_TIMEOUT_MS = String(overrides.timeoutMs || 1_000);
  delete require.cache[servicePath];
  return require(servicePath);
};

test.afterEach(() => {
  delete process.env.PINATA_API_BASE_URL;
  delete process.env.PINATA_JWT;
  delete process.env.PINATA_TIMEOUT_MS;
  delete require.cache[servicePath];
});

test("uploads encrypted bytes to a configurable local Pinata endpoint", async () => {
  let observedRequest;
  const server = await startServer((request, response) => {
    observedRequest = {
      authorization: request.headers.authorization,
      contentType: request.headers["content-type"],
      method: request.method,
      url: request.url,
    };
    request.resume();
    request.on("end", () => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ IpfsHash: "bafy-local-synthetic-cid" }));
    });
  });

  try {
    const { uploadToPinata } = loadService(server);
    const cid = await uploadToPinata(
      Buffer.from("BINSENC2synthetic-ciphertext"),
      "claim.binsenc",
      "application/octet-stream"
    );
    assert.equal(cid, "bafy-local-synthetic-cid");
    assert.deepEqual(observedRequest, {
      authorization: "Bearer local-test-token",
      contentType: observedRequest.contentType,
      method: "POST",
      url: "/pinning/pinFileToIPFS",
    });
    assert.match(observedRequest.contentType, /^multipart\/form-data; boundary=/);
  } finally {
    await stopServer(server);
  }
});

test("rejects a successful provider response that omits the content identifier", async () => {
  const server = await startServer((request, response) => {
    request.resume();
    request.on("end", () => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ PinSize: 42 }));
    });
  });

  try {
    const { uploadToPinata } = loadService(server);
    await assert.rejects(
      uploadToPinata(Buffer.from("ciphertext"), "claim.bin", "application/octet-stream"),
      (error) => error.statusCode === 502 && /invalid content identifier/.test(error.message)
    );
  } finally {
    await stopServer(server);
  }
});

test("maps provider failures and timeouts to sanitized gateway errors", async () => {
  const failingServer = await startServer((request, response) => {
    request.resume();
    request.on("end", () => {
      response.writeHead(503, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "synthetic provider detail" }));
    });
  });
  try {
    const { uploadToPinata } = loadService(failingServer);
    await assert.rejects(
      uploadToPinata(Buffer.from("ciphertext"), "claim.bin", "application/octet-stream"),
      (error) => error.statusCode === 502 && error.message === "Evidence storage upload failed"
    );
  } finally {
    await stopServer(failingServer);
  }

  const timeoutServer = await startServer(() => {});
  try {
    const { uploadToPinata } = loadService(timeoutServer, { timeoutMs: 1_000 });
    await assert.rejects(
      uploadToPinata(Buffer.from("ciphertext"), "claim.bin", "application/octet-stream"),
      (error) => error.statusCode === 504 && error.message === "Evidence storage upload timed out"
    );
  } finally {
    timeoutServer.closeAllConnections();
    await stopServer(timeoutServer);
  }
});

test("unpins through the local endpoint and URL-encodes the content identifier", async () => {
  let requestPath;
  const server = await startServer((request, response) => {
    requestPath = request.url;
    request.resume();
    request.on("end", () => {
      response.writeHead(200);
      response.end();
    });
  });

  try {
    const { unpinFromPinata } = loadService(server);
    assert.equal(await unpinFromPinata("cid/with/slashes"), true);
    assert.equal(requestPath, "/pinning/unpin/cid%2Fwith%2Fslashes");
  } finally {
    await stopServer(server);
  }
});
