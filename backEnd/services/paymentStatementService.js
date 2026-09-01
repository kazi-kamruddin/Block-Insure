const { ethers } = require("ethers");
const {
  getPolicyIdsByWallet,
  queryEventsInChunks,
} = require("./contractQueryService");

const SECONDS_PER_DAY = 24 * 60 * 60;
const PAYMENT_METHOD = "BLOCKCHAIN_WALLET";

const createError = (message, statusCode = 400) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

const toUnixSeconds = (date) => Math.floor(date.getTime() / 1000);

const getFiscalYear = (value, referenceDate = new Date()) => {
  const supplied = String(value || "").trim();
  let startYear;

  if (supplied) {
    const match = supplied.match(/^(\d{4})(?:-(\d{4}))?$/);
    if (!match) {
      throw createError("Fiscal year must use YYYY or YYYY-YYYY format");
    }
    startYear = Number(match[1]);
    if (match[2] && Number(match[2]) !== startYear + 1) {
      throw createError("Fiscal year must run between consecutive years");
    }
  } else {
    const year = referenceDate.getUTCFullYear();
    startYear = referenceDate.getUTCMonth() >= 6 ? year : year - 1;
  }

  if (startYear < 2000 || startYear > 2200) {
    throw createError("Fiscal year is outside the supported range");
  }

  const startDate = new Date(Date.UTC(startYear, 6, 1));
  const endExclusive = new Date(Date.UTC(startYear + 1, 6, 1));

  return {
    startYear,
    endYear: startYear + 1,
    label: `${startYear}-${startYear + 1}`,
    startDate: startDate.toISOString(),
    endDate: new Date(endExclusive.getTime() - 1).toISOString(),
    startUnix: toUnixSeconds(startDate),
    endUnixExclusive: toUnixSeconds(endExclusive),
  };
};

const getAvailableFiscalYears = (referenceDate = new Date(), count = 5) => {
  const current = getFiscalYear("", referenceDate).startYear;
  return Array.from({ length: count }, (_, index) => {
    const fiscalYear = getFiscalYear(String(current - index), referenceDate);
    return {
      label: fiscalYear.label,
      startDate: fiscalYear.startDate,
      endDate: fiscalYear.endDate,
    };
  });
};

const formatPolicy = (policy, policyPackage) => ({
  policyId: policy.policyId.toString(),
  packageId: policy.packageId.toString(),
  planName: policyPackage.name,
  policyType: policyPackage.policyType,
  holderWallet: policy.holderWallet,
  faceValueWei: policy.coverageAmount.toString(),
  faceValueEth: ethers.formatEther(policy.coverageAmount),
  issueDate: new Date(Number(policy.startDate) * 1000).toISOString(),
  maturityDate: new Date(Number(policy.endDate) * 1000).toISOString(),
  premiumAmountWei: policy.premiumAmount.toString(),
  premiumAmountEth: ethers.formatEther(policy.premiumAmount),
  premiumIntervalDays: Math.round(Number(policy.premiumInterval) / SECONDS_PER_DAY),
  nextPremiumDueDate:
    Number(policy.nextPremiumDueDate) > 0
      ? new Date(Number(policy.nextPremiumDueDate) * 1000).toISOString()
      : null,
  installmentsPaid: Number(policy.installmentsPaid),
  totalPremiumPaidWei: policy.totalPremiumPaid.toString(),
  totalPremiumPaidEth: ethers.formatEther(policy.totalPremiumPaid),
});

const formatPremiumEvent = (event, policy) => {
  const args = event.args;
  const paidAt = Number(args.paidAt);
  const installmentNumber = Number(args.installmentsPaid);

  return {
    paymentId: `${event.transactionHash}:${event.index}`,
    policyId: args.policyId.toString(),
    packageId: policy.packageId,
    planName: policy.planName,
    policyType: policy.policyType,
    payerWallet: args.payer,
    amountWei: args.amount.toString(),
    amountEth: ethers.formatEther(args.amount),
    paidAt: new Date(paidAt * 1000).toISOString(),
    paidAtUnix: String(paidAt),
    nextPremiumDueDate: new Date(
      Number(args.nextPremiumDueDate) * 1000
    ).toISOString(),
    installmentNumber,
    totalPremiumPaidWei: args.totalPremiumPaid.toString(),
    totalPremiumPaidEth: ethers.formatEther(args.totalPremiumPaid),
    purpose: installmentNumber === 1 ? "INITIAL_PREMIUM" : "RECURRING_PREMIUM",
    purposeLabel:
      installmentNumber === 1 ? "Initial policy premium" : "Recurring premium",
    paymentMethod: PAYMENT_METHOD,
    paymentMethodLabel: "Blockchain wallet",
    status: "PAID",
    transactionHash: event.transactionHash,
    blockNumber: event.blockNumber,
    logIndex: event.index,
  };
};

