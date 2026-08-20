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
          status: payload.status || "",
          link: payload.link || "",
          dedupeKey: payload.dedupeKey,
        },
      },
      {
        new: true,
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

const notifyClaimStatusChange = ({
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
      "Four assigned auditors are voting. Three approvals allocate payout; two rejections reject automatically.",
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
  notifyClaimStatusChange,
  startBlockchainEventListener,
  stopBlockchainEventListener,
};
