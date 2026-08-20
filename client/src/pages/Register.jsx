import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../auth.jsx";
import { api } from "../api.js";

export default function Register() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({
    name: "",
    email: "",
    password: "",
    role: "customer",
    phone: "",
    location: "",
  });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  // Set to the email address once signup needs confirmation, which swaps the
  // form out for the "check your inbox" screen.
  const [pending, setPending] = useState("");
  const [resent, setResent] = useState(false);

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const res = await register(form);
      if (res.pending) {
        setPending(res.email);
        return;
      }
      navigate(res.user.role === "provider" ? "/dashboard" : "/services");
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const resend = async () => {
    setError("");
    try {
      await api.post("/auth/resend", { email: pending });
      setResent(true);
    } catch (err) {
      setError(err.message);
    }
  };

  if (pending) {
    return (
      <div className="center-narrow">
        <div className="card" style={{ padding: 28 }}>
          <h1 style={{ marginTop: 0 }}>Confirm your email</h1>
          <p className="muted">
            We sent a confirmation link to <strong>{pending}</strong>. Click it to activate your
            account, then log in.
          </p>
          {error && <div className="error">{error}</div>}
          {resent ? (
            <p className="muted">Sent again — check your inbox (and spam folder).</p>
          ) : (
            <p className="muted">
              Didn't get it?{" "}
              <button
                type="button"
                className="linkish-plain"
                style={{ color: "var(--green)" }}
                onClick={resend}
              >
                Resend the link
              </button>
              .
            </p>
          )}
          <p className="muted" style={{ marginTop: 16 }}>
            <Link to="/login" style={{ color: "var(--green)", fontWeight: 700 }}>
              Back to log in
            </Link>
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="center-narrow">
      <div className="card" style={{ padding: 28 }}>
        <h1 style={{ marginTop: 0 }}>Create your account</h1>
        {error && <div className="error">{error}</div>}
        <form onSubmit={submit}>
          <label>Create account as</label>
          <select value={form.role} onChange={set("role")}>
            <option value="customer">Book services (Customer)</option>
            <option value="provider">Offer services (Provider)</option>
          </select>

          <label>Full name</label>
          <input value={form.name} onChange={set("name")} required />

          <label>Email</label>
          <input type="email" value={form.email} onChange={set("email")} required />

          <label>Password</label>
          <input type="password" value={form.password} onChange={set("password")} required />

          <label>Phone (optional)</label>
          <input value={form.phone} onChange={set("phone")} placeholder="0541234567" />

          <label>{form.role === "provider" ? "Business location" : "Your hall / location"}</label>
          <input value={form.location} onChange={set("location")} placeholder="e.g. Unity Hall" />

          <button className="btn" style={{ width: "100%", marginTop: 18 }} disabled={busy}>
            {busy ? "Creating account…" : "Sign up"}
          </button>
        </form>
        <p className="muted" style={{ marginTop: 16 }}>
          Already have an account?{" "}
          <Link to="/login" style={{ color: "var(--green)", fontWeight: 700 }}>
            Log in
          </Link>
        </p>
      </div>
    </div>
  );
}