const loadPolicy = async (contract, policyId, walletAddress) => {
  const policy = await contract.getPolicy(policyId);
  if (policy.holderWallet.toLowerCase() !== walletAddress.toLowerCase()) {
    throw createError("Access denied: policy does not belong to this wallet", 403);
  }
  const policyPackage = await contract.getPolicyPackage(policy.packageId);
  return formatPolicy(policy, policyPackage);
};

const buildPaymentStatement = async ({
  contract,
  walletAddress,
  policyId = "",
  fiscalYear = "",
  referenceDate = new Date(),
}) => {
  const selectedFiscalYear = getFiscalYear(fiscalYear, referenceDate);
  const policyIds = policyId
    ? [String(policyId)]
    : (await getPolicyIdsByWallet(contract, walletAddress)).map(String);
  const policies = await Promise.all(
    policyIds.map((id) => loadPolicy(contract, id, walletAddress))
  );
  const eventGroups = await Promise.all(
    policies.map(async (policy) => {
      const events = await queryEventsInChunks(
        contract,
        contract.filters.PremiumPaid(policy.policyId)
      );
      return events.map((event) => formatPremiumEvent(event, policy));
    })
  );
  const allPayments = eventGroups
    .flat()
    .sort((left, right) => right.paidAtUnix - left.paidAtUnix);
  const payments = allPayments.filter((payment) => {
    const paidAt = Number(payment.paidAtUnix);
    return (
      paidAt >= selectedFiscalYear.startUnix &&
      paidAt < selectedFiscalYear.endUnixExclusive
    );
  });
  const totalPaidWei = payments.reduce(
    (total, payment) => total + BigInt(payment.amountWei),
    0n
  );
  const upcomingPayments = policies
    .filter((policy) => {
      if (!policy.nextPremiumDueDate) return false;
      const dueAt = toUnixSeconds(new Date(policy.nextPremiumDueDate));
      return (
        dueAt >= selectedFiscalYear.startUnix &&
        dueAt < selectedFiscalYear.endUnixExclusive
      );
    })
    .map((policy) => ({
      policyId: policy.policyId,
      planName: policy.planName,
      dueAt: policy.nextPremiumDueDate,
      amountWei: policy.premiumAmountWei,
      amountEth: policy.premiumAmountEth,
      paymentMethod: "NOT_CONFIGURED",
      paymentMethodLabel: "Manual wallet payment",
      status: "SCHEDULED",
    }))
    .sort((left, right) => new Date(left.dueAt) - new Date(right.dueAt));

  return {
    generatedAt: referenceDate.toISOString(),
    fiscalYear: {
      label: selectedFiscalYear.label,
      startDate: selectedFiscalYear.startDate,
      endDate: selectedFiscalYear.endDate,
    },
    availableFiscalYears: getAvailableFiscalYears(referenceDate),
    summary: {
      paymentCount: payments.length,
      policiesCovered: new Set(payments.map((payment) => payment.policyId)).size,
      totalPaidWei: totalPaidWei.toString(),
      totalPaidEth: ethers.formatEther(totalPaidWei),
      currency: "ETH",
    },
    policies,
    payments,
    upcomingPayments,
  };
};

const escapeCsv = (value) => `"${String(value ?? "").replaceAll('"', '""')}"`;

const buildStatementCsv = ({ statement, policyholder }) => {
  const rows = [
    ["Block-Insure Premium Payment Statement"],
    ["Policyholder", policyholder.name || "Wallet policyholder"],
    ["Wallet", policyholder.walletAddress],
    ["Fiscal year", statement.fiscalYear.label],
    ["Period", `${statement.fiscalYear.startDate} to ${statement.fiscalYear.endDate}`],
    ["Generated at", statement.generatedAt],
    ["Payments", statement.summary.paymentCount],
    ["Total paid", statement.summary.totalPaidEth, statement.summary.currency],
    [],
    [
      "Payment date",
      "Policy number",
      "Plan",
      "Purpose",
      "Method",
      "Status",
      "Amount (ETH)",
      "Transaction hash",
    ],
    ...statement.payments.map((payment) => [
      payment.paidAt,
      payment.policyId,
      payment.planName,
      payment.purposeLabel,
      payment.paymentMethodLabel,
      payment.status,
      payment.amountEth,
      payment.transactionHash,
    ]),
  ];

  return `\uFEFF${rows
    .map((row) => row.map(escapeCsv).join(","))
    .join("\r\n")}`;
};

