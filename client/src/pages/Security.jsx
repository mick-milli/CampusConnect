import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api.js";
import { useAuth } from "../auth.jsx";

export default function Security() {
  const { logout, completeMfa } = useAuth();
  const navigate = useNavigate();

  // ---- two-factor authentication (opt-in TOTP) ----
  const [mfa, setMfa] = useState({ loading: true, enrolled: false });
  const [enroll, setEnroll] = useState(null); // { factorId, qr, secret } during setup
  const [mfaCode, setMfaCode] = useState("");
  const [mfaBusy, setMfaBusy] = useState(false);
  const [mfaError, setMfaError] = useState("");

  const loadMfa = () =>
    api
      .get("/auth/mfa")
      .then((s) => setMfa({ loading: false, enrolled: s.enrolled }))
      .catch(() => setMfa({ loading: false, enrolled: false }));
  useEffect(() => {
    loadMfa();
  }, []);

  const startEnroll = async () => {
    setMfaError("");
    setMfaBusy(true);
    try {
      const data = await api.post("/auth/mfa/enroll");
      setEnroll(data);
    } catch (e) {
      setMfaError(e.message);
    } finally {
      setMfaBusy(false);
    }
  };

  const confirmEnroll = async (e) => {
    e.preventDefault();
    setMfaError("");
    setMfaBusy(true);
    try {
      await completeMfa(enroll.factorId, mfaCode.trim());
      setEnroll(null);
      setMfaCode("");
      setMfa({ loading: false, enrolled: true });
    } catch (err) {
      setMfaError(err.message);
    } finally {
      setMfaBusy(false);
    }
  };

  const disableMfa = async () => {
    if (!window.confirm("Turn off two-factor authentication?")) return;
    setMfaError("");
    setMfaBusy(true);
    try {
      await api.post("/auth/mfa/disable");
      setMfa({ loading: false, enrolled: false });
    } catch (e) {
      setMfaError(e.message);
    } finally {
      setMfaBusy(false);
    }
  };

  const [pw, setPw] = useState({ currentPassword: "", newPassword: "", confirm: "" });
  const [pwBusy, setPwBusy] = useState(false);
  const [pwError, setPwError] = useState("");
  const [pwDone, setPwDone] = useState(false);

  const [confirmDeactivate, setConfirmDeactivate] = useState(false);
  const [deactPassword, setDeactPassword] = useState("");
  const [deactBusy, setDeactBusy] = useState(false);
  const [deactError, setDeactError] = useState("");

  const setField = (k) => (e) => {
    setPw({ ...pw, [k]: e.target.value });
    setPwDone(false);
    setPwError("");
  };

  const changePassword = async (e) => {
    e.preventDefault();
    if (pw.newPassword !== pw.confirm) {
      setPwError("New passwords don't match.");
      return;
    }
    setPwBusy(true);
    setPwError("");
    try {
      await api.post("/auth/change-password", {
        currentPassword: pw.currentPassword,
        newPassword: pw.newPassword,
      });
      setPw({ currentPassword: "", newPassword: "", confirm: "" });
      setPwDone(true);
    } catch (err) {
      setPwError(err.message);
    } finally {
      setPwBusy(false);
    }
  };

  const deactivate = async (e) => {
    e.preventDefault();
    setDeactBusy(true);
    setDeactError("");
    try {
      await api.post("/auth/deactivate", { password: deactPassword });
      logout();
      navigate("/", { replace: true });
    } catch (err) {
      setDeactError(err.message);
      setDeactBusy(false);
    }
  };

  return (
    <div style={{ margin: "26px 0" }} className="center-narrow">
      <h1>Security &amp; account access</h1>

      <form className="card" style={{ padding: 24 }} onSubmit={changePassword}>
        <h2 style={{ marginTop: 0 }}>Change password</h2>
        {pwError && <div className="error">{pwError}</div>}
        {pwDone && <div className="success">Password updated ✓</div>}

        <label>Current password</label>
        <input
          type="password"
          value={pw.currentPassword}
          onChange={setField("currentPassword")}
          required
        />

        <label>New password</label>
        <input
          type="password"
          value={pw.newPassword}
          onChange={setField("newPassword")}
          placeholder="At least 6 characters"
          required
        />

        <label>Confirm new password</label>
        <input type="password" value={pw.confirm} onChange={setField("confirm")} required />

        <button className="btn" style={{ marginTop: 16 }} disabled={pwBusy}>
          {pwBusy ? "Updating…" : "Update password"}
        </button>
      </form>

      <div className="card" style={{ padding: 24, marginTop: 20 }}>
        <h2 style={{ marginTop: 0 }}>Two-factor authentication</h2>
        <p className="muted" style={{ fontSize: 14 }}>
          Add an extra step at login using an authenticator app (Google Authenticator, Authy…).
          Optional, but recommended.
        </p>
        {mfaError && <div className="error">{mfaError}</div>}

        {mfa.loading ? (
          <p className="muted">Checking…</p>
        ) : mfa.enrolled ? (
          <div className="row" style={{ alignItems: "center", gap: 12 }}>
            <span className="pay-badge pay-released">✓ Enabled</span>
            <button className="btn ghost sm" disabled={mfaBusy} onClick={disableMfa}>
              {mfaBusy ? "Working…" : "Turn off"}
            </button>
          </div>
        ) : enroll ? (
          <form onSubmit={confirmEnroll}>
            <p style={{ fontSize: 14, marginBottom: 8 }}>
              1. Scan this QR code in your authenticator app (or enter the key manually):
            </p>
            {enroll.qr &&
              (enroll.qr.includes("<svg") ? (
                <div className="mfa-qr" dangerouslySetInnerHTML={{ __html: enroll.qr }} />
              ) : (
                <div className="mfa-qr">
                  <img src={enroll.qr} alt="2FA QR code" width={180} height={180} />
                </div>
              ))}
            <div className="muted" style={{ fontSize: 13, margin: "6px 0 14px" }}>
              Manual key: <span className="kbd">{enroll.secret}</span>
            </div>
            <label>2. Enter the 6-digit code it shows</label>
            <input
              inputMode="numeric"
              autoComplete="one-time-code"
              value={mfaCode}
              onChange={(e) => setMfaCode(e.target.value)}
              placeholder="123456"
              maxLength={6}
              required
            />
            <div className="row" style={{ marginTop: 14 }}>
              <button className="btn sm" disabled={mfaBusy}>
                {mfaBusy ? "Verifying…" : "Verify & enable"}
              </button>
              <button
                type="button"
                className="btn ghost sm"
                onClick={() => {
                  setEnroll(null);
                  setMfaCode("");
                  setMfaError("");
                }}
              >
                Cancel
              </button>
            </div>
          </form>
        ) : (
          <button className="btn" disabled={mfaBusy} onClick={startEnroll}>
            {mfaBusy ? "Starting…" : "Enable two-factor authentication"}
          </button>
        )}
      </div>

      <div className="card danger-zone" style={{ padding: 24, marginTop: 20 }}>
        <h2 style={{ marginTop: 0 }}>Deactivate account</h2>
        <p className="muted" style={{ fontSize: 14 }}>
          Your account will be disabled and you'll be signed out. Any services you offer are hidden
          from the marketplace. You won't be able to log in again with this account.
        </p>

        {!confirmDeactivate ? (
          <button className="btn danger" onClick={() => setConfirmDeactivate(true)}>
            Deactivate my account
          </button>
        ) : (
          <form onSubmit={deactivate}>
            {deactError && <div className="error">{deactError}</div>}
            <label>Enter your password to confirm</label>
            <input
              type="password"
              value={deactPassword}
              onChange={(e) => setDeactPassword(e.target.value)}
              required
            />
            <div className="row" style={{ marginTop: 14 }}>
              <button className="btn danger" disabled={deactBusy}>
                {deactBusy ? "Deactivating…" : "Confirm deactivation"}
              </button>
              <button
                type="button"
                className="btn ghost"
                onClick={() => {
                  setConfirmDeactivate(false);
                  setDeactPassword("");
                  setDeactError("");
                }}
              >
                Cancel
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
