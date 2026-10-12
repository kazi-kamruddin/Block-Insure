const { expect } = require("@playwright/test");

async function loginActor(page, actor) {
  await page.goto("/");
  await page.getByRole("button", { name: /connect wallet/i }).first().click();
  await expect(page).toHaveURL(new RegExp(`${actor.home.replaceAll("/", "\\/")}$`));
  await expect(page.locator(".wallet-role")).toHaveText(actor.role);
}

async function resetLocalClaimSubmissionLimit(page) {
  const apiBaseUrl = process.env.E2E_API_URL || "http://localhost:5000";
  const result = await page.evaluate(async (baseUrl) => {
    const token = localStorage.getItem("blockinsure_jwt");
    const response = await fetch(`${baseUrl}/api/claims/submission-limit/me`, {
      method: "DELETE",
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    return { ok: response.ok, status: response.status, body: await response.text() };
  }, apiBaseUrl);

  if (!result.ok) {
    throw new Error(
      `Could not reset the local E2E claim allowance (${result.status}): ${result.body}`
    );
  }
}

function uniqueEvidenceFile() {
  const onePixelPng = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    "base64"
  );
  const uniqueMarker = Buffer.from(`\nblock-insure-e2e:${Date.now()}:${Math.random()}`);

  return {
    name: `claim-evidence-${Date.now()}.png`,
    mimeType: "image/png",
    buffer: Buffer.concat([onePixelPng, uniqueMarker]),
  };
}

function localDateTimeValue(date = new Date()) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 19);
}

module.exports = {
  localDateTimeValue,
  loginActor,
  resetLocalClaimSubmissionLimit,
  uniqueEvidenceFile,
};
