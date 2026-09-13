const { test, expect } = require("@playwright/test");
const fs = require("node:fs");
const path = require("node:path");
const mongoose = require("../../backEnd/node_modules/mongoose");
const { Contract } = require("../../backEnd/node_modules/ethers");
const managerArtifact = require("../../contracts/artifacts/contracts/InsuranceManager.sol/InsuranceManager.json");
const adjudicatorArtifact = require("../../contracts/artifacts/contracts/ClaimAdjudicator.sol/ClaimAdjudicator.json");
const {
  localDateTimeValue,
  loginActor,
  uniqueEvidenceFile,
} = require("../support/actions");
const { closeActor, createActorContext } = require("../support/walletBridge");

function backendEnv(name) {
  const source = fs.readFileSync(path.resolve(__dirname, "../../backEnd/.env"), "utf8");
  const line = source.split(/\r?\n/).find((entry) => entry.startsWith(`${name}=`));
  return line?.slice(name.length + 1).trim() || "";
}

async function verifyMissingRecord(browser, claimId) {
  const hospital = await createActorContext(browser, "hospital");
  try {
    await loginActor(hospital.page, hospital.actor);
    await hospital.page.goto("/hospital/claims");
    await hospital.page.getByRole("button", { name: new RegExp(`Claim #${claimId}`) }).click();
    await expect(hospital.page.getByRole("heading", { name: "NOT FOUND" })).toBeVisible();
    await hospital.page.getByRole("button", { name: "Verify against hospital record" }).click();
    await expect(hospital.page.locator(".hospital-attestation-result")).toContainText(
      "On-chain hospital attestation:",
      { timeout: 60_000 }
    );
  } finally {
    await closeActor(hospital);
  }
}

async function verifyCorrectedAppealAsHospital(browser, claimId, correctedInvoice) {
  const hospital = await createActorContext(browser, "hospital");
  try {
    await loginActor(hospital.page, hospital.actor);
    await hospital.page.goto("/hospital/claims");
    await hospital.page.getByRole("button", { name: new RegExp(`Claim #${claimId}`) }).click();
    await expect(hospital.page.getByRole("heading", { name: "VERIFIED" })).toBeVisible();
    await expect(hospital.page.getByText(new RegExp(`Matched source invoice:\\s*${correctedInvoice}`))).toBeVisible();
    await hospital.page.getByRole("button", { name: "Verify against hospital record" }).click();
    await expect(hospital.page.locator(".hospital-attestation-result")).toContainText(
      "On-chain hospital attestation: VERIFIED",
      { timeout: 60_000 }
    );
  } finally {
    await closeActor(hospital);
  }
}

async function requestAppealOracleAsAdmin(browser, claimId) {
  const admin = await createActorContext(browser, "admin");
  try {
    await loginActor(admin.page, admin.actor);
    await admin.page.goto(`/admin/claims/${claimId}`);
    const status = admin.page.locator(".admin-claim-sidebar p strong").first();
    await expect(status).toHaveText("APPEALED");
    const requestButton = admin.page.getByRole("button", {
      name: "Request Oracle Verification",
    });
    await expect(requestButton).toBeEnabled();
    await requestButton.click();
    await expect(admin.page.locator(".success-text")).toHaveText(
      "Oracle verification requested successfully.",
      { timeout: 60_000 }
    );
  } finally {
    await closeActor(admin);
  }
}

