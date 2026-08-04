import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useNotifications } from "../notifications.jsx";
import { timeAgo } from "../components/common.jsx";

const ICONS = { order: "📦", status: "🚚", message: "💬", payment: "🔒" };

export default function Notifications() {
  const { items, markAllRead } = useNotifications();
  const navigate = useNavigate();

  // Opening this page clears the unread badge.
  useEffect(() => {
    markAllRead();
  }, [markAllRead]);

  return (
    <div style={{ margin: "26px 0" }}>
      <h1>Notifications</h1>
      {items.length === 0 ? (
        <div className="empty">You're all caught up 🎉</div>
      ) : (
        <div className="card" style={{ marginTop: 16, overflow: "hidden" }}>
          <div className="notif-list">
            {items.map((n) => (
              <button
                key={n.id}
                className={`notif-item${n.read ? "" : " unread"}`}
                onClick={() => n.orderId && navigate("/orders")}
              >
                <span className="notif-icon" aria-hidden>
                  {ICONS[n.type] || "🔔"}
                </span>
                <span className="notif-body">
                  <span className="notif-msg">{n.text}</span>
                  <span className="notif-time">{timeAgo(n.createdAt)}</span>
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
