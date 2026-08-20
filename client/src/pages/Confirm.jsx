import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../auth.jsx";
import { Spinner } from "../components/common.jsx";

// Landing spot for the link in the signup confirmation email. GoTrue verifies
// the token on its side, then redirects here with the resulting session tokens
// (or an error) in the URL hash fragment.
export default function Confirm() {
  const { sessionFromTokens } = useAuth();
  const navigate = useNavigate();
  const [status, setStatus] = useState("working"); // "working" | "error"
  const [message, setMessage] = useState("");
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return; // guard against StrictMode's double-invoke
    ran.current = true;

    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const token = hash.get("access_token");
    const refreshToken = hash.get("refresh_token");
    const err = hash.get("error_description") || hash.get("error");
    // Strip the tokens from the address bar so they aren't left in history.
    window.history.replaceState(null, "", window.location.pathname);

    if (err) {
      setStatus("error");
      setMessage(err);
      return;
    }
    if (!token) {
      setStatus("error");
      setMessage("This confirmation link is invalid or has already been used.");
      return;
    }
    sessionFromTokens({ token, refreshToken })
      .then((user) => navigate(user.role === "provider" ? "/dashboard" : "/services", { replace: true }))
      .catch((e) => {
        setStatus("error");
        setMessage(e.message);
      });
  }, [navigate, sessionFromTokens]);

  if (status === "working") {
    return (
      <div className="center-narrow">
        <div className="card" style={{ padding: 28, textAlign: "center" }}>
          <Spinner />
          <p className="muted">Confirming your account…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="center-narrow">
      <div className="card" style={{ padding: 28 }}>
        <h1 style={{ marginTop: 0 }}>Confirmation failed</h1>
        <div className="error">{message}</div>
        <p className="muted" style={{ marginTop: 16 }}>
          The link may have expired. Try{" "}
          <Link to="/register" style={{ color: "var(--green)", fontWeight: 700 }}>
            signing up
          </Link>{" "}
          again, or{" "}
          <Link to="/login" style={{ color: "var(--green)", fontWeight: 700 }}>
            log in
          </Link>{" "}
          if you've already confirmed.
        </p>
      </div>
    </div>
  );
}