async function createManualReview(browser) {
  const user = await createActorContext(browser, "user");
  await loginActor(user.page, user.actor);
  await user.page.goto("/user/policies/buy");
  await user.page.getByRole("checkbox", { name: /I have read and agree/ }).first().check();
  await user.page.getByRole("button", { name: "Buy Policy" }).first().click();
  await expect(user.page.locator(".success-text")).toContainText("policy purchased successfully");

  await user.page.goto("/user/claims/new");
  const resetLimit = user.page.getByRole("button", {
    name: "Reset My Local Testing Limit",
  });
  if (await resetLimit.isVisible().catch(() => false)) {
    await resetLimit.click();
    await expect(resetLimit).toBeHidden({ timeout: 30_000 });
  }
  const policy = user.page.getByLabel("Policy", { exact: true });
  await expect.poll(() => policy.locator("option").count()).toBeGreaterThan(1);
  await policy.selectOption({ index: (await policy.locator("option").count()) - 1 });
  await user.page.getByLabel("Test data preset").selectOption({
    label: "Valid HOSP-001 / HOSPITALIZATION / 0.1 ETH",
  });
  const correctedInvoice = await user.page.getByLabel("Invoice number").inputValue();
  expect(correctedInvoice).toBeTruthy();
  const block = await user.provider.getBlock("latest");
  const incident = user.page.getByLabel("Incident date/time");
  await incident.evaluate((input) => input.setAttribute("step", "1"));
  const incidentValue = localDateTimeValue(new Date(Number(block.timestamp) * 1000));
  await incident.fill(incidentValue.endsWith(":00") ? incidentValue.slice(0, -3) : incidentValue);
  await user.page.getByLabel("Invoice number").fill(`E2E-FINALITY-${Date.now()}`);
  await user.page.getByLabel("Claim document").setInputFiles(uniqueEvidenceFile());
  await user.page.getByRole("button", { name: "Submit Claim" }).click();
  if (
    await resetLimit
      .waitFor({ state: "visible", timeout: 3_000 })
      .then(() => true)
      .catch(() => false)
  ) {
    await resetLimit.click();
    await expect(resetLimit).toBeHidden({ timeout: 30_000 });
    await user.page.getByRole("button", { name: "Submit Claim" }).click();
  }
  const success = user.page.locator(".success-text");
  await expect(success).toContainText(
    "submitted and its encrypted evidence was reconciled successfully",
    { timeout: 120_000 }
  );
  const claimId = (await success.textContent())?.match(/Claim #(\d+)/)?.[1];
  expect(claimId).toBeTruthy();
  await verifyMissingRecord(browser, claimId);

  const admin = await createActorContext(browser, "admin");
  try {
    await loginActor(admin.page, admin.actor);
    await admin.page.goto(`/admin/claims/${claimId}`);
    const status = admin.page.locator(".admin-claim-sidebar p strong").first();
    await expect(status).toHaveText("DUPLICATE_CHECKED");
    await admin.page.getByRole("button", { name: "Request Oracle Verification" }).click();
    await expect
      .poll(async () => {
        await admin.page.getByRole("button", { name: "Refresh Claim" }).click();
        return (await status.textContent())?.trim();
      }, { timeout: 90_000, intervals: [1_000, 2_000, 3_000] })
      .toBe("ORACLE_FAILED");
    await admin.page.getByRole("button", { name: "Send to Manual Review" }).click();
    await expect(status).toHaveText("MANUAL_REVIEW");
  } finally {
    await closeActor(admin);
  }
  return { user, claimId, correctedInvoice };
}

async function contractsFor(session) {
  const manager = new Contract(
    backendEnv("VITE_CONTRACT_ADDRESS"),
    managerArtifact.abi,
    session.wallet
  );
  const adjudicator = new Contract(
    await manager.claimAdjudicator(),
    adjudicatorArtifact.abi,
    session.provider
  );
  return { manager, adjudicator };
}

test.describe("@unfinished manual-review finality", () => {
  test.describe.configure({ mode: "serial" });

  test("simultaneous rejection submissions fail safely and converge once", async ({ browser }) => {
    test.setTimeout(240_000);
    const { user, claimId } = await createManualReview(browser);
    const auditors = await Promise.all([
      createActorContext(browser, "auditor1"),
      createActorContext(browser, "auditor2"),
    ]);
    try {
      await Promise.all(auditors.map(({ page, actor }) => loginActor(page, actor)));
      await Promise.all(auditors.map(({ page }) => page.goto(`/auditor/vote/${claimId}`)));
      const buttons = auditors.map(({ page }) =>
        page.getByRole("button", { name: "Invalid Claim", exact: true })
      );
      await Promise.all(buttons.map((button) => expect(button).toBeEnabled()));
      await Promise.all(buttons.map((button) => button.click()));
      await Promise.all(
        auditors.map(({ page }) =>
          expect
            .poll(
              async () =>
                (await page
                  .getByText("Invalid Claim vote recorded on-chain.", { exact: true })
                  .count()) + (await page.locator(".error-text").count()),
              { timeout: 60_000 }
            )
            .toBeGreaterThan(0)
        )
      );
      const { manager, adjudicator } = await contractsFor(user);
      const version = await manager.claimVersion(claimId);
      let review = await adjudicator.getReview(claimId, version);
      if (Number(review.rejections) === 1) {
        let retryPage = auditors[1].page;
        for (const { page } of auditors) {
          if (
            (await page
              .getByText("Invalid Claim vote recorded on-chain.", { exact: true })
              .count()) === 0
          ) {
            retryPage = page;
          }
        }
        await retryPage.getByRole("button", { name: "Invalid Claim", exact: true }).click();
        await expect(
          retryPage.getByText("Invalid Claim vote recorded on-chain.", { exact: true })
        ).toBeVisible({ timeout: 60_000 });
        review = await adjudicator.getReview(claimId, version);
      }
      expect(review.finalized).toBe(true);
      expect(Number(review.rejections)).toBe(2);
      expect(Number((await manager.getClaim(claimId)).status)).toBe(8);

      const postFinal = await createActorContext(browser, "auditor3");
      try {
        await loginActor(postFinal.page, postFinal.actor);
        await postFinal.page.goto(`/auditor/vote/${claimId}`);
        await expect(postFinal.page.locator(".status-badge").filter({ hasText: "REJECTED" })).toBeVisible();
        await expect(
          postFinal.page.getByRole("button", { name: "Invalid Claim", exact: true })
        ).toBeDisabled();
      } finally {
        await closeActor(postFinal);
      }
    } finally {
      await Promise.all(auditors.map(closeActor));
      await closeActor(user);
    }
  });

  test("expired review rejects for insufficient quorum", async ({ browser }) => {
    test.setTimeout(240_000);
    const { user, claimId } = await createManualReview(browser);
    try {
      const { manager, adjudicator } = await contractsFor(user);
      const version = await manager.claimVersion(claimId);
      const review = await adjudicator.getReview(claimId, version);
      await user.provider.send("evm_setNextBlockTimestamp", [Number(review.deadline) + 1]);
      await user.provider.send("evm_mine", []);
      const receipt = await (await manager.finalizeExpiredManualReview(claimId)).wait();
      expect(receipt.status).toBe(1);
      expect(Number((await manager.getClaim(claimId)).status)).toBe(8);
      const finalized = await adjudicator.getReview(claimId, version);
      expect(finalized.finalized).toBe(true);
      expect(finalized.approved).toBe(false);
      await user.page.goto(`/user/claims/${claimId}`);
      await expect(user.page.locator(".status-badge").filter({ hasText: "REJECTED" })).toBeVisible();
    } finally {
      await closeActor(user);
    }
  });

  test("rejected claim completes an encrypted corrected appeal through both Oracles and settlement", async ({ browser }) => {
    test.setTimeout(300_000);
    const { user, claimId, correctedInvoice } = await createManualReview(browser);
    try {
      for (const actorName of ["auditor1", "auditor2"]) {
        const auditor = await createActorContext(browser, actorName);
        try {
          await loginActor(auditor.page, auditor.actor);
          await auditor.page.goto(`/auditor/vote/${claimId}`);
          const rejectButton = auditor.page.getByRole("button", {
            name: "Invalid Claim",
            exact: true,
          });
          await expect(rejectButton).toBeEnabled();
          await rejectButton.click();
          await expect(
            auditor.page.getByText("Invalid Claim vote recorded on-chain.", { exact: true })
          ).toBeVisible({ timeout: 60_000 });
        } finally {
          await closeActor(auditor);
        }
      }

      await user.page.goto(`/user/claims/${claimId}`);
      await expect(user.page.locator(".status-badge").filter({ hasText: "REJECTED" })).toBeVisible();
      const appealReason = `Corrected registry invoice for appeal ${claimId}`;
      await user.page.getByLabel("Appeal category").selectOption("DOCUMENT_ERROR");
      await user.page.getByLabel("Appeal reason").fill(appealReason);
      await user.page
        .getByLabel("Appeal description")
        .fill("The original invoice reference was mistyped; evaluate the corrected committed record.");
      await user.page.getByLabel("Additional document").setInputFiles(uniqueEvidenceFile());
      await user.page.getByLabel("Correct invoice number").fill(correctedInvoice);
      await user.page.getByRole("button", { name: "Appeal This Decision" }).click();
      await expect(user.page.locator(".success-text")).toContainText(
        "Appeal submitted successfully",
        { timeout: 120_000 }
      );
      await expect(user.page.locator(".appeal-status")).toContainText(appealReason);
      await expect(user.page.locator(".status-badge").filter({ hasText: "APPEALED" })).toBeVisible();

      await verifyCorrectedAppealAsHospital(browser, claimId, correctedInvoice);
      await requestAppealOracleAsAdmin(browser, claimId);

      await expect
        .poll(
          async () => {
            await user.page.getByRole("button", { name: "Refresh Claim" }).click();
            const status = user.page.locator(".status-badge").first();
            return (await status.textContent())?.trim();
          },
          {
            message: "Both Oracle workers should approve the corrected appeal",
            timeout: 120_000,
            intervals: [1_000, 2_000, 3_000],
          }
        )
        .toContain("PAYOUT_READY");
      await expect(user.page.locator(".appeal-pill")).toHaveText("APPROVED");

      const { manager, adjudicator } = await contractsFor(user);
      const version = await manager.claimVersion(claimId);
      expect(version).toBe(2n);
      expect(Number((await manager.getClaim(claimId)).status)).toBe(7);
      const appealDecision = await adjudicator.getDecision(claimId, version);
      expect(await adjudicator.appealFinalized(claimId)).toBe(true);
      expect(appealDecision.approved).toBe(true);
      const documents = await manager.getClaimDocuments(claimId);
      expect(documents).toHaveLength(2);

      const mongoUri = process.env.MONGODB_URI || "";
      const parsedMongo = new URL(mongoUri);
      expect(["127.0.0.1", "localhost", "::1"]).toContain(parsedMongo.hostname);
      expect(parsedMongo.pathname).toBe("/block_insure_e2e");
      const mongo = await mongoose.createConnection(mongoUri).asPromise();
      let appeal;
      try {
        appeal = await mongo.db.collection("appeals").findOne({ claimId: String(claimId) });
        expect(appeal).toMatchObject({
          status: "APPROVED",
          appealReason,
          reasonCategory: "DOCUMENT_ERROR",
          proposedInvoiceNumber: correctedInvoice,
        });
        expect(appeal.additionalDocumentCID).toBeTruthy();
        expect(appeal.additionalDocumentHash).toMatch(/^[a-f\d]{64}$/i);
        expect(appeal.transactionHash).toMatch(/^0x[a-f\d]{64}$/i);

        const evidence = await mongo.db.collection("files").findOne({
          claimId: String(claimId),
          claimVersion: 2,
          documentType: "APPEAL_DOCUMENT",
        });
        expect(evidence).toMatchObject({
          encrypted: true,
          ipfsCID: appeal.additionalDocumentCID,
          sha256Hash: appeal.additionalDocumentHash,
        });
        expect(evidence).not.toHaveProperty("aesKey");
        expect(evidence).not.toHaveProperty("plaintext");

        const oracleLogs = await mongo.db.collection("oraclelogs").find({
          claimId: String(claimId),
          "queryData.claimVersion": "2",
        }).toArray();
        expect(oracleLogs).toHaveLength(2);
        expect(oracleLogs.every((log) => log.verified === true)).toBe(true);
        expect(
          oracleLogs.every(
            (log) =>
              log.responseData?.hospitalVerification?.query?.source ===
              "PENDING_APPEAL_CORRECTION"
          )
        ).toBe(true);
      } finally {
        await mongo.close();
      }

      const appealReceipt = await user.provider.getTransactionReceipt(appeal.transactionHash);
      expect(appealReceipt?.status).toBe(1);
      const eventNames = appealReceipt.logs.flatMap((log) => {
        try {
          return [manager.interface.parseLog(log)?.name].filter(Boolean);
        } catch {
          return [];
        }
      });
      expect(eventNames).toEqual(expect.arrayContaining(["ClaimAppealed", "DocumentAdded"]));

      await user.page.getByRole("button", { name: "Withdraw Payment" }).click();
      await expect(user.page.locator(".status-badge").filter({ hasText: "SETTLED" })).toBeVisible({
        timeout: 60_000,
      });
      expect(Number((await manager.getClaim(claimId)).status)).toBe(9);
    } finally {
      await closeActor(user);
    }
  });
});
