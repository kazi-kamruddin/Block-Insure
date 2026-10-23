const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const net = require("node:net");
const path = require("node:path");
const test = require("node:test");

test("a disabled Oracle process stays live but never claims blockchain readiness", { timeout: 15_000 }, async () => {
  const reservation = net.createServer();
  await new Promise((resolve) => reservation.listen(0, "127.0.0.1", resolve));
  const port = reservation.address().port;
  await new Promise((resolve) => reservation.close(resolve));
  const child = spawn(process.execPath, ["index.js"], {
    cwd: path.resolve(__dirname, ".."),
    env: {
      ...process.env,
      ORACLE_ENV_FILE: path.join(__dirname, "synthetic-health-test.env"),
      ORACLE_WORKER_ENABLED: "false",
      ORACLE_CURSOR_MODE: "file",
      PORT: String(port),
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  const exited = new Promise((resolve) => {
    child.once("exit", resolve);
    child.once("error", resolve);
  });
  child.stderr.resume();
  let timer;
  try {
    await new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(new Error("Oracle health server did not start")), 10_000);
      child.once("error", reject);
      child.once("exit", () => reject(new Error("Oracle stopped before its health server was ready")));
      child.stdout.on("data", (chunk) => {
        if (chunk.toString().includes("Health server listening")) resolve();
      });
    });
    clearTimeout(timer);
    const live = await fetch(`http://127.0.0.1:${port}/health/live`, { signal: AbortSignal.timeout(3_000) });
    assert.equal(live.status, 200);
    const body = await live.json();
    assert.equal(body.success, true);
    assert.equal(body.status, "alive");
    assert.equal(body.workerEnabled, false);
    assert.equal(body.oracleWallet, "");
    const ready = await fetch(`http://127.0.0.1:${port}/health/ready`, { signal: AbortSignal.timeout(3_000) });
    assert.equal(ready.status, 503);
    assert.equal((await ready.json()).success, false);
  } finally {
    clearTimeout(timer);
    child.kill();
    await exited;
  }
});
