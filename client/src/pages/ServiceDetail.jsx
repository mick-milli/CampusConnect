import { useEffect, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { api } from "../api.js";
import { useAuth } from "../auth.jsx";
import { cedis, CategoryIcon, Spinner } from "../components/common.jsx";

export default function ServiceDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [service, setService] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const [form, setForm] = useState({
    note: "",
    deliveryLocation: "",
    courier: true,
    payment: "cash",
  });

  useEffect(() => {
    api
      .get(`/services/${id}`)
      .then((s) => {
        setService(s);
        setForm((f) => ({ ...f, deliveryLocation: user?.location || "" }));
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [id, user]);

  const placeOrder = async (e) => {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      await api.post("/orders", { serviceId: id, ...form });
      navigate("/orders");
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <Spinner />;
  if (!service) return <div className="empty">{error || "Service not found."}</div>;

  return (
    <div style={{ margin: "26px 0" }}>
      <Link className="muted" to="/">
        ← Back to services
      </Link>

      <div className="grid cols-2" style={{ marginTop: 16, alignItems: "start" }}>
        <div className="card" style={{ padding: 24 }}>
          <div className="cat" style={{ color: "var(--green)", fontWeight: 700 }}>
            <CategoryIcon id={service.categoryId} /> {service.category?.name}
          </div>
          <h1 style={{ margin: "8px 0" }}>{service.title}</h1>
          <p className="muted">{service.description}</p>
          <hr style={{ border: "none", borderTop: "1px solid var(--line)", margin: "16px 0" }} />
          <div className="row spread">
            <div>
              <div className="muted" style={{ fontSize: 13 }}>
                Service provider
              </div>
              <strong>{service.provider?.name}</strong>
              <div className="muted" style={{ fontSize: 13 }}>
                📍 {service.provider?.location || "KNUST campus"}
              </div>
            </div>
            <div className="price" style={{ fontSize: 22 }}>
              {cedis(service.price)}
            </div>
          </div>
        </div>

        <form className="card" style={{ padding: 24 }} onSubmit={placeOrder}>
          <h2 style={{ marginTop: 0 }}>Request this service</h2>
          {!user ? (
            <p className="muted">
              Please{" "}
              <Link to="/login" style={{ color: "var(--green)", fontWeight: 700 }}>
                log in
              </Link>{" "}
              as a customer to place an order.
            </p>
          ) : user.role !== "customer" ? (
            <p className="muted">You are signed in as a provider. Log in as a customer to order.</p>
          ) : (
            <>
              {error && <div className="error">{error}</div>}
              <label>Notes / details for the provider</label>
              <textarea
                placeholder="e.g. 40-page document, colour cover, spiral binding"
                value={form.note}
                onChange={(e) => setForm({ ...form, note: e.target.value })}
              />

              <label>Delivery location on campus</label>
              <input
                placeholder="e.g. Republic Hall, Room 214"
                value={form.deliveryLocation}
                onChange={(e) => setForm({ ...form, deliveryLocation: e.target.value })}
              />

              <label className="row" style={{ marginTop: 14 }}>
                <input
                  type="checkbox"
                  style={{ width: 18 }}
                  checked={form.courier}
                  onChange={(e) => setForm({ ...form, courier: e.target.checked })}
                />
                Deliver to me via courier (otherwise I'll pick up)
              </label>

              <label>Payment method</label>
              <select
                value={form.payment}
                onChange={(e) => setForm({ ...form, payment: e.target.value })}
              >
                <option value="cash">Cash on delivery</option>
                <option value="momo">Mobile Money (mock — instant)</option>
              </select>

              <button className="btn" style={{ width: "100%", marginTop: 18 }} disabled={submitting}>
                {submitting ? "Placing order…" : `Place order · ${cedis(service.price)}`}
              </button>
            </>
          )}
        </form>
      </div>
    </div>
  );
}
