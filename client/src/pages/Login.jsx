import { useState } from "react";
import { Link, useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "../auth.jsx";

export default function Login() {
  const { login, completeMfa } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  // Two-factor step: set once a password login reports mfaRequired.
  const [factorId, setFactorId] = useState(null);
  const [code, setCode] = useState("");

  const goTo = (user) =>
    navigate(location.state?.from || (user.role === "provider" ? "/dashboard" : "/services"));

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const res = await login(email, password);
      if (res.mfaRequired) {
        setFactorId(res.factorId);
        setBusy(false);
        return;
      }
      goTo(res.user);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  const submitCode = async (e) => {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const user = await completeMfa(factorId, code.trim());
      goTo(user);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  const fill = (e, p) => {
    setEmail(e);
    setPassword(p);
  };

  return (
    <div className="center-narrow">
      <div className="card" style={{ padding: 28 }}>
        {factorId ? (
          <>
            <h1 style={{ marginTop: 0 }}>Two-factor authentication</h1>
            <p className="muted">
              Enter the 6-digit code from your authenticator app to finish signing in.
            </p>
            {error && <div className="error">{error}</div>}
            <form onSubmit={submitCode}>
              <label>Authentication code</label>
              <input
                inputMode="numeric"
                autoComplete="one-time-code"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="123456"
                maxLength={6}
                autoFocus
                required
              />
              <button className="btn" style={{ width: "100%", marginTop: 18 }} disabled={busy}>
                {busy ? "Verifying…" : "Verify & sign in"}
              </button>
            </form>
            <button
              type="button"
              className="linkish-plain muted"
              style={{ marginTop: 14 }}
              onClick={() => {
                setFactorId(null);
                setCode("");
                setError("");
              }}
            >
              ← Back
            </button>
          </>
        ) : (
          <>
        <h1 style={{ marginTop: 0 }}>Welcome back</h1>
        <p className="muted">Log in to book services or manage your business.</p>
        {error && <div className="error">{error}</div>}
        <form onSubmit={submit}>
          <label>Email</label>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          <label>Password</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
          <button className="btn" style={{ width: "100%", marginTop: 18 }} disabled={busy}>
            {busy ? "Logging in…" : "Log in"}
          </button>
        </form>
        <p className="muted" style={{ marginTop: 16 }}>
          No account?{" "}
          <Link to="/register" style={{ color: "var(--green)", fontWeight: 700 }}>
            Sign up
          </Link>
        </p>

        <div style={{ borderTop: "1px solid var(--line)", marginTop: 16, paddingTop: 14 }}>
          <div className="muted" style={{ fontSize: 13, marginBottom: 8 }}>
            Demo accounts (password: <span className="kbd">password</span>):
          </div>
          <div className="row">
            <button
              type="button"
              className="btn ghost sm"
              onClick={() => fill("student@knust.edu.gh", "password")}
            >
              Customer
            </button>
            <button
              type="button"
              className="btn ghost sm"
              onClick={() => fill("kwame@knust.edu.gh", "password")}
            >
              Provider
            </button>
          </div>
        </div>
          </>
        )}
      </div>
    </div>
  );
}
