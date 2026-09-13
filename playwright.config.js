const { defineConfig } = require("@playwright/test");
const { getE2EConfig } = require("./e2e/support/environment");

const environment = getE2EConfig();
const focusedReportFolders = {
  "test:e2e:unfinished:appeal": "playwright-reports/unfinished-appeal",
  "test:e2e:unfinished:rpc": "playwright-reports/unfinished-rpc",
};
const htmlReportFolder =
  process.env.PLAYWRIGHT_HTML_OUTPUT_DIR ||
  focusedReportFolders[process.env.npm_lifecycle_event] ||
  "playwright-report";

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
        outputFolder: htmlReportFolder,
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
