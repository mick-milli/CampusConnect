import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth.jsx";
import { useNotifications } from "../notifications.jsx";
import { Avatar } from "./common.jsx";

// Single menu button that houses every feature for both roles:
//   Browse / Dashboard · My Orders · Notifications
//   Settings ▸ Account ▸ Your Profile / Log out
export default function MainMenu() {
  const { user, logout } = useAuth();
  const { unread } = useNotifications();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const navigate = useNavigate();

  useEffect(() => {
    const onDown = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  if (!user) return null;

  const go = (to) => {
    setOpen(false);
    navigate(to);
  };
  const doLogout = () => {
    setOpen(false);
    logout();
    navigate("/");
  };
  const badge = unread > 9 ? "9+" : unread;

  return (
    <div className="menu" ref={ref}>
      <button
        className="linkish menu-btn"
        onClick={() => setOpen((o) => !o)}
        aria-label="Menu"
        aria-expanded={open}
      >
        <span className="menu-icon" aria-hidden>
          ☰
        </span>
        <span className="menu-label">Menu</span>
        {unread > 0 && <span className="notif-badge">{badge}</span>}
      </button>

      {open && (
        <div className="menu-panel">
          <button className="menu-user" onClick={() => go("/profile")}>
            <Avatar user={user} size={42} />
            <span className="menu-user-info">
              <strong>{user.name}</strong>
              <span className="muted" style={{ fontSize: 12 }}>
                {user.role === "provider" ? "Service provider" : "Customer"}
              </span>
            </span>
          </button>

          <div className="menu-group">
            <button className="menu-item" onClick={() => go("/orders")}>
              📦 My Orders
            </button>
            {user.role === "provider" && (
              <button className="menu-item" onClick={() => go("/earnings")}>
                💰 Earnings &amp; payouts
              </button>
            )}
            <button className="menu-item" onClick={() => go("/notifications")}>
              🔔 Notifications
              {unread > 0 && <span className="menu-count">{badge}</span>}
            </button>
          </div>

          <div className="menu-group">
            <button className="menu-item" onClick={() => go("/settings")}>
              ⚙️ Settings
              <span className="chev" aria-hidden style={{ marginLeft: "auto" }}>
                ›
              </span>
            </button>
            <button className="menu-item danger" onClick={doLogout}>
              ⏻ Log out
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
