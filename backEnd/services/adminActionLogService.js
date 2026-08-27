const AdminActionLog = require("../models/AdminActionLog");

const serializeMetadata = (value) => {
  if (typeof value === "bigint") {
    return value.toString();
  }

  if (Array.isArray(value)) {
    return value.map(serializeMetadata);
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, nestedValue]) => [
        key,
        serializeMetadata(nestedValue),
      ])
    );
  }

  return value;
};

const logAdminAction = async ({
  req,
  action,
  targetType = "",
  targetId = "",
  tx,
  receipt,
  metadata = {},
}) => {
  try {
    await AdminActionLog.create({
      actorWallet: req.user?.walletAddress || "",
      actorRole: req.user?.role || "",
      action,
      targetType,
      targetId: targetId?.toString() || "",
      transactionHash: tx?.hash || "",
      blockNumber: receipt?.blockNumber || null,
      request: {
        ip: req.ip || "",
        method: req.method || "",
        path: req.originalUrl || req.path || "",
        userAgent: req.get?.("user-agent") || "",
      },
      metadata: serializeMetadata(metadata),
    });
  } catch (error) {
    console.warn("Admin action audit log failed:", error.message);
  }
};

module.exports = {
  logAdminAction,
};
