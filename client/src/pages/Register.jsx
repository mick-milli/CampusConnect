import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../auth.jsx";

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

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const user = await register(form);
      navigate(user.role === "provider" ? "/dashboard" : "/");
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="center-narrow">
      <div className="card" style={{ padding: 28 }}>
        <h1 style={{ marginTop: 0 }}>Create your account</h1>
        {error && <div className="error">{error}</div>}
        <form onSubmit={submit}>
          <label>I want to…</label>
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
