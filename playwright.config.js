const { defineConfig } = require("@playwright/test");
const { getE2EConfig } = require("./e2e/support/environment");

const environment = getE2EConfig();

module.exports = defineConfig({
  testDir: "./e2e/tests",
  testIgnore: "frontend-production-quality.spec.js",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: environment.scenarioTimeoutMs,
  expect: {
    timeout: environment.actionTimeoutMs,
  },
  reporter: [
    ["list"],
    [
      "html",
      {
        outputFolder: process.env.PLAYWRIGHT_HTML_OUTPUT_DIR || "playwright-report",
        open: "never",
      },
    ],
  ],
  outputDir: "test-results",
  use: {
    baseURL: environment.appUrl,
    actionTimeout: environment.actionTimeoutMs,
    navigationTimeout: environment.actionTimeoutMs,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    headless: process.env.E2E_HEADED !== "true",
  },
});
