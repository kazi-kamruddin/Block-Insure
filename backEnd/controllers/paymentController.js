const User = require("../models/User");
const { getContractAddress, getReadOnlyContract } = require("../services/contractService");
const { notifyWallet } = require("../services/notificationService");
const {
  buildCertificateHtml,
  buildPaymentStatement,
  buildStatementCsv,
  formatPremiumEvent,
} = require("../services/paymentStatementService");

const createError = (message, statusCode = 400) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

const getPolicyholder = async (walletAddress) => {
  const user = await User.findOne({ walletAddress: walletAddress.toLowerCase() })
    .select("name email walletAddress")
    .lean();
  return {
    name: user?.name || "",
    email: user?.email || "",
    walletAddress: walletAddress.toLowerCase(),
  };
};

const notifyPaymentReceived = (walletAddress, payment) =>
  notifyWallet(walletAddress, {
    type: "PREMIUM_PAYMENT_CONFIRMED",
    title:
      payment.purpose === "INITIAL_PREMIUM"
        ? `Initial premium received for policy #${payment.policyId}`
        : `Premium received for policy #${payment.policyId}`,
    message:
      `${payment.amountEth} ETH was confirmed as installment ` +
      `${payment.installmentNumber} through ${payment.paymentMethodLabel}.`,
    policyId: payment.policyId,
    transactionHash: payment.transactionHash,
    status: payment.status,
    link: `/user/payments?policyId=${payment.policyId}`,
    dedupeKey: `premium-payment:${payment.transactionHash}:${payment.logIndex}`,
  });

const notifyUpcomingPayment = (walletAddress, payment, referenceDate) => {
  const daysUntilDue = Math.ceil(
    (new Date(payment.dueAt).getTime() - referenceDate.getTime()) /
      (24 * 60 * 60 * 1000)
  );
  if (daysUntilDue < 15 || daysUntilDue > 20) return null;

  return notifyWallet(walletAddress, {
    type: "PREMIUM_DUE_REMINDER",
    title: `Premium due in ${daysUntilDue} days`,
    message:
      `${payment.amountEth} ETH is scheduled for policy #${payment.policyId} ` +
      `on ${new Date(payment.dueAt).toLocaleDateString("en-GB")}. ` +
      "Keep enough funds available for payment.",
    policyId: payment.policyId,
    status: payment.status,
    link: `/user/payments?policyId=${payment.policyId}`,
    dedupeKey: `premium-due:${payment.policyId}:${payment.dueAt.slice(0, 10)}:20-day-window`,
  });
};

const loadStatement = async (req, { requirePolicy = false } = {}) => {
  const policyId = String(req.query.policyId || req.params.policyId || "").trim();
  if (requirePolicy && !/^\d+$/.test(policyId)) {
    throw createError("A numeric policyId is required");
  }

  const referenceDate = new Date();
  const statement = await buildPaymentStatement({
    contract: getReadOnlyContract(),
    walletAddress: req.user.walletAddress,
    policyId,
    fiscalYear: req.query.fiscalYear,
    referenceDate,
  });
  const policyholder = await getPolicyholder(req.user.walletAddress);

  await Promise.all([
    ...statement.payments.map((payment) =>
      notifyPaymentReceived(req.user.walletAddress, payment)
    ),
    ...statement.upcomingPayments.map((payment) =>
      notifyUpcomingPayment(req.user.walletAddress, payment, referenceDate)
    ),
  ]);

  return { policyholder, statement, policyId };
};

const getMyPaymentStatement = async (req, res, next) => {
  try {
    const { policyholder, statement } = await loadStatement(req);
    res.status(200).json({
      success: true,
      policyholder,
      ...statement,
    });
  } catch (error) {
    next(error);
  }
};

const downloadPaymentStatement = async (req, res, next) => {
  try {
    const { policyholder, statement } = await loadStatement(req);
    const scope = req.query.policyId ? `policy-${req.query.policyId}` : "all-policies";
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="premium-statement-${scope}-${statement.fiscalYear.label}.csv"`
    );
    res.status(200).send(buildStatementCsv({ statement, policyholder }));
  } catch (error) {
    next(error);
  }
};

const downloadInsuranceCertificate = async (req, res, next) => {
  try {
    const { policyholder, statement, policyId } = await loadStatement(req, {
      requirePolicy: true,
    });
    const policy = statement.policies.find((item) => item.policyId === policyId);
    if (!policy) throw createError("Policy not found", 404);

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `${req.query.download === "0" ? "inline" : "attachment"}; ` +
        `filename="insurance-certificate-policy-${policyId}.html"`
    );
    res.status(200).send(
      buildCertificateHtml({ statement, policyholder, policy })
    );
  } catch (error) {
    next(error);
  }
};

const confirmPremiumPayment = async (req, res, next) => {
  try {
    const transactionHash = String(req.body.transactionHash || "").trim();
    if (!/^0x[a-f\d]{64}$/i.test(transactionHash)) {
      throw createError("A valid transactionHash is required");
    }

    const contract = getReadOnlyContract();
    const [receipt, transaction] = await Promise.all([
      contract.runner.getTransactionReceipt(transactionHash),
      contract.runner.getTransaction(transactionHash),
    ]);
    if (!receipt || !transaction) {
      throw createError("Payment transaction was not found", 404);
    }
    if (Number(receipt.status) !== 1) {
      throw createError("Payment transaction did not succeed", 409);
    }
    if (String(transaction.to || "").toLowerCase() !== getContractAddress().toLowerCase()) {
      throw createError("Transaction was not sent to the insurance contract", 409);
    }
    if (transaction.from.toLowerCase() !== req.user.walletAddress.toLowerCase()) {
      throw createError("Payment transaction belongs to another wallet", 403);
    }

    const parsedPayments = receipt.logs.flatMap((log) => {
      if (log.address.toLowerCase() !== getContractAddress().toLowerCase()) return [];
      try {
        const parsed = contract.interface.parseLog(log);
        return parsed?.name === "PremiumPaid"
          ? [{ parsed, log }]
          : [];
      } catch {
        return [];
      }
    });
    const match = parsedPayments.find(
      ({ parsed }) =>
        parsed.args.payer.toLowerCase() === req.user.walletAddress.toLowerCase()
    );
    if (!match) {
      throw createError("Transaction does not contain a premium payment", 409);
    }

    const policy = await contract.getPolicy(match.parsed.args.policyId);
    if (policy.holderWallet.toLowerCase() !== req.user.walletAddress.toLowerCase()) {
      throw createError("Payment policy belongs to another wallet", 403);
    }
    const policyPackage = await contract.getPolicyPackage(policy.packageId);
    const payment = formatPremiumEvent(
      {
        args: match.parsed.args,
        transactionHash,
        blockNumber: match.log.blockNumber,
        index: match.log.index,
      },
      {
        packageId: policy.packageId.toString(),
        planName: policyPackage.name,
        policyType: policyPackage.policyType,
      }
    );
    await notifyPaymentReceived(req.user.walletAddress, payment);

    res.status(200).json({
      success: true,
      message: "Premium payment confirmed and added to the statement",
      payment,
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  confirmPremiumPayment,
  downloadInsuranceCertificate,
  downloadPaymentStatement,
  getMyPaymentStatement,
};
