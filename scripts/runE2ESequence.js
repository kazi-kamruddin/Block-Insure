const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const npmCli = process.env.npm_execpath || path.join(
  path.dirname(process.execPath),
  "node_modules",
  "npm",
  "bin",
  "npm-cli.js"
);
const resultPath = path.join(
  projectRoot,
  "verification-results",
  "playwright-e2e-run-results.json"
);
const suites = [
  { name: "general", script: "test:e2e" },
  { name: "workflow", script: "test:e2e:workflow" },
  { name: "showcase", script: "test:e2e:showcase" },
  { name: "maintenance", script: "test:e2e:maintenance" },
  { name: "resilience", script: "test:e2e:resilience" },
];

function runSuite({ name, script }) {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const reportDirectory = path.join("playwright-reports", name);
    const child = spawn(process.execPath, [npmCli, "run", script], {
      cwd: projectRoot,
      env: {
        ...process.env,
        PLAYWRIGHT_HTML_OUTPUT_DIR: reportDirectory,
      },
      stdio: "inherit",
      windowsHide: true,
    });

    let settled = false;
    child.once("error", (error) => {
      settled = true;
      resolve({
        suite: name,
        script,
        result: "FAIL",
        durationMs: Date.now() - startedAt,
        reportDirectory,
        failureCategory: "LAUNCH_ERROR",
        error: error.message,
      });
    });
    child.once("exit", (code, signal) => {
      if (settled) return;
      resolve({
        suite: name,
        script,
        result: code === 0 && !signal ? "PASS" : "FAIL",
        durationMs: Date.now() - startedAt,
        reportDirectory,
        failureCategory: code === 0 && !signal ? null : "TEST_FAILURE",
        exitCode: code,
        signal: signal || null,
      });
    });
  });
}

async function main() {
  const results = [];
  for (const suite of suites) {
    const result = await runSuite(suite);
    results.push(result);
    if (result.result !== "PASS") break;
  }

  fs.mkdirSync(path.dirname(resultPath), { recursive: true });
  fs.writeFileSync(
    resultPath,
    `${JSON.stringify({ generatedAt: new Date().toISOString(), results }, null, 2)}\n`
  );

  if (results.length !== suites.length || results.some((entry) => entry.result !== "PASS")) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(`[E2E sequence] ${error.message}`);
  process.exitCode = 1;
});
