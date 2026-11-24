const { test, expect } = require("@playwright/test");
const { Contract, parseEther } = require("../../backEnd/node_modules/ethers");
const { createActorContext, closeActor } = require("../support/walletBridge");
const { loginActor, localDateTimeValue, requestReadyOracleVerification, syntheticPdfEvidenceFile } = require("../support/actions");
const { prepareEpisode, selectEpisode } = require("../support/intakeEpisode");
const { getE2EConfig, requireDisposableE2EMongoUri } = require("../support/environment");
const { collectWorkerReceipts, proveServiceReceipt } = require("../../scripts/paired/serviceReceipts");
const { readManifest } = require("../../scripts/paired/manifest");
const liveRouting = require("../../deploy/paired-v6-live-routing.json");

test("@workflow insurer association correction routes the paired claim to manual review", async ({ browser }, testInfo) => {
  test.skip(process.env.E2E_PAIRED_ROUTE_PREFLIGHT !== "true", "Requires an isolated deployment with paired terms");
  test.setTimeout(420_000);
  requireDisposableE2EMongoUri();
  const { apiUrl, rpcUrl } = getE2EConfig();
  for (const url of [apiUrl, rpcUrl]) expect(["localhost", "127.0.0.1"]).toContain(new URL(url).hostname);
  const user = await createActorContext(browser, "user");
  const admin = await createActorContext(browser, "admin");
  const { manifest: scenario, manifestHash } = readManifest(process.env.PAIRED_SCENARIO_FILE);
  expect(manifestHash).toBe(liveRouting.fixtureManifestSha256);
  const { manual: liveCase } = liveRouting;
  const spec = scenario.cases.manual;
  expect(liveCase.claimAmountEth).toBe(spec.grossEth);
  expect(liveCase.hospitalBillEth).toBe(liveCase.referenceBillEth);
  try {
    const provider = user.provider;
    expect(await provider.send("web3_clientVersion", [])).toMatch(/hardhat/i);
    const chainId = Number((await provider.getNetwork()).chainId);
    expect(chainId).toBe(Number(process.env.E2E_PAIRED_CHAIN_ID || 31337));
    const manager = new Contract(process.env.CONTRACT_ADDRESS, require("../../backEnd/abi/InsuranceManager.json").abi, provider);
    const coordinator = new Contract(await manager.oracleCoordinator(), require("../../oracle/abi/OracleCoordinator.json").abi, provider);
    const registry = new Contract(process.env.EVIDENCE_REGISTRY_ADDRESS, require("../../backEnd/abi/EvidenceRegistry.json").abi, provider);
    const offer = await manager.getPolicyPackage(1);
    expect(offer.premiumAmount).toBe(parseEther(scenario.deployment.premiumEth));
    expect(offer.coverageAmount).toBe(parseEther(scenario.deployment.coverageEth));
    expect(await provider.getBalance(manager.target)).toBe(parseEther(scenario.deployment.medicalReserveEth));

    await loginActor(user.page, user.actor);
    await user.page.goto("/user/policies/buy");
    const policyId = String(await manager.policyCounter());
    await user.page.getByRole("checkbox", { name: /I have read and agree/ }).first().check();
    await user.page.getByRole("button", { name: "Buy Policy" }).first().click();
    await expect(user.page.locator(".success-text")).toContainText("policy purchased successfully");
    const firstBlock = await provider.getBlockNumber();
    const episode = await prepareEpisode(user, { billAmount: liveCase.hospitalBillEth, treatmentType: spec.service,
      invoiceNumber: "PAIR-V6-MANUAL-ASSOCIATION", patientReference: "PAIRED-V6-SYNTHETIC-HOLDER", publishExplicitly: true });
    await user.page.goto("/user/claims/new");
    await user.page.getByLabel("Policy", { exact: true }).selectOption(policyId);
    await selectEpisode(user.page, episode.invoiceNumber);
    await expect(user.page.getByLabel("Claim amount in ETH")).toHaveValue(liveCase.claimAmountEth);
    const time = new Date(Number((await provider.getBlock("latest")).timestamp) * 1000);
    const incident = user.page.getByLabel("Incident date/time");
    await incident.evaluate((input) => input.setAttribute("step", "1"));
    await incident.fill(localDateTimeValue(time));
    await user.page.getByLabel("Claim document", { exact: true }).setInputFiles(syntheticPdfEvidenceFile());
    await user.page.getByRole("button", { name: "Submit Claim", exact: true }).click();
    const success = user.page.locator(".success-text");
    await expect(success).toContainText("encrypted evidence was reconciled successfully", { timeout: 120_000 });
    const claimId = (await success.textContent()).match(/Claim #(\d+)/)[1];

    await loginActor(admin.page, admin.actor);
    const originalRegistryVersion = await coordinator.currentRegistryVersion();
    await episode.revoke(admin);
    const correctedRegistryVersion = await coordinator.currentRegistryVersion();
    expect(correctedRegistryVersion).toBeGreaterThan(originalRegistryVersion);
    const token = await admin.page.evaluate(() => localStorage.getItem("blockinsure_jwt"));
    let treeHead;
    let localConfirmationBlocks = 0;
    await expect.poll(async () => {
      const response = await admin.page.request.post(apiUrl + "/api/evidence-log/tree-heads/anchor", {
        headers: { Authorization: `Bearer ${token}` }, timeout: 20_000,
      });
      expect(response.status()).toBe(200);
      ({ treeHead } = await response.json());
      if (chainId === 11155111 && !treeHead.anchorTransactionHash && localConfirmationBlocks === 0) {
        await provider.send("hardhat_mine", ["0xc", "0x1"]);
        localConfirmationBlocks = 12;
      }
      return treeHead.anchorTransactionHash;
    }, { timeout: 90_000, intervals: [1000, 2500, 5000] }).toMatch(/^0x[\da-f]{64}$/i);
    const anchors = await registry.queryFilter(registry.filters.EvidenceTreeHeadAnchored(), firstBlock + 1);
    expect(anchors).not.toHaveLength(0);
    expect(anchors.at(-1).transactionHash).toBe(treeHead.anchorTransactionHash);
    const receipts = [];
    const signerUpdates = await registry.queryFilter(registry.filters.TreeHeadSignerUpdated(), firstBlock + 1);
    for (const log of signerUpdates) receipts.push(await proveServiceReceipt({
      provider, hash: log.transactionHash, contract: registry, signer: admin.wallet.address,
      eventName: "TreeHeadSignerUpdated", operationId: "evidence.tree-signer",
      matches: (args) => args.newSigner === log.args.newSigner,
    }));
    for (const log of anchors) receipts.push(await proveServiceReceipt({
      provider, hash: log.transactionHash, contract: registry, signer: admin.wallet.address,
      eventName: "EvidenceTreeHeadAnchored", operationId: "evidence.anchor-" + log.args.treeSize,
      matches: (args) => args.treeSize === log.args.treeSize && args.rootHash === log.args.rootHash,
    }));
    const publishEvents = await coordinator.queryFilter(coordinator.filters.RegistrySnapshotPublished(), firstBlock + 1);
    expect(publishEvents.map((log) => log.args.version)).toEqual([originalRegistryVersion, correctedRegistryVersion]);
    for (const log of publishEvents) receipts.push(await proveServiceReceipt({
      provider, hash: log.transactionHash, contract: coordinator, signer: admin.wallet.address,
      eventName: "RegistrySnapshotPublished", operationId: log.args.version === correctedRegistryVersion ? "manual.corrected-publish" :
        log.args.version === originalRegistryVersion ? "manual.publish" : "registry.publish-" + log.args.version,
      matches: (args) => args.version === log.args.version && args.root === log.args.root,
    }));

    await admin.page.goto("/admin/claims/" + claimId);
    await requestReadyOracleVerification(admin.page, claimId);
    const claim = await manager.getClaim(claimId);
    expect(claim.claimAmount).toBe(parseEther(liveCase.claimAmountEth));
    const requestId = await coordinator.requestByClaimId(claimId);
    const request = await coordinator.getRequest(requestId);
    expect(request.claimId).toBe(BigInt(claimId));
    expect(request.modelVersion).toBe(scenario.deployment.modelIdentity);
    expect(request.registryVersion).toBe(correctedRegistryVersion);
    await expect.poll(async () => Number(await coordinator.revealCount(requestId)), { timeout: 120_000 }).toBe(2);
    const health = await Promise.all(process.env.ORACLE_READY_URLS.split(",").map(async (url) =>
      (await fetch(url + "/health/ready", { signal: AbortSignal.timeout(5000) })).json()));
    for (const [index, worker] of health.entries()) {
      expect(worker.oracleInstanceId).toBe(String(index + 1));
      expect(worker.protocolModel.identity).toBe(request.modelVersion);
    }
    receipts.push(...await collectWorkerReceipts({ provider, coordinator, requestId,
      requestBlock: Number(request.requestBlock), workers: health.map((item) => item.oracleWallet), scope: "manual" }));
    const finalized = await coordinator.getRequest(requestId);
    const status = Number((await manager.getClaim(claimId)).status);
    expect(finalized.isFulfilled).toBe(true);
    expect(status).toBe(finalized.verifiedResult ? 7 : 5);
    const route = finalized.verifiedResult ? "AUTO" : "REVIEW";
    let workerDecisions;
    await expect.poll(async () => {
      const response = await admin.page.request.get(apiUrl + "/api/oracle/results/" + claimId, {
        headers: { Authorization: `Bearer ${token}` }, timeout: 15_000,
      });
      if (!response.ok()) return 0;
      const { logs } = await response.json();
      workerDecisions = logs.filter((item) => item.requestId === String(requestId)).map((item) => {
        const { verificationCode, authority, score } = item.responseData.assessment;
        return { instance: item.oracleInstanceId, transactionHash: item.submittedTxHash, verificationCode,
          authority, scoreUnits: score == null ? null : Math.round(score * 1e9), verified: item.verified };
      });
      return workerDecisions.length;
    }, { timeout: 60_000 }).toBe(2);
    expect(workerDecisions.map(({ transactionHash }) => transactionHash).sort())
      .toEqual(receipts.filter(({ operationId }) => operationId.startsWith("manual.reveal")).map(({ transactionHash }) => transactionHash).sort());
    expect(workerDecisions.every((decision) => decision.verified === (route === "AUTO"))).toBe(true);
    for (const decision of workerDecisions) {
      expect(decision.scoreUnits).toBe(liveCase.scoreUnits);
      expect(decision.verificationCode.startsWith(liveCase.workerCodePrefix)).toBe(true);
    }
    await testInfo.attach("live-routing-evidence", {
      body: JSON.stringify({ chainId, localConfirmationBlocks, grossEth: liveCase.claimAmountEth,
        hospitalExpectedBillEth: liveCase.referenceBillEth, correction: liveCase.case,
        expectedRoute: liveCase.route, observedRoute: route, modelIdentity: request.modelVersion,
        claimId, originalRegistryVersion: String(originalRegistryVersion), registryVersion: String(request.registryVersion),
        registryRoot: request.registryRoot, workerDecisions, receipts }, null, 2),
      contentType: "application/json",
    });
    expect(route).toBe(liveCase.route);
  } finally {
    await closeActor(admin);
    await closeActor(user);
  }
});
