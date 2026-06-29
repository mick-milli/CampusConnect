import { useEffect, useState } from "react";
import { api } from "../api.js";
import { cedis, CategoryIcon, Spinner } from "../components/common.jsx";

export default function ProviderDashboard() {
  const [services, setServices] = useState([]);
  const [categories, setCategories] = useState([]);
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [form, setForm] = useState({ title: "", description: "", price: "", categoryId: "" });

  const load = () =>
    Promise.all([api.get("/services/mine"), api.get("/categories"), api.get("/orders")]).then(
      ([s, c, o]) => {
        setServices(s);
        setCategories(c);
        setOrders(o);
        if (!form.categoryId && c[0]) setForm((f) => ({ ...f, categoryId: c[0].id }));
      }
    );

  useEffect(() => {
    load().finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const create = async (e) => {
    e.preventDefault();
    setError("");
    setMsg("");
    try {
      const created = await api.post("/services", form);
      setServices((prev) => [created, ...prev]);
      setForm({ title: "", description: "", price: "", categoryId: categories[0]?.id || "" });
      setMsg("Service published! It's now live on the marketplace.");
    } catch (err) {
      setError(err.message);
    }
  };

  const toggle = async (svc) => {
    const updated = await api.patch(`/services/${svc.id}`, { active: !svc.active });
    setServices((prev) => prev.map((s) => (s.id === svc.id ? updated : s)));
  };

  if (loading) return <Spinner />;

  const pending = orders.filter((o) => !["completed", "cancelled"].includes(o.status)).length;
  const earnings = orders
    .filter((o) => o.status === "completed")
    .reduce((sum, o) => sum + (o.price || 0), 0);

  return (
    <div style={{ margin: "26px 0" }}>
      <h1>Provider Dashboard</h1>

      <div className="grid cols-3" style={{ marginBottom: 24 }}>
        <Stat label="Active listings" value={services.filter((s) => s.active).length} />
        <Stat label="Open orders" value={pending} />
        <Stat label="Earnings (completed)" value={cedis(earnings)} />
      </div>

      <div className="grid cols-2" style={{ alignItems: "start" }}>
        <form className="card" style={{ padding: 22 }} onSubmit={create}>
          <h2 style={{ marginTop: 0 }}>Add a service</h2>
          {error && <div className="error">{error}</div>}
          {msg && <div className="success">{msg}</div>}
          <label>Category</label>
          <select value={form.categoryId} onChange={set("categoryId")}>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.icon} {c.name}
              </option>
            ))}
          </select>
          <label>Title</label>
          <input value={form.title} onChange={set("title")} required placeholder="e.g. Same-day printing" />
          <label>Description</label>
          <textarea value={form.description} onChange={set("description")} />
          <label>Price (GH₵)</label>
          <input type="number" min="0" step="0.5" value={form.price} onChange={set("price")} />
          <button className="btn" style={{ width: "100%", marginTop: 16 }}>
            Publish service
          </button>
        </form>

        <div>
          <h2 style={{ marginTop: 0 }}>Your listings</h2>
          {services.length === 0 ? (
            <div className="empty">No services yet — add your first one.</div>
          ) : (
            <div className="grid">
              {services.map((s) => (
                <div key={s.id} className="card" style={{ padding: 16 }}>
                  <div className="spread">
                    <div>
                      <div className="cat" style={{ color: "var(--green)", fontSize: 12, fontWeight: 700 }}>
                        <CategoryIcon id={s.categoryId} /> {s.category?.name}
                      </div>
                      <strong>{s.title}</strong>
                      <div className="muted" style={{ fontSize: 13 }}>
                        {cedis(s.price)} {s.active ? "" : "· (hidden)"}
                      </div>
                    </div>
                    <button className="btn ghost sm" onClick={() => toggle(s)}>
                      {s.active ? "Hide" : "Show"}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <div className="card" style={{ padding: 20 }}>
      <div className="muted" style={{ fontSize: 13 }}>
        {label}
      </div>
      <div style={{ fontSize: 26, fontWeight: 800, marginTop: 4 }}>{value}</div>
    </div>
  );
}
