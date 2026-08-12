const { spawn, spawnSync } = require("node:child_process");
const net = require("node:net");
const path = require("node:path");
const readline = require("node:readline");
const { writeEvent } = require("./observability");

const projectRoot = path.resolve(__dirname, "..");
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const children = [];

function prefixStream(stream, label, output) {
  const reader = readline.createInterface({ input: stream });
  reader.on("line", (line) => {
    writeEvent(label, "info", line);
    output.write(`[${label}] ${line}\n`);
  });
}

function startService(label, directory, args) {
  const child = spawn(npmCommand, args, {
    cwd: path.join(projectRoot, directory),
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });

  prefixStream(child.stdout, label, process.stdout);
  prefixStream(child.stderr, label, process.stderr);
  child.on("exit", (code, signal) => {
    if (code && code !== 0) {
      writeEvent(label, "error", `exited with code ${code}`);
      console.error(`[Launcher] ${label} exited with code ${code}.`);
    } else if (signal) {
      writeEvent(label, "warn", `stopped (${signal})`);
      console.log(`[Launcher] ${label} stopped (${signal}).`);
    }
  });
  children.push(child);
  return child;
}

function waitForPort(port, timeoutMs = 30_000) {
  const startedAt = Date.now();

  return new Promise((resolve, reject) => {
    const probe = () => {
      const socket = net.createConnection({ host: "127.0.0.1", port });
      socket.once("connect", () => {
        socket.destroy();
        resolve();
      });
      socket.once("error", () => {
        socket.destroy();
        if (Date.now() - startedAt >= timeoutMs) {
          reject(new Error(`Port ${port} did not become ready within ${timeoutMs}ms`));
          return;
        }
        setTimeout(probe, 400);
      });
    };

    probe();
  });
}

function stopAll(signal = "SIGTERM") {
  for (const child of children) {
    if (!child.killed) child.kill(signal);
  }
}

async function main() {
  const preflight = spawnSync(process.execPath, ["scripts/preflight.js"], {
    cwd: projectRoot,
    stdio: "inherit",
  });
  if (preflight.status !== 0) process.exit(preflight.status || 1);

  console.log("[Launcher] Starting local Hardhat chain...");
  startService("Chain", "contracts", ["run", "node"]);
  await waitForPort(8545);

  console.log("[Launcher] Chain is ready. Starting application services...");
  startService("Backend", "backEnd", ["run", "dev"]);
  startService("Frontend", "frontEnd", ["run", "dev"]);
  startService("Oracle 1", "oracle", ["run", "dev"]);
  startService("Oracle 2", "oracle", ["run", "dev:oracle2"]);
  console.log("[Launcher] All processes started. Press Ctrl+C to stop them together.");
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
