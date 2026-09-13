const { test, expect } = require("@playwright/test");
const fs = require("node:fs");
const mongoose = require("../../backEnd/node_modules/mongoose");
const {
  localDateTimeValue,
  loginActor,
  uniqueEvidenceFile,
} = require("../support/actions");
const { closeActor, createActorContext } = require("../support/walletBridge");

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
    try {
      await loginActor(session.page, session.actor);

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
      await session.page.getByLabel("Claim document").setInputFiles(uniqueEvidenceFile());

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

      await verifyClaimAsHospital(browser, claimId, "VERIFIED");

      const adminSession = await createActorContext(browser, "admin");
      try {
        await loginActor(adminSession.page, adminSession.actor);
        await adminSession.page.goto(`/admin/claims/${claimId}`);
        await expect(
          adminSession.page.getByRole("heading", { name: "Admin Claim Detail" })
        ).toBeVisible();

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
    } finally {
      await closeActor(session);
    }
  });

  test("Oracle failure is resolved by assigned auditor consensus and settled", async ({ browser }) => {
    test.setTimeout(180_000);
    const session = await createActorContext(browser, "user");
    try {
      await loginActor(session.page, session.actor);
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
        const downloadPromise = auditorEvidenceSession.page.waitForEvent("download");
        await delegatedEvidence.getByRole("button", { name: "Download decrypted" }).click();
        const download = await downloadPromise;
        expect(fs.readFileSync(await download.path())).toEqual(evidenceFile.buffer);

        const mongoUri = process.env.MONGODB_URI || "";
        const parsedMongo = new URL(mongoUri);
        expect(["127.0.0.1", "localhost", "::1"]).toContain(parsedMongo.hostname);
        expect(parsedMongo.pathname).toBe("/block_insure_e2e");
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
