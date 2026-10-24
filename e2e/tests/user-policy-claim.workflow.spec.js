const { test, expect } = require("@playwright/test");
const fs = require("node:fs");
const mongoose = require("../../backEnd/node_modules/mongoose");
const pdfjsVersion = require("../../frontEnd/node_modules/pdfjs-dist/package.json").version;
const {
  localDateTimeValue,
  loginActor,
  resetLocalClaimSubmissionLimit,
  uniqueEvidenceFile,
  syntheticPdfEvidenceFile,
} = require("../support/actions");
const { closeActor, createActorContext } = require("../support/walletBridge");
const { requireDisposableE2EMongoUri } = require("../support/environment");

async function verifyClaimAsHospital(browser, claimId, expectedOutcome) {
  const hospitalSession = await createActorContext(browser, "hospital");
  try {
    await loginActor(hospitalSession.page, hospitalSession.actor);
    await hospitalSession.page.goto("/hospital/claims");
    await hospitalSession.page.getByRole("button", { name: new RegExp(`Claim #${claimId}`) }).click();
    await expect(hospitalSession.page.getByRole("heading", { name: expectedOutcome })).toBeVisible();
    await hospitalSession.page.getByRole("button", { name: "Verify against hospital record" }).click();
    const attestationResult = hospitalSession.page.locator(".hospital-attestation-result");
    await expect(attestationResult).toContainText("On-chain hospital attestation:", { timeout: 60_000 });
    await expect(attestationResult).toContainText(expectedOutcome);
  } finally {
    await closeActor(hospitalSession);
  }
}

