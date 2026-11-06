const { spawn, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const readline = require("node:readline");
const { writeEvent } = require("./observability");
const { readLocalDeployment } = require("./localDeploymentConfig");

const projectRoot = path.resolve(__dirname, "..");
const npmCli = process.env.npm_execpath || path.join(
  path.dirname(process.execPath),
  "node_modules",
  "npm",
  "bin",
  "npm-cli.js"
);
const children = [];
const hybrid = process.argv.includes("--hybrid");
const reset = process.argv.includes("--reset");
let shuttingDown = false;

function prefixStream(stream, label, output) {
  const reader = readline.createInterface({ input: stream });
  reader.on("line", (line) => {
    const sanitizedLine = /private\s+key|seed\s+phrase|mnemonic/i.test(line)
      ? "[REDACTED SENSITIVE STARTUP OUTPUT]"
      : line;
    writeEvent(label, "info", sanitizedLine);
    output.write(`[${label}] ${sanitizedLine}\n`);
  });
}

function startService(label, directory, args, environment = process.env) {
  const child = spawn(process.execPath, [npmCli, ...args], {
    cwd: path.join(projectRoot, directory),
    env: environment,
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

function runCommand(directory, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [npmCli, ...args], {
      cwd: path.join(projectRoot, directory),
      env: process.env,
      stdio: "inherit",
      windowsHide: true,
    });
    children.push(child);

    let spawnError;
    child.once("error", (error) => {
      spawnError = error;
    });
    child.once("close", (code, signal) => {
      const childIndex = children.indexOf(child);
      if (childIndex >= 0) children.splice(childIndex, 1);
      if (spawnError) reject(spawnError);
      else if (code === 0) resolve();
      else reject(new Error(`Command exited with ${signal || `code ${code}`}`));
    });
  });
}

function readEnvValue(relativePath, key) {
  if (process.env[key]) return process.env[key];
  const generated = readLocalDeployment(projectRoot);
  if (generated[key]) return generated[key];
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
  const { Interface } = require("../backEnd/node_modules/ethers");
  const abi = new Interface(["function oracleModelVersion() view returns (bytes32)"]);
  const identity = await jsonRpc("eth_call", [{ to: managerAddress, data: abi.encodeFunctionData("oracleModelVersion") }, "latest"]);
  const protocol = require("../oracle/runtimeProtocol");
  if (String(identity).toLowerCase() !== protocol.loadProtocolArtifact().modelIdentityHash.toLowerCase()) {
    // A valid historical deployment can resume without silently publishing a
    // new model. Unknown identities still fail closed.
    let historical;
    try { historical = protocol.resolveRequestModel(identity); }
    catch { throw new Error("The running chain uses a different model identity. No configuration was changed."); }
    console.warn(`[Launcher] Existing deployment uses ${historical.artifact.modelVersion}; explicit protocol migration is required for the new appeal proof. No configuration was changed.`);
    return;
  }
}

function stopAll(signal = "SIGTERM") {
  shuttingDown = true;
  for (const child of children) {
    if (child.exitCode !== null || child.killed) continue;
    if (process.platform === "win32") {
      spawnSync("taskkill", ["/pid", String(child.pid), "/t", "/f"], { windowsHide: true, stdio: "ignore" });
    } else child.kill(signal);
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
    if (!reset) {
      throw new Error(
        `A ready local deployment was not found (${initialError.message}). ` +
          "Start the existing chain with `npm run dev:chain`. Hardhat state is in-memory; if it was lost, use `npm run dev:bootstrap` for an explicit destructive reset of a disposable database."
      );
    }
    try {
      await jsonRpc("eth_chainId");
    } catch {
      console.log("[Launcher] Starting a managed local Hardhat chain...");
      startService("Chain", "contracts", ["run", "node"]);
      await waitFor(() => jsonRpc("eth_chainId"), "Local Hardhat chain");
    }
  }

  if (reset) {
    try {
      await jsonRpc("eth_chainId");
    } catch {
      console.log("[Launcher] Starting a managed local Hardhat chain...");
      startService("Chain", "contracts", ["run", "node"]);
      await waitFor(() => jsonRpc("eth_chainId"), "Local Hardhat chain");
    }
    const setupCommand = hybrid ? "setup:hybrid" : "setup:local";
    console.log(
      hybrid
        ? "[Launcher] Preparing a clean hybrid-registry deployment..."
        : "[Launcher] Preparing a clean local deployment..."
    );
    try {
      await runCommand(".", ["run", setupCommand]);
    } catch (error) {
      throw new Error(`Local setup failed: ${error.message}`);
    }
    await verifyLocalDeployment();
  }
  console.log("[Launcher] Reusing the verified local deployment on port 8545.");

  // Load generated addresses once for all child processes. Explicit isolated
  // test overrides take precedence; secrets remain in their existing stores.
  const localConfig = readLocalDeployment(projectRoot);
  for (const [key, value] of Object.entries(localConfig)) process.env[key] ??= value;

  console.log("[Launcher] Chain is ready. Starting application services...");
  const backendRpcUrl = process.env.E2E_BACKEND_RPC_URL;
  if (backendRpcUrl) {
    const parsedProxy = new URL(backendRpcUrl);
    if (!["127.0.0.1", "localhost", "::1"].includes(parsedProxy.hostname)) {
      throw new Error("E2E_BACKEND_RPC_URL must be loopback-only");
    }
    startService("RPC Proxy", ".", ["run", "dev:rpc-proxy"]);
    await waitForHttp(`${backendRpcUrl}/__control/status`, '"paused":false');
  }
  startService("Backend", "backEnd", ["start"], {
    ...process.env,
    ...(backendRpcUrl ? { RPC_URL: backendRpcUrl } : {}),
  });
  startService("Frontend", "frontEnd", ["run", "dev"]);
  const backendPort = readEnvValue("backEnd/.env", "PORT") || "5000";
  // Backend-backed cursors are loaded during Oracle initialization. Starting
  // workers before the API listens can consume their entire readiness window
  // waiting for the first retry, even though the API becomes healthy promptly.
  await waitForHttp(`http://127.0.0.1:${backendPort}/health/ready`, '"status":"ready"');
  startService("Oracle 1", "oracle", ["run", "dev"], { ...process.env,
    PORT: process.env.ORACLE_ONE_HEALTH_PORT || "5101", ORACLE_INSTANCE_ID: "1", ORACLE_REGISTRY_SNAPSHOT: "primary" });
  startService("Oracle 2", "oracle", ["run", "dev:oracle2"], { ...process.env,
    PORT: process.env.ORACLE_TWO_HEALTH_PORT || "5102", ORACLE_INSTANCE_ID: "2", ORACLE_REGISTRY_SNAPSHOT: "oracle2" });
  await Promise.all([
    waitForHttp(
      `http://127.0.0.1:${backendPort}/health/ready`,
      '"status":"ready"'
    ),
    waitForHttp("http://localhost:5173", "Block-Insure"),
    waitForHttp(`http://127.0.0.1:${process.env.ORACLE_ONE_HEALTH_PORT || "5101"}/health/ready`, '"workerEnabled":true'),
    waitForHttp(`http://127.0.0.1:${process.env.ORACLE_TWO_HEALTH_PORT || "5102"}/health/ready`, '"workerEnabled":true'),
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
