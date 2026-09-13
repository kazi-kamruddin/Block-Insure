const fs = require("node:fs");
const path = require("node:path");

const { test, expect } = require("@playwright/test");
const { Contract, NonceManager } = require("../../backEnd/node_modules/ethers");

const { loginActor } = require("../support/actions");
const { closeActor, createActorContext } = require("../support/walletBridge");

const projectRoot = path.resolve(__dirname, "../..");
const managerAbi = require("../../backEnd/abi/InsuranceManager.json").abi;
const benefitsAbi = require("../../contracts/artifacts/contracts/PolicyBenefitsManager.sol/PolicyBenefitsManager.json").abi;

function readEnvValue(relativePath, key) {
  const source = fs.readFileSync(path.join(projectRoot, relativePath), "utf8");
  const line = source.split(/\r?\n/).find((entry) => entry.startsWith(`${key}=`));
  if (!line) throw new Error(`${key} is not configured`);
  return line.slice(key.length + 1).trim();
}

function contracts(session) {
  return {
    manager: new Contract(readEnvValue("backEnd/.env", "VITE_CONTRACT_ADDRESS"), managerAbi, session.wallet),
    benefits: new Contract(readEnvValue("backEnd/.env", "POLICY_BENEFITS_ADDRESS"), benefitsAbi, session.wallet),
  };
}

async function purchaseFirstPackage(session) {
  const { manager } = contracts(session);
  const before = Number(await manager.policyCounter());
  await session.page.goto("/user/policies/buy");
  await session.page.getByRole("checkbox", { name: /I have read and agree/ }).first().check();
  await session.page.getByRole("button", { name: "Buy Policy" }).first().click();
  await expect(session.page.locator(".success-text")).toContainText("policy purchased successfully");
  await expect.poll(async () => Number(await manager.policyCounter())).toBe(before + 1);
  return String(before);
}

async function policyCard(session, policyId) {
  await session.page.goto("/user/policies");
  const card = session.page.locator(".policy-lifecycle-card").filter({ hasText: `Policy #${policyId}` });
  await expect(card).toBeVisible();
  return card;
}

async function openBenefits(card) {
  const details = card.locator("details.policy-benefits-panel");
  await expect(details).toBeVisible();
  if (!(await details.evaluate((element) => element.open))) {
    await details.locator("summary").click();
  }
  return details;
}

async function administerRequest(browser, requestId, type, evidenceReference = "") {
  const admin = await createActorContext(browser, "admin");
  try {
    await loginActor(admin.page, admin.actor);
    await admin.page.goto("/admin/benefits");
    const requestCard = admin.page.locator("article.card").filter({
      hasText: `${type} request #${requestId}`,
    });
    await expect(requestCard).toBeVisible();
    if (evidenceReference) {
      await requestCard.getByLabel("Verify secure evidence reference").fill(evidenceReference);
      await expect(requestCard).toContainText("Reference matches the on-chain commitment.");
    }
    await requestCard.getByRole("button", { name: "Approve", exact: true }).click();
    await expect(requestCard).toContainText("Status: APPROVED", { timeout: 60_000 });
    await requestCard.getByRole("button", { name: "Allocate Benefit" }).click();
    await expect(requestCard).toContainText("Status: ALLOCATED", { timeout: 60_000 });
  } finally {
    await closeActor(admin);
  }
}

