const assert = require("node:assert/strict");
const test = require("node:test");
const express = require("express");
const upload = require("../middleware/uploadMiddleware");

test("multipart evidence boundaries return actionable client errors", async (t) => {
  const app = express();
  app.post("/upload", upload.single("document"), (req, res) => {
    res.json({ size: req.file?.size });
  });
  app.use((error, _req, res, _next) => {
    res.status(error.statusCode || 500).json({ message: error.message });
  });
  const server = await new Promise((resolve) => {
    const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
  });
  const url = `http://127.0.0.1:${server.address().port}/upload`;
  const send = (files) => {
    const body = new FormData();
    for (const [field, blob] of files) body.append(field, blob, "synthetic.bin");
    return fetch(url, { method: "POST", body });
  };
  try {
    await t.test("accepts small encrypted evidence", async () => {
      const response = await send([["document", new Blob(["ciphertext"], { type: "application/octet-stream" })]]);
      assert.equal(response.status, 200);
      assert.equal((await response.json()).size, 10);
    });
    await t.test("rejects unsupported MIME with HTTP 415", async () => {
      const response = await send([["document", new Blob(["synthetic"], { type: "text/html" })]]);
      assert.equal(response.status, 415);
      assert.match((await response.json()).message, /encrypted evidence/);
    });
    await t.test("rejects more than one file with HTTP 400", async () => {
      const blob = new Blob(["ciphertext"], { type: "application/octet-stream" });
      const response = await send([["document", blob], ["document", blob]]);
      assert.equal(response.status, 400);
      await response.text();
    });
    await t.test("rejects oversized ciphertext with HTTP 413", async () => {
      const response = await send([["document", new Blob([Buffer.alloc(10 * 1024 * 1024 + 1)], {
        type: "application/octet-stream",
      })]]);
      assert.equal(response.status, 413);
      await response.text();
    });
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
      server.closeIdleConnections();
    });
  }
});