test.describe("@workflow policyholder transaction journey", () => {
  test.describe.configure({ mode: "serial" });

  test("Policy purchase, encrypted claim, oracle adjudication, and payout settlement", async ({ browser }) => {
    const session = await createActorContext(browser, "user");
    const browserFailures = [];
    session.page.on("pageerror", (error) => browserFailures.push(error.message));
    session.page.on("console", (message) => {
      // The existing appeal-read API deliberately returns 404 for a claim with
      // no appeal. Assert/filter that one expected absence, never other failures.
      const expectedEmptyAppeal = /\/api\/appeals\/claim\/\d+$/.test(message.location().url || "") && /status of 404/.test(message.text());
      if (message.type() === "error" && !expectedEmptyAppeal) browserFailures.push(message.text());
    });
    try {
      await loginActor(session.page, session.actor);
      await resetLocalClaimSubmissionLimit(session.page);

      await session.page.goto("/user/policies/buy");
      await expect(session.page.getByRole("heading", { name: "Buy Policy" })).toBeVisible();
      await session.page.getByRole("checkbox", { name: /I have read and agree/ }).first().check();
      await session.page.getByRole("button", { name: "Buy Policy" }).first().click();
      await expect(session.page.locator(".success-text")).toContainText(
        "policy purchased successfully"
      );

      await session.page.goto("/user/policies");
      await expect(session.page.getByRole("heading", { name: "My Policies" })).toBeVisible();
      await expect(session.page.locator(".card-row .card").first()).toBeVisible();

      await session.page.goto("/user/claims/new");
      await expect(session.page.getByRole("heading", { name: "Submit Claim" })).toBeVisible();

      const policySelect = session.page.getByLabel("Policy", { exact: true });
      await expect
        .poll(() => policySelect.locator("option").count())
        .toBeGreaterThan(1);
      await policySelect.selectOption({ index: 1 });

      await session.page.getByLabel("Test data preset").selectOption({
        label: "Valid HOSP-001 / HOSPITALIZATION / 0.1 ETH",
      });
      const latestBlock = await session.provider.getBlock("latest");
      if (!latestBlock) throw new Error("Latest local block is unavailable");
      const incidentInput = session.page.getByLabel("Incident date/time");
      await incidentInput.evaluate((input) => input.setAttribute("step", "1"));
      await incidentInput.fill(localDateTimeValue(new Date(Number(latestBlock.timestamp) * 1000)));
      await session.page.getByRole("button", { name: "Check invoice readiness" }).click();
      await expect(session.page.getByRole("region", { name: "Invoice readiness" })).toContainText("Invoice binding found");
      await session.page.getByLabel("Claim document").setInputFiles(syntheticPdfEvidenceFile());

      await session.page.getByRole("button", { name: "Submit Claim" }).click();
      const successMessage = session.page.locator(".success-text");
      await expect(successMessage).toContainText(
        "submitted and its encrypted evidence was reconciled successfully",
        { timeout: 120_000 }
      );
      const claimId = (await successMessage.textContent())?.match(/Claim #(\d+)/)?.[1];
      expect(claimId, "The reconciled claim success message should include its claim ID").toBeTruthy();
      const uploadedDocument = session.page
        .getByRole("heading", { name: "Uploaded Document" })
        .locator("..");
      await expect(uploadedDocument).toBeVisible();
      await expect(uploadedDocument).toContainText("AES-256-GCM");
      const previewButton = uploadedDocument.getByRole("button", { name: "Preview decrypted" });
      await previewButton.click();
      const preview = session.page.getByRole("dialog", { name: "Decrypted evidence preview" });
      await expect(preview.getByText("Page 1 of 1", { exact: true })).toBeVisible();
      await expect(preview.getByRole("region", { name: "Evidence PDF" })).toHaveAttribute("data-pdfjs-version", pdfjsVersion);
      const pdfCanvas = preview.getByRole("img", { name: "Decrypted PDF page 1" });
      expect(await pdfCanvas.evaluate((canvas) => {
        const pixels = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
        for (let index = 0; index < pixels.length; index += 4) if (pixels[index + 3] && pixels[index] < 200) return true;
        return false;
      })).toBe(true);
      const desktopViewport = session.page.viewportSize();
      await session.page.setViewportSize({ width: 320, height: 800 });
      const bounds = await preview.boundingBox();
      expect(bounds.x).toBeGreaterThanOrEqual(0);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(320);
      await preview.getByText("Accessible PDF text", { exact: true }).click();
      await expect(preview).toContainText("DEMO medical evidence");
      await session.page.keyboard.press("Escape");
      await expect(preview).not.toBeVisible();
      await expect(previewButton).toBeFocused();
      // Delete only this actor's disposable browser identity, never shared keys.
      // Recovery must restore the exact existing public identity and PDF access.
      await session.page.evaluate(() => new Promise((resolve, reject) => {
        const open = indexedDB.open("block-insure-private-keys", 1);
        open.onsuccess = () => {
          const db = open.result, tx = db.transaction("evidence-identities", "readwrite");
          tx.objectStore("evidence-identities").clear();
          tx.oncomplete = () => { db.close(); resolve(); }; tx.onabort = () => reject(tx.error);
        }; open.onerror = () => reject(open.error);
      }));
      await session.page.goto("/user/profile");
      await session.page.getByRole("button", { name: "Check evidence recovery" }).click();
      await expect(session.page.getByText(/No identity in this browser.*Encrypted backup available/)).toBeVisible();
      await session.page.getByRole("button", { name: "Restore evidence access" }).click();
      await expect(session.page.getByText(/Browser identity present.*Encrypted backup available/)).toBeVisible();
      await session.page.goto(`/user/claims/${claimId}`);
      await session.page.getByRole("button", { name: "Preview decrypted", exact: true }).first().click();
      await expect(session.page.getByRole("dialog", { name: "Decrypted evidence preview" }).getByText("Page 1 of 1", { exact: true })).toBeVisible();
      await session.page.keyboard.press("Escape");
      await session.page.setViewportSize(desktopViewport);

      await verifyClaimAsHospital(browser, claimId, "VERIFIED");

      const adminSession = await createActorContext(browser, "admin");
      adminSession.page.on("pageerror", (error) => browserFailures.push(`admin: ${error.message}`));
      adminSession.page.on("console", (message) => {
        const expectedEmptyAppeal = /\/api\/appeals\/claim\/\d+$/.test(message.location().url || "") && /status of 404/.test(message.text());
        if (message.type() === "error" && !expectedEmptyAppeal) browserFailures.push(`admin: ${message.text()}`);
      });
      try {
        await loginActor(adminSession.page, adminSession.actor);
        await adminSession.page.goto(`/admin/claims/${claimId}`);
        await expect(
          adminSession.page.getByRole("heading", { name: "Admin Claim Detail" })
        ).toBeVisible();

        const advisoryPanel = adminSession.page.getByRole("region", { name: "XGBoost advisory assessment" });
        await expect(advisoryPanel.getByRole("heading", { name: "XGBoost · Primary advisory" })).toBeVisible();
        await expect(advisoryPanel.getByRole("heading", { name: "Bernoulli NB · Protocol comparison" })).toBeVisible();
        await expect(advisoryPanel.getByText(/warnings do not independently trigger review/)).toBeVisible();
        await advisoryPanel.getByText("Why this score? Exact SHAP explanation", { exact: true }).click();
        await expect(advisoryPanel.getByText(/Contributions add to the raw model margin/)).toBeVisible();
        await advisoryPanel.getByText("Assessment provenance and limitations", { exact: true }).click();
        await expect(advisoryPanel.getByText(/engineered billing-action labels/)).toBeVisible();
        const advisoryRead = () => adminSession.page.evaluate(async (id) => {
          const token = localStorage.getItem("blockinsure_jwt");
          const response = await fetch(`http://localhost:5000/api/claims/${id}/advisory`, { headers: { Authorization: `Bearer ${token}` } });
          return { status: response.status, body: await response.json() };
        }, claimId);
        const firstAdvisory = await advisoryRead();
        expect(firstAdvisory.status).toBe(200);
        expect(firstAdvisory.body.advisory.status).toBe("AVAILABLE");
        expect(firstAdvisory.body.advisory.primaryModel).toBe("XGBoost");
        expect(firstAdvisory.body.advisory.assessment.transactionCreated).toBe(false);
        expect(firstAdvisory.body.advisory.assessment.explanation.additivityError).toBeLessThan(0.0001);
        const advisoryUrl = `**/api/claims/${claimId}/advisory`;
        await adminSession.page.route(advisoryUrl, (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
          success: true, advisory: { status: "UNAVAILABLE", primaryModel: "XGBoost", reason: "SNAPSHOT_UNAVAILABLE", protocolEffect: "NONE" },
        }) }));
        await advisoryPanel.getByRole("button", { name: "Refresh advisory" }).click();
        await expect(advisoryPanel.getByRole("status")).toContainText("snapshot unavailable");
        await expect(advisoryPanel.getByRole("heading", { name: "XGBoost · Primary advisory" })).toHaveCount(0);
        await adminSession.page.unroute(advisoryUrl);
        const refreshed = adminSession.page.waitForResponse((response) => response.url().endsWith(`/api/claims/${claimId}/advisory`));
        await advisoryPanel.getByRole("button", { name: "Refresh advisory" }).click();
        expect((await (await refreshed).json()).advisory.assessmentId).toBe(firstAdvisory.body.advisory.assessmentId);
        await expect(advisoryPanel.getByRole("heading", { name: "XGBoost · Primary advisory" })).toBeVisible();
        const viewport = adminSession.page.viewportSize();
        await adminSession.page.setViewportSize({ width: 320, height: 800 });
        await expect(advisoryPanel).toBeVisible();
        expect(await adminSession.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
        await advisoryPanel.getByRole("button", { name: "Refresh advisory" }).focus();
        await expect(advisoryPanel.getByRole("button", { name: "Refresh advisory" })).toBeFocused();
        await adminSession.page.screenshot({ path: "test-results/xgboost-advisory-mobile.png", fullPage: true });
        await adminSession.page.setViewportSize(viewport);
        const userToken = await session.page.evaluate(() => localStorage.getItem("blockinsure_jwt"));
        const denied = await session.context.request.get(`http://localhost:5000/api/claims/${claimId}/advisory`, { headers: { Authorization: `Bearer ${userToken}` } });
        expect(denied.status()).toBe(403);

        const currentStatus = adminSession.page.locator(
          ".admin-claim-sidebar p strong"
        ).first();
        await expect(currentStatus).toHaveText("DUPLICATE_CHECKED");
        await adminSession.page
          .getByRole("button", { name: "Request Oracle Verification" })
          .click();
        await expect(adminSession.page.locator(".success-text")).toContainText(
          "Oracle verification requested successfully"
        );

        await expect
          .poll(
            async () => {
              await adminSession.page
                .getByRole("button", { name: "Refresh Claim" })
                .click();
              return (await currentStatus.textContent())?.trim();
            },
            {
              message: "The two oracle workers should approve the registered claim",
              timeout: 90_000,
              intervals: [1_000, 2_000, 3_000],
            }
          )
          .toBe("PAYOUT_READY");
        await expect.poll(async () => (await advisoryRead()).body.advisory?.workerShadow?.status,
          { timeout: 90000, intervals: [5000], message: "Both worker shadow computations must independently agree on the committed context" }).toBe("MATCHED");
        const finalAdvisory = (await advisoryRead()).body.advisory;
        expect(finalAdvisory.workerShadow.reports).toBe(2);
        expect(finalAdvisory.workerShadow.authority).toBe("SHADOW_ONLY");
        expect(finalAdvisory.performance.totalAssessmentMs).toBeGreaterThanOrEqual(finalAdvisory.performance.inferenceMs);
        expect(finalAdvisory.performance.rssBytes).toBeGreaterThan(0);
      } finally {
        await closeActor(adminSession);
      }

      await session.page.goto(`/user/claims/${claimId}`);
      const withdrawButton = session.page.getByRole("button", {
        name: "Withdraw Payment",
      });
      await expect(withdrawButton).toBeVisible();
      await withdrawButton.click();
      await expect(session.page.getByText("SETTLED", { exact: true })).toBeVisible();
      expect(browserFailures).toEqual([]);
    } finally {
      await closeActor(session);
    }
  });

  test("Oracle failure is resolved by assigned auditor consensus and settled", async ({ browser }) => {
    test.setTimeout(180_000);
    const session = await createActorContext(browser, "user");
    try {
      await loginActor(session.page, session.actor);
      await resetLocalClaimSubmissionLimit(session.page);
      await session.page.goto("/user/policies/buy");
      await session.page.getByRole("checkbox", { name: /I have read and agree/ }).first().check();
      await session.page.getByRole("button", { name: "Buy Policy" }).first().click();
      await expect(session.page.locator(".success-text")).toContainText(
        "policy purchased successfully"
      );

      await session.page.goto("/user/claims/new");
      const policySelect = session.page.getByLabel("Policy", { exact: true });
      await expect.poll(() => policySelect.locator("option").count()).toBeGreaterThan(1);
      const policyOptionCount = await policySelect.locator("option").count();
      await policySelect.selectOption({ index: policyOptionCount - 1 });

      const latestBlock = await session.provider.getBlock("latest");
      if (!latestBlock) throw new Error("Latest local block is unavailable");
      const incidentInput = session.page.getByLabel("Incident date/time");
      await incidentInput.evaluate((input) => input.setAttribute("step", "1"));
      await incidentInput.fill(localDateTimeValue(new Date(Number(latestBlock.timestamp) * 1000)));
      await session.page.getByLabel("Claim amount in ETH").fill("0.1");
      await session.page.getByLabel("Claim type").fill("HOSPITALIZATION");
      await session.page.getByLabel("Hospital ID").selectOption("HOSP-001");
      await session.page
        .getByLabel("Invoice number")
        .fill(`E2E-MANUAL-${Date.now()}`);
      await session.page.getByRole("button", { name: "Check invoice readiness" }).click();
      await expect(session.page.getByRole("region", { name: "Invoice readiness" })).toContainText("No invoice bound to this wallet was found");
      const evidenceFile = uniqueEvidenceFile();
      await session.page.getByLabel("Claim document").setInputFiles(evidenceFile);
      await session.page.getByRole("button", { name: "Submit Claim" }).click();

      const successMessage = session.page.locator(".success-text");
      await expect(successMessage).toContainText(
        "submitted and its encrypted evidence was reconciled successfully",
        { timeout: 120_000 }
      );
      const claimId = (await successMessage.textContent())?.match(/Claim #(\d+)/)?.[1];
      expect(claimId, "The manual-review claim should expose its claim ID").toBeTruthy();

      await verifyClaimAsHospital(browser, claimId, "NOT FOUND");

      const adminSession = await createActorContext(browser, "admin");
      try {
        await loginActor(adminSession.page, adminSession.actor);
        await adminSession.page.goto(`/admin/claims/${claimId}`);
        const currentStatus = adminSession.page
          .locator(".admin-claim-sidebar p strong")
          .first();
        await expect(currentStatus).toHaveText("DUPLICATE_CHECKED");
        await adminSession.page
          .getByRole("button", { name: "Request Oracle Verification" })
          .click();
        await expect
          .poll(
            async () => {
              await adminSession.page.getByRole("button", { name: "Refresh Claim" }).click();
              return (await currentStatus.textContent())?.trim();
            },
            { timeout: 90_000, intervals: [1_000, 2_000, 3_000] }
          )
          .toBe("ORACLE_FAILED");

        await adminSession.page
          .getByRole("button", { name: "Send to Manual Review" })
          .click();
        await expect(currentStatus).toHaveText("MANUAL_REVIEW");
      } finally {
        await closeActor(adminSession);
      }

      const auditorEvidenceSession = await createActorContext(browser, "auditor1", {
        acceptDownloads: true,
      });
      try {
        await loginActor(auditorEvidenceSession.page, auditorEvidenceSession.actor);
        await auditorEvidenceSession.page.goto("/auditor/votes");
        await auditorEvidenceSession.page
          .getByRole("button", { name: "Prepare encrypted evidence access" })
          .click();
        await expect(auditorEvidenceSession.page.locator(".app-toast")).toContainText(
          "evidence identity is ready",
          { timeout: 60_000 }
        );
        await auditorEvidenceSession.page.goto(`/auditor/claims/${claimId}/history`);
        const evidenceItem = auditorEvidenceSession.page.locator(".evidence-chain-item").first();
        await expect(evidenceItem).toBeVisible();
        await evidenceItem.getByRole("button", { name: "Download decrypted" }).click();
        await expect(evidenceItem.locator(".error-text")).toContainText(
          "No active cryptographic delegation exists"
        );

        await session.page.goto(`/user/claims/${claimId}`);
        const accessDetails = session.page
          .locator("details.technical-details")
          .filter({ has: session.page.getByText("Cryptographic auditor access", { exact: true }) })
          .first();
        await accessDetails.locator("summary").click();
        const auditorRow = accessDetails
          .locator(".evidence-access-row")
          .filter({ hasText: auditorEvidenceSession.wallet.address })
          .first();
        await expect(auditorRow).toBeVisible();
        await auditorRow.getByRole("button", { name: "Grant" }).click();
        await expect(session.page.locator(".app-toast")).toContainText("access delegated", {
          timeout: 60_000,
        });

        await auditorEvidenceSession.page.reload();
        const delegatedEvidence = auditorEvidenceSession.page.locator(".evidence-chain-item").first();
        await delegatedEvidence.getByRole("button", { name: "Preview decrypted", exact: true }).click();
        const preview = auditorEvidenceSession.page.getByRole("dialog", { name: "Decrypted evidence preview" });
        await expect(preview).toBeVisible();
        await auditorEvidenceSession.page.keyboard.press("Escape");
        await expect(preview).toBeHidden();
        const downloadPromise = auditorEvidenceSession.page.waitForEvent("download");
        await delegatedEvidence.getByRole("button", { name: "Download decrypted" }).click();
        const download = await downloadPromise;
        expect(fs.readFileSync(await download.path())).toEqual(evidenceFile.buffer);

        const mongoUri = requireDisposableE2EMongoUri();
        const mongo = await mongoose.createConnection(mongoUri).asPromise();
        try {
          const fileRecord = await mongo.db.collection("files").findOne({ claimId: String(claimId) });
          expect(fileRecord).toBeTruthy();
          expect(fileRecord).not.toHaveProperty("aesKey");
          expect(fileRecord).not.toHaveProperty("plaintext");
          const actions = await mongo.db
            .collection("evidenceaccesslogs")
            .distinct("action", { documentId: fileRecord._id });
          expect(actions).toEqual(expect.arrayContaining(["GRANT", "PROXY_TRANSFORM"]));
        } finally {
          await mongo.close();
        }

        await auditorRow.getByRole("button", { name: "Revoke" }).click();
        await expect(
          session.page.locator(".app-toast").filter({ hasText: "Access revoked" })
        ).toContainText("revoked", { timeout: 60_000 });
        await auditorEvidenceSession.page.reload();
        const revokedEvidence = auditorEvidenceSession.page.locator(".evidence-chain-item").first();
        await revokedEvidence.getByRole("button", { name: "Download decrypted" }).click();
        await expect(revokedEvidence.locator(".error-text")).toContainText(
          "No active cryptographic delegation exists"
        );
      } finally {
        await closeActor(auditorEvidenceSession);
      }

      for (const actorName of ["auditor1", "auditor2", "auditor3"]) {
        const auditorSession = await createActorContext(browser, actorName);
        try {
          await loginActor(auditorSession.page, auditorSession.actor);
          await auditorSession.page.goto(`/auditor/vote/${claimId}`);
          await expect(
            auditorSession.page.getByRole("heading", { name: "Auditor Vote" })
          ).toBeVisible();
          const validVoteButton = auditorSession.page.getByRole("button", {
            name: "Valid Claim",
            exact: true,
          });
          await expect(validVoteButton).toBeEnabled();
          await validVoteButton.click();
          await expect(auditorSession.page.locator(".success-text")).toContainText(
            "Valid Claim vote recorded on-chain"
          );
        } finally {
          await closeActor(auditorSession);
        }
      }

      await session.page.goto(`/user/claims/${claimId}`);
      const withdrawButton = session.page.getByRole("button", {
        name: "Withdraw Payment",
      });
      await expect(withdrawButton).toBeVisible();
      await withdrawButton.click();
      await expect(session.page.getByText("SETTLED", { exact: true })).toBeVisible();
    } finally {
      await closeActor(session);
    }
  });
});
