import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";

import {
  getNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from "../services/api";
import "../styles/pages/NotificationsPage.css";

function extractNotifications(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.notifications)) return data.notifications;
  if (Array.isArray(data?.data?.notifications)) return data.data.notifications;
  return [];
}

function formatDate(value) {
  if (!value) return "-";
  return new Date(value).toLocaleString();
}

export default function NotificationsPage() {
  const {
    data,
    isLoading,
    error,
    isFetching,
    refetch,
  } = useQuery({
    queryKey: ["notifications"],
    queryFn: getNotifications,
    refetchInterval: 5000,
    refetchIntervalInBackground: true,
  });

  const notifications = extractNotifications(data);
  const unreadCount = Number(data?.unreadCount || 0);

  async function handleMarkRead(notificationId) {
    await markNotificationRead(notificationId);
    await refetch();
  }

  async function handleMarkAllRead() {
    await markAllNotificationsRead();
    await refetch();
  }

  return (
    <section className="page-container page-notifications">
      <div className="notifications-head">
        <div>
          <h2>Notifications</h2>
          <p>{unreadCount} unread notification{unreadCount === 1 ? "" : "s"}</p>
        </div>

        <div className="action-row">
          <button type="button" onClick={() => refetch()} disabled={isFetching}>
            {isFetching ? "Refreshing..." : "Refresh"}
          </button>
          <button
            type="button"
            onClick={handleMarkAllRead}
            disabled={!unreadCount}
          >
            Mark All Read
          </button>
        </div>
      </div>

      {isLoading ? <p>Loading notifications...</p> : null}

      {error ? (
        <p className="error-text">
          {error.response?.data?.message ||
            error.message ||
            "Could not load notifications"}
        </p>
      ) : null}

      {!isLoading && notifications.length === 0 ? (
        <p>No notifications yet.</p>
      ) : null}

      <div className="notification-list">
        {notifications.map((notification) => (
          <article
            className={`notification-item ${
              notification.readAt ? "is-read" : "is-unread"
            }`}
            key={notification.id}
          >
            <div className="notification-item-head">
              <div>
                <span>{notification.type.replaceAll("_", " ")}</span>
                <h3>{notification.title}</h3>
              </div>
              <time>{formatDate(notification.createdAt)}</time>
            </div>

            <p>{notification.message}</p>

            <div className="action-row">
              {notification.link ? (
                <Link
                  to={notification.link}
                  onClick={() => {
                    if (!notification.readAt) {
                      handleMarkRead(notification.id);
                    }
                  }}
                >
                  Open
                </Link>
              ) : null}

              {!notification.readAt ? (
                <button
                  type="button"
                  onClick={() => handleMarkRead(notification.id)}
                >
                  Mark Read
                </button>
              ) : null}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
