const Notification = require("../models/Notification");

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

module.exports = {
  notifyAdmins,
  notifyWallet,
  notifyClaimStatusChange,
};
