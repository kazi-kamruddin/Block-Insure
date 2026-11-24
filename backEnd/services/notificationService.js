const { ethers } = require("ethers");
const Notification = require("../models/Notification");
const {
  getPolicyEconomics,
  getReadOnlyContract,
} = require("./contractService");

let listenerContract = null;
let reserveLowHandler = null;

const normalizeWallet = (walletAddress) =>
  String(walletAddress || "").trim().toLowerCase();

const createNotification = async (payload) => {
  try {
    return await Notification.findOneAndUpdate(
      { dedupeKey: payload.dedupeKey },
      {
        $setOnInsert: {
          recipientRole: payload.recipientRole || "",
          recipientWallet: normalizeWallet(payload.recipientWallet),
          actorWallet: normalizeWallet(payload.actorWallet),
          type: payload.type,
          title: payload.title,
          message: payload.message,
          claimId: String(payload.claimId || ""),
          appealId: String(payload.appealId || ""),
          policyId: String(payload.policyId || ""),
          transactionHash: String(payload.transactionHash || "").toLowerCase(),
          status: payload.status || "",
          link: payload.link || "",
          dedupeKey: payload.dedupeKey,
        },
      },
      {
        returnDocument: "after",
        upsert: true,
        setDefaultsOnInsert: true,
      }
    );
  } catch (error) {
    console.warn("Notification creation failed:", error.message);
    return null;
  }
};

const notifyAdmins = (payload) =>
  createNotification({
    ...payload,
    recipientRole: "ADMIN",
    recipientWallet: "",
  });

const notifyWallet = (walletAddress, payload) =>
  createNotification({
    ...payload,
    recipientRole: "",
    recipientWallet: walletAddress,
  });

function notifyClarification(record, stage) {
  const actions = {
    ASKED: ["Clarification requested", "The claim officer requested additional evidence. Open your claim to respond."],
    ANSWERED: ["Clarification answered", "The claimant's clarification is confirmed and ready for fresh verification."],
    EXPIRED: ["Clarification expired", "The clarification deadline passed without a confirmed response."],
  };
  const [title, message] = actions[stage];
  const owner = stage === "ASKED";
  const payload = {
    type: "CLARIFICATION_" + stage, title, message, claimId: record.claimId,
    link: owner ? `/user/claims/${record.claimId}` : `/admin/claims/${record.claimId}`,
    dedupeKey: `clarification:${record.scope}:${record.claimId}:${record.priorVersion}:${stage}`,
  };
  return owner ? notifyWallet(record.owner, payload) : notifyAdmins(payload);
}

async function notifyExpiredClarifications(scope) {
  const Clarification = require("../models/ClaimClarification");
  const pending = { scope, confirmed: false, deadlineNoticeAt: null };
  if (!await Clarification.exists(pending)) return;
  const manager = getReadOnlyContract();
  const provider = manager.runner.provider;
  try {
    const block = await provider.getBlock("latest");
    const due = { ...pending, deadline: { $lt: block.timestamp } };
    const records = await Clarification.find(due).sort({ deadline: 1 }).limit(25);
    if (!records.length) return;
    const panel = new ethers.Contract(await manager.claimAdjudicator(),
      ["function clarificationEvidence(uint256,uint64) view returns(bytes32)"], provider);
    for (const record of records) {
      const found = record.manifestHash && await panel.clarificationEvidence(record.claimId, record.priorVersion + 1, { blockTag: block.number });
      if ((found && found === record.manifestHash) || await notifyClarification(record, "EXPIRED")) {
        await Clarification.updateOne({ _id: record._id, ...due }, { $set: { deadlineNoticeAt: new Date() } });
      }
    }
  } finally { provider.destroy(); }
}

function notifyRefund(wallet, { status, transactionHash, policyId, scope }) {
  const withdrawn = status === "WITHDRAWN";
  return notifyWallet(wallet, {
    type: withdrawn ? "REFUND_WITHDRAWN" : "REFUND_AVAILABLE",
    title: withdrawn ? "Cancellation refund withdrawn" : "Cancellation refund available",
    message: withdrawn ? "Your cancellation refund withdrawal is confirmed." : "Your cancellation refund is allocated and ready to withdraw.",
    transactionHash, policyId, link: "/user/policies",
    dedupeKey: `refund:${scope}:${transactionHash.toLowerCase()}:${status}`,
  });
}

