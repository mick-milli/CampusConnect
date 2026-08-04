import { useEffect, useState } from "react";
import { api } from "../api.js";
import { useAuth } from "../auth.jsx";

export default function Payout() {
  const { user, updateUser } = useAuth();
  const current = user?.payout;

  const [method, setMethod] = useState(current?.method === "bank" ? "bank" : "mobile_money");
  const [banks, setBanks] = useState([]);
  const [loadingBanks, setLoadingBanks] = useState(false);
  const [form, setForm] = useState({
    bankCode: "",
    accountNumber: "",
    accountName: current?.accountName || user?.name || "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  // Reload the bank / network list whenever the payout method changes.
  useEffect(() => {
    setLoadingBanks(true);
    setError("");
    setBanks([]);
    api
      .get(`/payout/banks?type=${method === "bank" ? "bank" : "momo"}`)
      .then((list) => setBanks(list))
      .catch((e) => setError(e.message))
      .finally(() => setLoadingBanks(false));
  }, [method]);

  const set = (k) => (e) => {
    setForm({ ...form, [k]: e.target.value });
    setDone(false);
  };

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    setDone(false);
    setBusy(true);
    try {
      const bank = banks.find((b) => b.code === form.bankCode);
      const res = await api.post("/payout/recipient", {
        method,
        bankCode: form.bankCode,
        bankName: bank?.name || "",
        accountNumber: form.accountNumber,
        accountName: form.accountName,
      });
      updateUser(res.user);
      setForm((f) => ({ ...f, accountNumber: "" }));
      setDone(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const isBank = method === "bank";

  return (
    <div style={{ margin: "26px 0" }} className="center-narrow">
      <h1>Payout details</h1>
      <p className="muted" style={{ fontSize: 14, marginTop: -6 }}>
        Where we send your earnings once a customer confirms an order is complete.
      </p>

      {current?.ready && (
        <div className="card" style={{ padding: 18, marginBottom: 18 }}>
          <div className="muted" style={{ fontSize: 13 }}>Current payout destination</div>
          <div style={{ marginTop: 4, fontWeight: 700 }}>
            {current.method === "bank" ? "🏦 " : "📱 "}
            {current.bankName} {current.last4 ? `•••• ${current.last4}` : ""}
          </div>
          <div className="muted" style={{ fontSize: 13 }}>{current.accountName}</div>
        </div>
      )}

      <form className="card" style={{ padding: 24 }} onSubmit={submit}>
        <h2 style={{ marginTop: 0 }}>{current?.ready ? "Update destination" : "Add a destination"}</h2>
        {error && <div className="error">{error}</div>}
        {done && <div className="success">Payout details saved ✓</div>}

        <div className="pay-methods" style={{ marginBottom: 12 }}>
          {[
            ["mobile_money", "📱 Mobile Money"],
            ["bank", "🏦 Bank account"],
          ].map(([m, label]) => (
            <button
              type="button"
              key={m}
              className={`pay-method ${method === m ? "on" : ""}`}
              onClick={() => setMethod(m)}
            >
              {label}
            </button>
          ))}
        </div>

        <label>{isBank ? "Bank" : "Mobile money network"}</label>
        <select value={form.bankCode} onChange={set("bankCode")} required disabled={loadingBanks}>
          <option value="">{loadingBanks ? "Loading…" : `Select your ${isBank ? "bank" : "network"}`}</option>
          {banks.map((b) => (
            <option key={b.code} value={b.code}>
              {b.name}
            </option>
          ))}
        </select>

        <label>{isBank ? "Account number" : "Mobile money number"}</label>
        <input
          value={form.accountNumber}
          onChange={set("accountNumber")}
          placeholder={isBank ? "e.g. 1234567890123" : "e.g. 0541234567"}
          inputMode="numeric"
          required
        />

        <label>Account holder's name</label>
        <input
          value={form.accountName}
          onChange={set("accountName")}
          placeholder="Name on the account"
          required
        />

        <button className="btn" style={{ marginTop: 16 }} disabled={busy}>
          {busy ? "Saving…" : "Save payout details"}
        </button>
      </form>

      <p className="muted" style={{ fontSize: 12, marginTop: 12 }}>
        🔒 Your account details are stored securely with our payment provider (Paystack). Payouts
        are sent automatically when a customer confirms the work is done.
      </p>
    </div>
  );
}
