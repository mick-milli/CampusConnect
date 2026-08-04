import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth.jsx";
import { useTheme } from "../theme.jsx";

export default function Settings() {
  const { user } = useAuth();
  const { theme, setTheme } = useTheme();
  const navigate = useNavigate();

  return (
    <div style={{ margin: "26px 0" }} className="center-narrow">
      <h1>Settings</h1>

      <div className="card settings-card">
        <div className="settings-head">Account</div>
        <button className="settings-link" onClick={() => navigate("/profile")}>
          <span>👤 Your Profile</span>
          <span className="chev" aria-hidden>
            ›
          </span>
        </button>
        <button className="settings-link" onClick={() => navigate("/settings/security")}>
          <span>🔒 Security &amp; account access</span>
          <span className="chev" aria-hidden>
            ›
          </span>
        </button>
        {user.role === "provider" && (
          <button className="settings-link" onClick={() => navigate("/settings/payout")}>
            <span>💸 Payout details</span>
            <span className="chev" aria-hidden>
              ›
            </span>
          </button>
        )}
      </div>

      <div className="card settings-card">
        <div className="settings-head">Appearance</div>
        <div className="settings-row">
          <div>
            <strong>Theme</strong>
            <div className="muted" style={{ fontSize: 13 }}>
              Choose a light or dark look
            </div>
          </div>
          <div className="theme-toggle" role="group" aria-label="Theme">
            <button
              className={`theme-opt${theme === "light" ? " on" : ""}`}
              aria-pressed={theme === "light"}
              onClick={() => setTheme("light")}
            >
              ☀️ Light
            </button>
            <button
              className={`theme-opt${theme === "dark" ? " on" : ""}`}
              aria-pressed={theme === "dark"}
              onClick={() => setTheme("dark")}
            >
              🌙 Dark
            </button>
          </div>
        </div>
      </div>

      <p className="muted" style={{ fontSize: 13, marginTop: 12 }}>
        Signed in as <strong>{user.email}</strong>
      </p>
    </div>
  );
}