const notifyClaimStatusChange = async ({
  claim,
  status,
  transactionHash = "",
  source = "status-change",
  message = "",
}) => {
  const claimId = claim.claimId.toString();
  const claimantWallet = claim.claimantWallet;
  const displayStatus = String(status || "UNKNOWN").replaceAll("_", " ");
  const guidanceByStatus = {
    DUPLICATE_CHECKED:
      "Automated duplicate checks passed. An administrator can now request oracle verification.",
    FRAUD_FLAGGED:
      "Automated checks found a duplicate or fraud signal. The claim requires manual review.",
    ORACLE_PENDING:
      "Independent oracle nodes are checking the submitted hospital record.",
    ORACLE_VERIFIED:
      "The oracle quorum verified the hospital record and the protocol allocated the settlement automatically.",
    ORACLE_FAILED:
      "The oracle quorum could not verify the hospital record. Manual review becomes publicly routable after the SLA.",
    MANUAL_REVIEW:
      "Four auditors have been assigned. Open the claim to authorize its fixed evidence set; the voting clock starts after access preparation.",
    PAYOUT_READY:
      "The settlement is allocated. Open the claim and withdraw your payment.",
    FUNDING_REQUIRED:
      "The claim is valid but awaits treasury backing. It has not been rejected.",
    REJECTED:
      "The claim was rejected. Open the claim to view the reason and appeal options.",
    SETTLED:
      "You withdrew the insurer payout on-chain.",
    CLOSED:
      "The claim lifecycle is complete. No further processing is available.",
  };

  if (status === "MANUAL_REVIEW") {
    const { getClaimAdjudicator } = require("./contractService");
    const manager = getReadOnlyContract();
    const version = await manager.claimVersion(claimId);
    const panel = await (await getClaimAdjudicator(manager)).getReview(claimId, version);
    for (const wallet of panel.auditors) if (wallet !== ethers.ZeroAddress) await notifyWallet(wallet, {
      type: "REVIEW_ASSIGNED", title: `Claim #${claimId}: access preparation`, message: "You are assigned to this claim version. Prepare or restore your encryption identity in the voting workspace; voting waits for owner authorization.",
      claimId, link: "/auditor/votes", dedupeKey: `review-assigned:${process.env.VITE_CONTRACT_ADDRESS}:${claimId}:${version}:${wallet}`,
    });
  }
  return notifyWallet(claimantWallet, {
    type: "CLAIM_STATUS_CHANGED",
    title: `Claim #${claimId} is now ${displayStatus}`,
    message:
      message ||
      guidanceByStatus[status] ||
      `The status of claim #${claimId} changed to ${displayStatus}.`,
    claimId,
    status,
    link: `/user/claims/${claimId}`,
    dedupeKey: `claim:${claimId}:${source}:${status}:${transactionHash}`,
  });
};

const startBlockchainEventListener = async () => {
  if (!process.env.RPC_URL || !process.env.VITE_CONTRACT_ADDRESS) {
    console.warn(
      "Reserve warning listener disabled: RPC_URL or VITE_CONTRACT_ADDRESS is missing."
    );
    return;
  }

  const managerContract = getReadOnlyContract();
  listenerContract = await getPolicyEconomics(managerContract);
  reserveLowHandler = async (currentReserveWei, requiredReserveWei, eventPayload) => {
    const eventLog = eventPayload?.log || eventPayload;
    const transactionHash = eventLog?.transactionHash || "unknown";
    const logIndex = eventLog?.index ?? eventLog?.logIndex ?? "unknown";

    await notifyAdmins({
      type: "RESERVE_LOW_WARNING",
      title: "Contract reserve is below the warning threshold",
      message:
        `Current reserve: ${ethers.formatEther(currentReserveWei)} ETH. ` +
        `Required reserve: ${ethers.formatEther(requiredReserveWei)} ETH.`,
      status: "RESERVE_LOW",
      link: "/admin",
      dedupeKey: `reserve-low:${transactionHash}:${logIndex}`,
    });
  };

  await listenerContract.on("SolvencyWarning", reserveLowHandler);
  console.log("SolvencyWarning blockchain listener started");
};

const stopBlockchainEventListener = async () => {
  if (!listenerContract || !reserveLowHandler) {
    return;
  }

  await listenerContract.off("SolvencyWarning", reserveLowHandler);

  if (typeof listenerContract.runner?.destroy === "function") {
    listenerContract.runner.destroy();
  }

  listenerContract = null;
  reserveLowHandler = null;
};

module.exports = {
  notifyAdmins,
  notifyWallet,
  notifyClarification,
  notifyExpiredClarifications,
  notifyRefund,
  notifyClaimStatusChange,
  startBlockchainEventListener,
  stopBlockchainEventListener,
};
