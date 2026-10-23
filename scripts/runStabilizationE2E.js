const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const { MongoMemoryServer } = require("mongodb-memory-server");
const fs = require("node:fs");
const root = path.resolve(__dirname, "..");
let database, child;
async function stop() {
  if (child && child.exitCode === null) {
    if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(child.pid), "/t", "/f"], { windowsHide: true, stdio: "ignore" });
    else child.kill("SIGTERM");
  }
  await database?.stop();
}
async function main() {
  database = await MongoMemoryServer.create({ binary: { downloadDir: path.join(root, "node_modules/.cache/mongodb-binaries") }, instance: { ip: "127.0.0.1" } });
  const browserCache = process.env.PLAYWRIGHT_BROWSERS_PATH;
  const cachedBrowsers = browserCache && fs.existsSync(browserCache)
    ? fs.readdirSync(browserCache).filter((entry) => /^chromium-\d+$/.test(entry)).sort().reverse()
      .flatMap((entry) => ["chrome-win64/chrome.exe", "chrome-win/chrome.exe", "chrome-linux64/chrome", "chrome-linux/chrome"].map((binary) => path.join(browserCache, entry, binary)))
    : [];
  const candidates = [process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH, require("@playwright/test").chromium.executablePath(), ...cachedBrowsers, "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"];
  const browser = candidates.find((candidate) => candidate && fs.existsSync(candidate));
  child = spawn(process.execPath, [path.join(root, "scripts/runIsolatedE2E.js"), "test:stabilization:stack", ...process.argv.slice(2)], {
    cwd: root, windowsHide: true, stdio: "inherit",
    env: { ...process.env, E2E_MONGODB_URI: database.getUri("block_insure_e2e"), E2E_REQUIRE_LOCAL_MONGO: "true", E2E_HEADED: "false", ...(browser ? { PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH: browser } : {}) },
  });
  await new Promise((resolve, reject) => { child.once("error", reject); child.once("close", (code) => code === 0 ? resolve() : reject(new Error(`Isolated E2E exited ${code}`))); });
}
process.once("SIGINT", () => stop().then(() => process.exit(130)));
process.once("SIGTERM", () => stop().then(() => process.exit(143)));
main().catch((error) => { console.error(error.message); process.exitCode = 1; }).finally(stop);
