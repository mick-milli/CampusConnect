import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api.js";
import { useAuth } from "../auth.jsx";
import { cedis, StatusTag, STATUS_LABELS, Spinner } from "../components/common.jsx";

// What the provider can advance an order to next.
const PROVIDER_NEXT = {
  requested: ["accepted", "cancelled"],
  accepted: ["in_progress", "cancelled"],
  in_progress: ["out_for_delivery", "delivered"],
  out_for_delivery: ["delivered"],
  delivered: [],
  completed: [],
  cancelled: [],
};

function OrderCard({ order, role, onUpdate }) {
  const [busy, setBusy] = useState(false);

  const update = async (status) => {
    setBusy(true);
    try {
      const updated = await api.patch(`/orders/${order.id}/status`, { status });
      onUpdate(updated);
    } catch (e) {
      alert(e.message);
    } finally {
      setBusy(false);
    }
  };

  const nextSteps = role === "provider" ? PROVIDER_NEXT[order.status] || [] : [];
  const customerCanCancel = role === "customer" && ["requested", "accepted"].includes(order.status);
  const customerCanComplete = role === "customer" && order.status === "delivered";

  return (
    <div className="card" style={{ padding: 18 }}>
      <div className="spread">
        <div>
          <Link to={`/services/${order.serviceId}`}>
            <strong>{order.service?.title || "Service"}</strong>
          </Link>
          <div className="muted" style={{ fontSize: 13 }}>
            {role === "provider"
              ? `For ${order.customer?.name}`
              : `by ${order.provider?.name}`}{" "}
            · {new Date(order.createdAt).toLocaleString()}
          </div>
        </div>
        <StatusTag status={order.status} />
      </div>

      <div className="row" style={{ marginTop: 10, gap: 18, fontSize: 14 }}>
        <span className="price">{cedis(order.price)}</span>
        <span className="muted">
          {order.courier ? "🛵 Courier delivery" : "🚶 Self pickup"}
        </span>
        <span className="muted">
          💳 {order.payment?.method === "momo" ? "MoMo (paid)" : "Cash"}
        </span>
      </div>

      {order.deliveryLocation && (
        <div className="muted" style={{ fontSize: 13, marginTop: 6 }}>
          📍 Deliver to: {order.deliveryLocation}
        </div>
      )}
      {order.note && (
        <div style={{ fontSize: 14, marginTop: 6 }}>
          <span className="muted">Note:</span> {order.note}
        </div>
      )}

      {order.history?.length > 1 && (
        <ul className="timeline">
          {order.history.map((h, i) => (
            <li key={i}>
              <span className="dot" /> {STATUS_LABELS[h.status] || h.status} —{" "}
              <span className="muted">{new Date(h.at).toLocaleTimeString()}</span>
            </li>
          ))}
        </ul>
      )}

      {(nextSteps.length > 0 || customerCanCancel || customerCanComplete) && (
        <div className="row" style={{ marginTop: 14 }}>
          {nextSteps.map((s) => (
            <button
              key={s}
              className={`btn sm ${s === "cancelled" ? "danger" : ""}`}
              disabled={busy}
              onClick={() => update(s)}
            >
              {s === "cancelled" ? "Cancel" : `Mark ${STATUS_LABELS[s]}`}
            </button>
          ))}
          {customerCanComplete && (
            <button className="btn sm" disabled={busy} onClick={() => update("completed")}>
              Confirm received
            </button>
          )}
          {customerCanCancel && (
            <button className="btn sm danger" disabled={busy} onClick={() => update("cancelled")}>
              Cancel order
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export default function Orders() {
  const { user } = useAuth();
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .get("/orders")
      .then(setOrders)
      .finally(() => setLoading(false));
  }, []);

  const onUpdate = (updated) =>
    setOrders((prev) => prev.map((o) => (o.id === updated.id ? updated : o)));

  if (loading) return <Spinner />;

  return (
    <div style={{ margin: "26px 0" }}>
      <h1>{user.role === "provider" ? "Incoming Orders" : "My Orders"}</h1>
      {orders.length === 0 ? (
        <div className="empty">
          No orders yet.{" "}
          {user.role === "customer" && (
            <Link to="/" style={{ color: "var(--green)", fontWeight: 700 }}>
              Browse services →
            </Link>
          )}
        </div>
      ) : (
        <div className="grid" style={{ marginTop: 16 }}>
          {orders.map((o) => (
            <OrderCard key={o.id} order={o} role={user.role} onUpdate={onUpdate} />
          ))}
        </div>
      )}
    </div>
  );
}
