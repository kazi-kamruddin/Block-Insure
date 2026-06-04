const Notification = require("../models/Notification");

const getAccessQuery = (user) => {
  const walletQuery = { recipientWallet: user.walletAddress.toLowerCase() };

  if (user.role === "ADMIN") {
    return {
      $or: [
        walletQuery,
        { recipientRole: "ADMIN" },
      ],
    };
  }

  return walletQuery;
};

const formatNotification = (notification) => ({
  id: notification._id,
  recipientRole: notification.recipientRole,
  recipientWallet: notification.recipientWallet,
  actorWallet: notification.actorWallet,
  type: notification.type,
  title: notification.title,
  message: notification.message,
  claimId: notification.claimId,
  appealId: notification.appealId,
  status: notification.status,
  link: notification.link,
  readAt: notification.readAt,
  createdAt: notification.createdAt,
});

const getMyNotifications = async (req, res, next) => {
  try {
    const accessQuery = getAccessQuery(req.user);
    const notifications = await Notification.find(accessQuery)
      .sort({ createdAt: -1 })
      .limit(100);
    const unreadCount = await Notification.countDocuments({
      $and: [accessQuery, { readAt: null }],
    });

    res.status(200).json({
      success: true,
      count: notifications.length,
      unreadCount,
      notifications: notifications.map(formatNotification),
    });
  } catch (error) {
    next(error);
  }
};

const markNotificationRead = async (req, res, next) => {
  try {
    const notification = await Notification.findOneAndUpdate(
      {
        $and: [
          { _id: req.params.id },
          getAccessQuery(req.user),
        ],
      },
      { readAt: new Date() },
      { new: true }
    );

    if (!notification) {
      return res.status(404).json({
        success: false,
        message: "Notification not found",
      });
    }

    res.status(200).json({
      success: true,
      notification: formatNotification(notification),
    });
  } catch (error) {
    next(error);
  }
};

const markAllNotificationsRead = async (req, res, next) => {
  try {
    const result = await Notification.updateMany(
      {
        $and: [getAccessQuery(req.user), { readAt: null }],
      },
      { readAt: new Date() }
    );

    res.status(200).json({
      success: true,
      modifiedCount: result.modifiedCount,
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getMyNotifications,
  markNotificationRead,
  markAllNotificationsRead,
};
