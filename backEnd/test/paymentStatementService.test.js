const assert = require("node:assert/strict");
const test = require("node:test");

const {
  buildCertificateHtml,
  buildPaymentStatement,
  buildStatementCsv,
  getFiscalYear,
} = require("../services/paymentStatementService");

const walletAddress = "0x0000000000000000000000000000000000000001";

test("uses Bangladesh's July-to-June fiscal-year boundary", () => {
  assert.equal(
    getFiscalYear("", new Date("2026-06-30T23:59:59.000Z")).label,
    "2025-2026"
  );
  assert.equal(
    getFiscalYear("", new Date("2026-07-01T00:00:00.000Z")).label,
    "2026-2027"
  );
  assert.equal(getFiscalYear("2024").label, "2024-2025");
  assert.throws(() => getFiscalYear("2024-2026"), /consecutive years/);
});

test("builds a confirmed payment ledger and excludes payments outside the fiscal year", async () => {
  const insideFiscalYear = Math.floor(
    new Date("2026-08-15T10:30:00.000Z").getTime() / 1000
  );
  const outsideFiscalYear = Math.floor(
    new Date("2026-06-15T10:30:00.000Z").getTime() / 1000
  );
  const premiumEvent = (paidAt, transactionHash, installmentsPaid) => ({
    args: {
      policyId: 1n,
      payer: walletAddress,
      amount: 10_000_000_000_000_000n,
      paidAt: BigInt(paidAt),
      nextPremiumDueDate: BigInt(paidAt + 30 * 86400),
      installmentsPaid: BigInt(installmentsPaid),
      totalPremiumPaid: BigInt(installmentsPaid) * 10_000_000_000_000_000n,
    },
    transactionHash,
    blockNumber: installmentsPaid,
    index: 0,
  });
  const contract = {
    runner: { provider: { getBlockNumber: async () => 10 } },
    filters: {
      PolicyPurchased: () => ({ kind: "purchase" }),
      PremiumPaid: () => ({ kind: "premium" }),
    },
    queryFilter: async (filter) =>
      filter.kind === "purchase"
        ? [{ args: { policyId: 1n } }]
        : [
            premiumEvent(insideFiscalYear, `0x${"1".repeat(64)}`, 2),
            premiumEvent(outsideFiscalYear, `0x${"2".repeat(64)}`, 1),
          ],
    getPolicy: async () => ({
      policyId: 1n,
      packageId: 2n,
      holderWallet: walletAddress,
      coverageAmount: 1_000_000_000_000_000_000n,
      startDate: BigInt(insideFiscalYear - 86400),
      endDate: BigInt(insideFiscalYear + 365 * 86400),
      premiumAmount: 10_000_000_000_000_000n,
      premiumInterval: 30n * 86400n,
      nextPremiumDueDate: BigInt(insideFiscalYear + 30 * 86400),
      installmentsPaid: 2n,
      totalPremiumPaid: 20_000_000_000_000_000n,
    }),
    getPolicyPackage: async () => ({
      name: "Health, Plus",
      policyType: "HEALTH",
    }),
  };

  const statement = await buildPaymentStatement({
    contract,
    walletAddress,
    fiscalYear: "2026-2027",
    referenceDate: new Date("2026-09-01T00:00:00.000Z"),
  });

  assert.equal(statement.payments.length, 1);
  assert.equal(statement.payments[0].status, "PAID");
  assert.equal(statement.payments[0].paymentMethod, "BLOCKCHAIN_WALLET");
  assert.equal(statement.summary.totalPaidEth, "0.01");
  assert.equal(statement.upcomingPayments[0].status, "SCHEDULED");
});

test("exports compact CSV statements and escaped printable certificates", () => {
  const statement = {
    generatedAt: "2026-09-01T00:00:00.000Z",
    fiscalYear: {
      label: "2026-2027",
      startDate: "2026-07-01T00:00:00.000Z",
      endDate: "2027-06-30T23:59:59.999Z",
    },
    summary: { paymentCount: 1, totalPaidEth: "0.01", currency: "ETH" },
    payments: [
      {
        policyId: "1",
        planName: "Health, Plus",
        paidAt: "2026-08-15T10:30:00.000Z",
        purposeLabel: "Initial policy premium",
        paymentMethodLabel: "Blockchain wallet",
        status: "PAID",
        amountEth: "0.01",
        transactionHash: `0x${"1".repeat(64)}`,
      },
    ],
  };
  const policyholder = { name: "A & B", walletAddress };
  const policy = {
    policyId: "1",
    planName: "<Health Plus>",
    policyType: "HEALTH",
    faceValueEth: "1.0",
    issueDate: "2026-08-01T00:00:00.000Z",
    maturityDate: "2027-08-01T00:00:00.000Z",
    premiumIntervalDays: 30,
    premiumAmountEth: "0.01",
    installmentsPaid: 1,
    totalPremiumPaidEth: "0.01",
  };

  const csv = buildStatementCsv({ statement, policyholder });
  assert.match(csv, /"Health, Plus"/);
  assert.match(csv, /Premium Payment Statement/);

  const html = buildCertificateHtml({ statement, policyholder, policy });
  assert.match(html, /Certificate of Insurance/);
  assert.match(html, /A &amp; B/);
  assert.match(html, /&lt;Health Plus&gt;/);
  assert.doesNotMatch(html, /<Health Plus>/);
});
