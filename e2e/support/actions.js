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

function syntheticPdfEvidenceFile() {
  const text = `DEMO medical evidence ${Date.now()}`;
  const content = `BT /F1 18 Tf 50 700 Td (${text}) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`,
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => { offsets.push(Buffer.byteLength(pdf)); pdf += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return { name: `demo-evidence-${Date.now()}.pdf`, mimeType: "application/pdf", buffer: Buffer.from(pdf) };
}

module.exports = {
  localDateTimeValue,
  loginActor,
  resetLocalClaimSubmissionLimit,
  uniqueEvidenceFile,
  syntheticPdfEvidenceFile,
};