const escapeHtml = (value) =>
  String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

const buildCertificateHtml = ({ statement, policyholder, policy }) => {
  const rows = statement.payments
    .filter((payment) => payment.policyId === policy.policyId)
    .map(
      (payment) => `
        <tr>
          <td>${escapeHtml(new Date(payment.paidAt).toLocaleDateString("en-GB"))}</td>
          <td>${escapeHtml(payment.purposeLabel)}</td>
          <td>${escapeHtml(payment.paymentMethodLabel)}</td>
          <td>${escapeHtml(payment.amountEth)} ETH</td>
          <td>${escapeHtml(payment.status)}</td>
        </tr>`
    )
    .join("");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Certificate of Insurance - Policy ${escapeHtml(policy.policyId)}</title>
  <style>
    body { color: #17202a; font: 15px/1.5 Arial, sans-serif; margin: 0; padding: 36px; }
    main { border: 2px solid #183b56; margin: auto; max-width: 900px; padding: 34px; }
    h1 { color: #183b56; margin: 0; text-align: center; }
    .subtitle { color: #52606d; text-align: center; }
    .grid { display: grid; gap: 12px; grid-template-columns: repeat(2, 1fr); margin: 28px 0; }
    .grid div { border-bottom: 1px solid #cbd2d9; padding: 8px 0; }
    .grid span { color: #52606d; display: block; font-size: 12px; text-transform: uppercase; }
    table { border-collapse: collapse; margin-top: 18px; width: 100%; }
    th, td { border: 1px solid #cbd2d9; padding: 8px; text-align: left; }
    th { background: #f0f4f8; }
    footer { color: #52606d; font-size: 12px; margin-top: 28px; }
    @media print { body { padding: 0; } main { border: 0; max-width: none; } }
  </style>
</head>
<body>
  <main>
    <h1>Certificate of Insurance</h1>
    <p class="subtitle">Dynamically generated policy and premium record</p>
    <section class="grid">
      <div><span>Policy number</span><strong>${escapeHtml(policy.policyId)}</strong></div>
      <div><span>Policyholder</span><strong>${escapeHtml(policyholder.name || "Wallet policyholder")}</strong></div>
      <div><span>Wallet address</span><strong>${escapeHtml(policyholder.walletAddress)}</strong></div>
      <div><span>Insurance plan</span><strong>${escapeHtml(policy.planName)}</strong></div>
      <div><span>Policy type</span><strong>${escapeHtml(policy.policyType)}</strong></div>
      <div><span>Face value</span><strong>${escapeHtml(policy.faceValueEth)} ETH</strong></div>
      <div><span>Issue date</span><strong>${escapeHtml(new Date(policy.issueDate).toLocaleDateString("en-GB"))}</strong></div>
      <div><span>Maturity date</span><strong>${escapeHtml(new Date(policy.maturityDate).toLocaleDateString("en-GB"))}</strong></div>
      <div><span>Premium schedule</span><strong>Every ${escapeHtml(policy.premiumIntervalDays)} days</strong></div>
      <div><span>Premium amount</span><strong>${escapeHtml(policy.premiumAmountEth)} ETH</strong></div>
      <div><span>Installments paid</span><strong>${escapeHtml(policy.installmentsPaid)}</strong></div>
      <div><span>Total paid to date</span><strong>${escapeHtml(policy.totalPremiumPaidEth)} ETH</strong></div>
    </section>
    <h2>Payments in fiscal year ${escapeHtml(statement.fiscalYear.label)}</h2>
    <table>
      <thead><tr><th>Date</th><th>Purpose</th><th>Method</th><th>Amount</th><th>Status</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="5">No payments in this fiscal year.</td></tr>'}</tbody>
    </table>
    <footer>
      Generated ${escapeHtml(new Date(statement.generatedAt).toLocaleString("en-GB"))}. Payment references are derived from confirmed blockchain events. This demonstration certificate is not a government tax certificate.
    </footer>
  </main>
</body>
</html>`;
};

module.exports = {
  PAYMENT_METHOD,
  buildCertificateHtml,
  buildPaymentStatement,
  buildStatementCsv,
  formatPremiumEvent,
  getAvailableFiscalYears,
  getFiscalYear,
};