test.describe("@unfinished complete benefits lifecycle", () => {
  test.describe.configure({ mode: "serial" });

  test("death benefit: designate beneficiary, verify evidence, allocate, withdraw once", async ({ browser }) => {
    test.setTimeout(180_000);
    const holder = await createActorContext(browser, "user");
    const beneficiary = await createActorContext(browser, "beneficiary");
    try {
      await loginActor(holder.page, holder.actor);
      const policyId = await purchaseFirstPackage(holder);
      const holderBenefits = contracts(holder).benefits;
      const requestCounterBefore = Number(await holderBenefits.requestCounter());
      const card = await policyCard(holder, policyId);
      const panel = await openBenefits(card);
      await panel.getByLabel("Beneficiary 1 wallet").fill(beneficiary.wallet.address);
      await panel.getByLabel("Beneficiary 1 share").fill("100");
      await panel.getByRole("button", { name: "Replace Beneficiaries" }).click();
      await expect(panel).toContainText(beneficiary.wallet.address, { timeout: 60_000 });

      await loginActor(beneficiary.page, beneficiary.actor);
      await beneficiary.page.goto("/user/benefits");
      await beneficiary.page.getByLabel("Policy ID").fill(policyId);
      await beneficiary.page.getByRole("button", { name: "Check Beneficiary Access" }).click();
      await expect(beneficiary.page.getByText(`Policy #${policyId}`)).toBeVisible();
      const evidenceReference = `synthetic-death-certificate-${policyId}`;
      await beneficiary.page.getByLabel("Death evidence reference").fill(evidenceReference);
      await beneficiary.page.getByRole("button", { name: "Request Death Benefit" }).click();
      await expect(beneficiary.page.locator(".app-toast")).toContainText("Death-benefit request submitted");
      const requestId = String(requestCounterBefore);
      await expect.poll(async () => Number(await holderBenefits.requestCounter())).toBe(requestCounterBefore + 1);

      await administerRequest(browser, requestId, "DEATH", evidenceReference);
      await beneficiary.page.getByRole("button", { name: "Check Beneficiary Access" }).click();
      const withdraw = beneficiary.page.getByRole("button", { name: /Withdraw .* ETH Benefit/ });
      await expect(withdraw).toBeVisible();
      await withdraw.click();
      await expect(beneficiary.page.locator(".app-toast")).toContainText("Allocated benefit withdrawn successfully");
      await expect.poll(async () => (await holderBenefits.claimableBenefitWei(beneficiary.wallet.address)).toString()).toBe("0");
      await expect(contracts(beneficiary).benefits.withdrawBenefit()).rejects.toThrow();
    } finally {
      await closeActor(holder);
      await closeActor(beneficiary);
    }
  });

  test("surrender benefit: six installments, cancellation, allocation, and withdrawal", async ({ browser }) => {
    test.setTimeout(180_000);
    const holder = await createActorContext(browser, "user");
    try {
      await loginActor(holder.page, holder.actor);
      const policyId = await purchaseFirstPackage(holder);
      const { manager, benefits } = contracts(holder);
      const policy = await manager.getPolicy(policyId);
      const sequentialManager = manager.connect(new NonceManager(holder.wallet));
      for (let index = 1; index < 6; index += 1) {
        await (await sequentialManager.payPremium(policyId, { value: policy.premiumAmount })).wait();
      }
      const requestId = String(await benefits.requestCounter());
      let card = await policyCard(holder, policyId);
      let panel = await openBenefits(card);
      holder.page.once("dialog", (dialog) => dialog.accept());
      await panel.getByRole("button", { name: "Cancel for Surrender" }).click();
      await expect(card.locator(".policy-state")).toHaveText("CANCELLED", { timeout: 60_000 });
      card = await policyCard(holder, policyId);
      panel = await openBenefits(card);
      await panel.getByRole("button", { name: "Request Surrender" }).click();
      await expect(panel).toContainText("SURRENDER: REQUESTED", { timeout: 60_000 });

      await administerRequest(browser, requestId, "SURRENDER");
      card = await policyCard(holder, policyId);
      panel = await openBenefits(card);
      const withdraw = panel.getByRole("button", { name: /Withdraw .* ETH Benefit/ });
      await expect(withdraw).toBeVisible();
      await withdraw.click();
      await expect(holder.page.locator(".app-toast")).toContainText("Allocated benefit withdrawn successfully");
      await expect.poll(async () => (await benefits.claimableBenefitWei(holder.wallet.address)).toString()).toBe("0");
    } finally {
      await closeActor(holder);
    }
  });

  test("maturity benefit: publish enabled terms, expire policy, allocate, and withdraw", async ({ browser }) => {
    test.setTimeout(180_000);
    const admin = await createActorContext(browser, "admin");
    try {
      await loginActor(admin.page, admin.actor);
      await admin.page.goto("/admin/benefits");
      await admin.page.getByLabel("Policy package").selectOption("1");
      await admin.page.getByLabel("Enable maturity benefit").check();
      await admin.page.getByLabel("Maturity bonus (% of premiums)").fill("10");
      await admin.page.getByRole("button", { name: "Publish New Version" }).click();
      await expect(admin.page.locator(".app-toast")).toContainText("benefit schedule version was published", {
        timeout: 60_000,
      });
    } finally {
      await closeActor(admin);
    }

    const holder = await createActorContext(browser, "user");
    try {
      await loginActor(holder.page, holder.actor);
      const policyId = await purchaseFirstPackage(holder);
      const { manager, benefits } = contracts(holder);
      const policy = await manager.getPolicy(policyId);
      const latest = await holder.provider.getBlock("latest");
      const secondsUntilExpiry = Number(policy.endDate) - Number(latest.timestamp) + 1;
      await holder.provider.send("evm_increaseTime", [secondsUntilExpiry]);
      await holder.provider.send("evm_mine", []);
      const requestId = String(await benefits.requestCounter());
      let card = await policyCard(holder, policyId);
      await expect(card.locator(".policy-state")).toHaveText("EXPIRED");
      let panel = await openBenefits(card);
      await panel.getByRole("button", { name: "Request Maturity" }).click();
      await expect(panel).toContainText("MATURITY: REQUESTED", { timeout: 60_000 });

      await administerRequest(browser, requestId, "MATURITY");
      card = await policyCard(holder, policyId);
      panel = await openBenefits(card);
      await panel.getByRole("button", { name: /Withdraw .* ETH Benefit/ }).click();
      await expect(holder.page.locator(".app-toast")).toContainText("Allocated benefit withdrawn successfully");
      await expect.poll(async () => (await benefits.claimableBenefitWei(holder.wallet.address)).toString()).toBe("0");
    } finally {
      await closeActor(holder);
    }
  });
});
