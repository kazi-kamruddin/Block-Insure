const fs = require("fs");
const { defineConfig } = require("@playwright/test");

function getChromiumExecutable() {
  if (process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH) {
    return process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
  }
  const localCandidates = [
    "E:\\coding projects\\Playwright\\ms-playwright\\chromium-1243\\chrome-win64\\chrome.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  ];
  for (const candidate of localCandidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

module.exports = defineConfig({
  testDir: "./e2e/tests",
  testMatch: "frontend-production-quality.spec.js",
  workers: 1,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [
    ["list"],
    ["html", { outputFolder: "playwright-report-frontend", open: "never" }],
  ],
  outputDir: "test-results/frontend-production",
  webServer: {
    command: "npm --prefix frontEnd run preview -- --host 127.0.0.1 --port 4173 --strictPort",
    url: "http://127.0.0.1:4173",
    reuseExistingServer: false,
    timeout: 30_000,
  },
  use: {
    baseURL: "http://127.0.0.1:4173",
    headless: process.env.E2E_HEADED !== "true",
    launchOptions: {
      executablePath: getChromiumExecutable(),
    },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
});
