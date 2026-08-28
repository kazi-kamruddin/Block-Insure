const { spawn, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const readline = require("node:readline");
const { writeEvent } = require("./observability");

const projectRoot = path.resolve(__dirname, "..");
const npmCli = process.env.npm_execpath || path.join(
  path.dirname(process.execPath),
  "node_modules",
  "npm",
  "bin",
  "npm-cli.js"
);
const children = [];
const bootstrap = process.argv.includes("--bootstrap");
let shuttingDown = false;

function prefixStream(stream, label, output) {
  const reader = readline.createInterface({ input: stream });
  reader.on("line", (line) => {
    writeEvent(label, "info", line);
    output.write(`[${label}] ${line}\n`);
  });
}

function startService(label, directory, args) {
  const child = spawn(process.execPath, [npmCli, ...args], {
    cwd: path.join(projectRoot, directory),
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });

  prefixStream(child.stdout, label, process.stdout);
  prefixStream(child.stderr, label, process.stderr);
  child.on("exit", (code, signal) => {
    if (shuttingDown) return;
    if (code && code !== 0) {
      writeEvent(label, "error", `exited with code ${code}`);
      console.error(`[Launcher] ${label} exited with code ${code}.`);
    } else if (signal) {
      writeEvent(label, "warn", `stopped (${signal})`);
      console.log(`[Launcher] ${label} stopped (${signal}).`);
    } else console.error(`[Launcher] ${label} stopped unexpectedly.`);
    shuttingDown = true;
    stopAll("SIGTERM");
    setTimeout(() => process.exit(code || 1), 250);
  });
  children.push(child);
  return child;
}

function readEnvValue(relativePath, key) {
  const content = fs.readFileSync(path.join(projectRoot, relativePath), "utf8");
  const prefix = `${key}=`;
  const line = content
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .find((entry) => entry.startsWith(prefix));
  return line ? line.slice(prefix.length).trim() : "";
}

function jsonRpc(method, params = [], timeoutMs = 1_500) {
  const payload = JSON.stringify({ jsonrpc: "2.0", id: 1, method, params });

  return new Promise((resolve, reject) => {
    const request = http.request(
      "http://127.0.0.1:8545",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "content-length": Buffer.byteLength(payload),
        },
        timeout: timeoutMs,
      },
      (response) => {
        let body = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          body += chunk;
        });
        response.on("end", () => {
          try {
            const parsed = JSON.parse(body);
            if (response.statusCode !== 200 || parsed.error || parsed.result == null) {
              throw new Error(parsed.error?.message || `HTTP ${response.statusCode}`);
            }
            resolve(parsed.result);
          } catch (error) {
            reject(new Error(`Invalid local JSON-RPC response: ${error.message}`));
          }
        });
      }
    );
    request.once("timeout", () => request.destroy(new Error("JSON-RPC request timed out")));
    request.once("error", reject);
    request.end(payload);
  });
}

async function verifyLocalDeployment() {
  const chainId = await jsonRpc("eth_chainId");
  if (BigInt(chainId) !== 31337n) {
    throw new Error(`Expected local chain ID 31337, received ${BigInt(chainId)}`);
  }

  const managerAddress = readEnvValue("backEnd/.env", "VITE_CONTRACT_ADDRESS");
  if (!/^0x[0-9a-fA-F]{40}$/.test(managerAddress)) {
    throw new Error("Backend VITE_CONTRACT_ADDRESS is not a valid contract address");
  }

  const code = await jsonRpc("eth_getCode", [managerAddress, "latest"]);
  if (code === "0x" || code === "0x0") {
    throw new Error(`No deployed InsuranceManager exists at ${managerAddress}`);
  }
}

function stopAll(signal = "SIGTERM") {
  shuttingDown = true;
  for (const child of children) {
    if (!child.killed) child.kill(signal);
  }
}

async function waitFor(check, description, timeoutMs = 30_000) {
  const startedAt = Date.now();
  let lastError;
  while (Date.now() - startedAt < timeoutMs) {
    try {
      await check();
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  throw new Error(`${description} was not ready within ${timeoutMs} ms: ${lastError?.message || "unknown error"}`);
}

async function waitForHttp(url, expectedText) {
  await waitFor(async () => {
    const response = await fetch(url, { signal: AbortSignal.timeout(1500) });
    const body = await response.text();
    if (!response.ok || (expectedText && !body.includes(expectedText))) {
      throw new Error(`HTTP ${response.status}`);
    }
  }, url);
}

async function main() {
  const preflight = spawnSync(process.execPath, ["scripts/preflight.js"], {
    cwd: projectRoot,
    stdio: "inherit",
  });
  if (preflight.status !== 0) process.exit(preflight.status || 1);

  try {
    await verifyLocalDeployment();
  } catch (initialError) {
    if (!bootstrap) {
      throw new Error(
        `A ready local deployment was not found (${initialError.message}). ` +
          "Run `npm run dev:bootstrap` for a one-command local chain, deployment, and application startup."
      );
    }
    try {
      await jsonRpc("eth_chainId");
    } catch {
      console.log("[Launcher] Starting a managed local Hardhat chain...");
      startService("Chain", "contracts", ["run", "node"]);
      await waitFor(() => jsonRpc("eth_chainId"), "Local Hardhat chain");
    }
    console.log("[Launcher] Preparing a clean local deployment...");
    const setup = spawnSync(process.execPath, [npmCli, "run", "setup:local"], {
      cwd: projectRoot,
      env: process.env,
      stdio: "inherit",
    });
    if (setup.status !== 0 || setup.error) {
      throw new Error(`Local setup failed${setup.error ? `: ${setup.error.message}` : ""}`);
    }
    await verifyLocalDeployment();
  }
  console.log("[Launcher] Reusing the verified local deployment on port 8545.");

  console.log("[Launcher] Chain is ready. Starting application services...");
  startService("Backend", "backEnd", ["run", "dev"]);
  startService("Frontend", "frontEnd", ["run", "dev"]);
  startService("Oracle 1", "oracle", ["run", "dev"]);
  startService("Oracle 2", "oracle", ["run", "dev:oracle2"]);
  const backendPort = readEnvValue("backEnd/.env", "PORT") || "5000";
  await Promise.all([
    waitForHttp(`http://127.0.0.1:${backendPort}/health`, "Backend is healthy"),
    waitForHttp("http://127.0.0.1:5173", "Block-Insure"),
  ]);
  console.log("[Launcher] Chain/deployment verified and application services are ready. Press Ctrl+C to stop them together.");
}

process.on("SIGINT", () => {
  console.log("\n[Launcher] Stopping all services...");
  stopAll("SIGINT");
  setTimeout(() => process.exit(0), 500);
});
process.on("SIGTERM", () => {
  stopAll("SIGTERM");
  setTimeout(() => process.exit(0), 500);
});

main().catch((error) => {
  console.error(`[Launcher] ${error.message}`);
  stopAll();
  process.exitCode = 1;
});
