const { ethers } = require("ethers");
const Notification = require("../models/Notification");
const { getReadOnlyContract } = require("./contractService");

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

  return notifyWallet(claimantWallet, {
    type: "CLAIM_STATUS_CHANGED",
    title: `Claim #${claimId} is now ${displayStatus}`,
    message:
      message ||
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

  listenerContract = getReadOnlyContract();
  reserveLowHandler = async (currentReserveWei, thresholdWei, eventPayload) => {
    const eventLog = eventPayload?.log || eventPayload;
    const transactionHash = eventLog?.transactionHash || "unknown";
    const logIndex = eventLog?.index ?? eventLog?.logIndex ?? "unknown";

    await notifyAdmins({
      type: "RESERVE_LOW_WARNING",
      title: "Contract reserve is below the warning threshold",
      message:
        `Current reserve: ${ethers.formatEther(currentReserveWei)} ETH. ` +
        `Configured threshold: ${ethers.formatEther(thresholdWei)} ETH.`,
      status: "RESERVE_LOW",
      link: "/admin",
      dedupeKey: `reserve-low:${transactionHash}:${logIndex}`,
    });
  };

  await listenerContract.on("ReserveLowWarning", reserveLowHandler);
  console.log("ReserveLowWarning blockchain listener started");
};

const stopBlockchainEventListener = async () => {
  if (!listenerContract || !reserveLowHandler) {
    return;
  }

  await listenerContract.off("ReserveLowWarning", reserveLowHandler);

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
