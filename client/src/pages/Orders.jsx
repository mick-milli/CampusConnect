import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api.js";
import { useAuth } from "../auth.jsx";
import { cedis, StatusTag, STATUS_LABELS, Spinner, Stars, Avatar } from "../components/common.jsx";
import OrderChat from "../components/OrderChat.jsx";

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

const METHOD_LABEL = { cash: "Cash", momo: "Mobile Money", card: "Card" };
const PAY_BADGE = {
  unpaid: { label: "Unpaid", cls: "pay-unpaid" },
  in_escrow: { label: "In escrow", cls: "pay-escrow" },
  released: { label: "Released", cls: "pay-released" },
  refunded: { label: "Refunded", cls: "pay-refunded" },
};
// A customer can fund the escrow once the provider has accepted (up to delivery).
const PAYABLE_STATUSES = ["accepted", "in_progress", "out_for_delivery", "delivered"];
// Work steps a provider can't reach until an online order's escrow is funded.
const WORK_STEPS = ["in_progress", "out_for_delivery", "delivered"];
const isOnline = (pay) => pay?.method === "momo" || pay?.method === "card";

const pct = (r) => `${Math.round((r || 0) * 100)}%`;
// Gross/fee/net for a payment. `fee`/`net` are locked in by the server at
// release; before that we estimate them from the current platform fee rate.
const feeSplit = (pay, feeRate) => {
  const gross = pay?.amount ?? 0;
  const fee = pay?.fee ?? Math.round(gross * (feeRate || 0) * 100) / 100;
  const net = pay?.net ?? Math.round((gross - fee) * 100) / 100;
  return { gross, fee, net };
};
// Reads as "still moving" while Paystack settles the refund, else past tense.
const refundVerb = (pay) =>
  ["pending", "processing"].includes(pay?.refund?.status) ? "is being refunded to" : "was refunded to";

// Pay entry point. With Paystack live, the customer picks a method and is sent
// to Paystack's secure checkout (card/MoMo details are entered there). Without
// keys configured, the same button simulates the charge for local dev.
function PayForm({ order, onUpdate, paystackEnabled }) {
  const pay = order.payment || {};
  const [method, setMethod] = useState(pay.method === "card" ? "card" : "momo");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const res = await api.post(`/orders/${order.id}/pay/init`, { method });
      if (res.mode === "paystack") {
        // Hand off to Paystack's secure checkout; it redirects back to /orders,
        // where the payment is verified.
        window.location.href = res.authorizationUrl;
        return; // navigating away — keep the button disabled
      }
      onUpdate(res.order); // simulated (dev fallback)
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <form className="pay-form" onSubmit={submit}>
      <div className="pay-methods">
        {["momo", "card"].map((m) => (
          <button
            type="button"
            key={m}
            className={`pay-method ${method === m ? "on" : ""}`}
            onClick={() => setMethod(m)}
          >
            {m === "momo" ? "📱 Mobile Money" : "💳 Card"}
          </button>
        ))}
      </div>

      {error && <div className="error">{error}</div>}
      <button className="btn sm" disabled={busy} style={{ marginTop: 4 }}>
        {busy
          ? paystackEnabled
            ? "Redirecting to Paystack…"
            : "Securing payment…"
          : `Pay ${cedis(pay.amount)} into escrow`}
      </button>
      <p className="muted" style={{ fontSize: 12, margin: "6px 0 0" }}>
        🔒 Held safely — released to the provider only when you confirm the work is done.{" "}
        {paystackEnabled
          ? "You'll complete payment securely on Paystack."
          : "Demo: this is a simulated charge, no real money moves."}
      </p>
      <p className="muted" style={{ fontSize: 12, margin: "6px 0 0" }}>
        ⚠️ Once you pay, this order can’t be cancelled. If the provider doesn’t deliver within 24
        hours, your money is automatically refunded to you from escrow.
      </p>
    </form>
  );
}

const PAYOUT_VIEW = {
  paid: { icon: "💸", text: "Paid out to you" },
  pending: { icon: "💸", text: "Payout processing…" },
  otp_required: { icon: "💸", text: "Payout pending approval" },
  awaiting_details: { icon: "⚠️", text: "Add your payout details to get paid" },
  failed: { icon: "⚠️", text: "Payout failed — check your details" },
};

// Provider-only payout status shown once an order's escrow is released.
function ProviderPayout({ order, onUpdate, feeRate }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const payout = order.payout || { status: "pending" };
  const view = PAYOUT_VIEW[payout.status] || PAYOUT_VIEW.pending;
  const canRetry = ["awaiting_details", "failed"].includes(payout.status);
  const { net } = feeSplit(order.payment, feeRate);

  const retry = async () => {
    setBusy(true);
    setError("");
    try {
      const updated = await api.post(`/orders/${order.id}/payout/retry`);
      onUpdate(updated);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <p className="pay-note muted">
        {view.icon} {view.text}
        {payout.status === "paid" ? ` — ${cedis(net)}` : ""}
      </p>
      {canRetry && (
        <div className="row" style={{ marginTop: 6 }}>
          <Link className="btn sm ghost" to="/settings/payout">
            Payout details
          </Link>
          <button className="btn sm" disabled={busy} onClick={retry}>
            {busy ? "Sending…" : "Retry payout"}
          </button>
        </div>
      )}
      {error && <div className="error">{error}</div>}
    </div>
  );
}

// Escrow status + (for the customer) the pay entry point. Cash orders skip this.
function PaymentSection({ order, role, onUpdate, paystackEnabled, feeRate }) {
  const pay = order.payment || {};
  if (!isOnline(pay)) return null;

  const badge = PAY_BADGE[pay.status] || PAY_BADGE.unpaid;
  const canPay =
    role === "customer" && pay.status === "unpaid" && PAYABLE_STATUSES.includes(order.status);
  const { fee, net } = feeSplit(pay, feeRate);

  return (
    <div className="pay-section">
      <div className="pay-status-line">
        <span className="muted" style={{ fontSize: 13 }}>🔒 Escrow</span>
        <span className={`pay-badge ${badge.cls}`}>{badge.label}</span>
      </div>

      {canPay && <PayForm order={order} onUpdate={onUpdate} paystackEnabled={paystackEnabled} />}

      {role === "customer" && pay.status === "unpaid" && order.status === "requested" && (
        <p className="pay-note muted">Payment opens once the provider accepts your order.</p>
      )}
      {role === "provider" && pay.status === "unpaid" && (
        <p className="pay-note muted">⏳ Waiting for the customer to fund escrow before work begins.</p>
      )}
      {pay.status === "in_escrow" && (
        <p className="pay-note muted">
          {role === "provider"
            ? order.status === "delivered"
              ? `✅ ${cedis(pay.amount)} held in escrow — you've marked this delivered. After the ${pct(feeRate)} platform fee (${cedis(fee)}) you'll receive ${cedis(net)} once the customer confirms.`
              : `✅ ${cedis(pay.amount)} secured in escrow — safe to start. After the ${pct(feeRate)} platform fee (${cedis(fee)}) you'll receive ${cedis(net)} once the customer confirms completion. This order can no longer be cancelled — deliver it within 24 hours, or the ${cedis(pay.amount)} is automatically refunded to the customer.`
            : order.status === "delivered"
              ? `✅ ${cedis(pay.amount)} held in escrow. The provider has marked this delivered — confirm you received the work to release payment, or flag it if something's wrong.`
              : `✅ ${cedis(pay.amount)} held in escrow, released to the provider when you confirm the work is done. This order can no longer be cancelled; if the provider doesn't deliver within 24 hours, your money is automatically refunded to you.`}
        </p>
      )}
      {/* Provider terms, shown before/while they work so it's never a surprise. */}
      {role === "provider" && ["unpaid", "in_escrow"].includes(pay.status) && (
        <p className="pay-note muted" style={{ fontSize: 12 }}>
          ℹ️ Terms: a {pct(feeRate)} platform fee is deducted on completion. Once the customer funds
          escrow the order can’t be cancelled — you must deliver within 24 hours, or the money is
          automatically refunded to the customer. Once you've delivered, that deadline stops and it's
          on the customer to confirm. If work is left uncompleted, the customer can also flag the
          order — after raising it with you in chat — for a full refund. Keep what you agree in the
          order chat; it's the record.
        </p>
      )}
      {pay.status === "released" &&
        (role === "provider" ? (
          <ProviderPayout order={order} onUpdate={onUpdate} feeRate={feeRate} />
        ) : (
          <p className="pay-note muted">Payment released to the provider. Thanks!</p>
        ))}
      {pay.status === "refunded" && (
        <p className="pay-note muted">
          {order.flag
            ? `⚑ Flagged as uncompleted work — ${cedis(pay.amount)} ${refundVerb(pay)} the customer in full.`
            : `${cedis(pay.amount)} ${refundVerb(pay)} the customer.`}
          {order.flag?.reason ? ` Reason: “${order.flag.reason}”` : ""}
        </p>
      )}
    </div>
  );
}

// Interactive star picker + comment for reviewing a completed order.
function ReviewForm({ order, onReviewed }) {
  const [rating, setRating] = useState(0);
  const [hover, setHover] = useState(0);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async (e) => {
    e.preventDefault();
    if (!rating) {
      setError("Please pick a star rating.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const review = await api.post(`/orders/${order.id}/review`, { rating, comment });
      onReviewed(order.id, review);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const shown = hover || rating;
  return (
    <form onSubmit={submit} style={{ marginTop: 12 }}>
      <div className="muted" style={{ fontSize: 13 }}>
        Rate this service
      </div>
      <div
        className="star-input"
        role="radiogroup"
        aria-label="Star rating"
        onMouseLeave={() => setHover(0)}
      >
        {[1, 2, 3, 4, 5].map((n) => (
          <span
            key={n}
            role="radio"
            aria-checked={rating === n}
            aria-label={`${n} star${n > 1 ? "s" : ""}`}
            tabIndex={0}
            className={n <= shown ? "star on" : "star"}
            onMouseEnter={() => setHover(n)}
            onClick={() => setRating(n)}
            onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && setRating(n)}
          >
            ★
          </span>
        ))}
      </div>
      <textarea
        placeholder="Share a few words about your experience (optional)"
        value={comment}
        maxLength={500}
        onChange={(e) => setComment(e.target.value)}
        style={{ marginTop: 8 }}
      />
      {error && <div className="error">{error}</div>}
      <button className="btn sm" disabled={busy} style={{ marginTop: 8 }}>
        {busy ? "Submitting…" : "Submit review"}
      </button>
    </form>
  );
}

function OrderCard({ order, role, me, onUpdate, onRemove, onReviewed, paystackEnabled, feeRate }) {
  const [busy, setBusy] = useState(false);
  const other = role === "provider" ? order.customer : order.provider;
  const otherName = other?.name;

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

  // Flag the order for uncompleted work → full refund. The server only allows
  // this once the customer has raised it in chat and the provider has replied
  // (or gone quiet past the grace window) — see order.flagState.
  const flag = async () => {
    const reason = window.prompt(
      "Briefly, what was left uncompleted? (optional — this is shared with the provider)"
    );
    if (reason === null) return; // dismissed the prompt
    if (
      !window.confirm(
        "Flag this order as uncompleted? You'll be refunded in full and the order will close."
      )
    )
      return;
    setBusy(true);
    try {
      const updated = await api.post(`/orders/${order.id}/flag`, { reason });
      onUpdate(updated);
    } catch (e) {
      alert(e.message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!window.confirm("Delete this cancelled order? It's removed for both you and the other party."))
      return;
    setBusy(true);
    try {
      await api.del(`/orders/${order.id}`);
      onRemove(order.id);
    } catch (e) {
      alert(e.message);
      setBusy(false);
    }
  };

  // Providers can accept/cancel before funding, but can't start *work* on an
  // online order until escrow is funded (payment happens after acceptance).
  const funded = order.payment?.status === "in_escrow";
  const escrowBlocked = role === "provider" && isOnline(order.payment) && order.payment?.status === "unpaid";
  let nextSteps = role === "provider" ? PROVIDER_NEXT[order.status] || [] : [];
  if (escrowBlocked) nextSteps = nextSteps.filter((s) => !WORK_STEPS.includes(s));
  // Once money is in escrow the order is locked in — neither party can cancel it.
  if (funded) nextSteps = nextSteps.filter((s) => s !== "cancelled");
  const customerCanCancel =
    role === "customer" && ["requested", "accepted"].includes(order.status) && !funded;
  const customerCanComplete = role === "customer" && order.status === "delivered";
  // The server decides whether/why the customer can flag right now: "eligible"
  // shows the button; "raise"/"wait" show a nudge to talk to the provider first.
  const flagStage = role === "customer" ? order.flagState?.stage : null;
  const customerCanFlag = flagStage === "eligible";

  return (
    <div className="card" style={{ padding: 18 }}>
      <div className="spread">
        <div style={{ minWidth: 0 }}>
          <Link to={`/services/${order.serviceId}`}>
            <strong>{order.service?.title || "Service"}</strong>
          </Link>
          <div className="order-party">
            <Avatar user={other} size={34} />
            <div style={{ minWidth: 0 }}>
              <div className="muted" style={{ fontSize: 13 }}>
                {role === "provider" ? "For" : "by"} <strong>{otherName}</strong> ·{" "}
                {new Date(order.createdAt).toLocaleDateString()}
              </div>
              {other?.bio && <div className="party-bio muted">“{other.bio}”</div>}
            </div>
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
          💳 {METHOD_LABEL[order.payment?.method] || "Cash"}
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

      <PaymentSection
        order={order}
        role={role}
        onUpdate={onUpdate}
        paystackEnabled={paystackEnabled}
        feeRate={feeRate}
      />

      {(nextSteps.length > 0 || customerCanCancel || customerCanComplete || customerCanFlag) && (
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
          {customerCanFlag && (
            <button className="btn sm danger" disabled={busy} onClick={flag}>
              ⚑ Flag uncompleted work
            </button>
          )}
          {customerCanCancel && (
            <button className="btn sm danger" disabled={busy} onClick={() => update("cancelled")}>
              Cancel order
            </button>
          )}
        </div>
      )}

      {flagStage === "raise" && (
        <p className="pay-note muted" style={{ marginTop: 8, fontSize: 12 }}>
          Not what you agreed? Message the provider in the chat below to raise it — once they reply,
          or if there's no response within 24 hours, you'll be able to flag the order for a full refund.
        </p>
      )}
      {flagStage === "wait" && (
        <p className="pay-note muted" style={{ marginTop: 8, fontSize: 12 }}>
          You've raised this with the provider. If it's still unresolved you can flag for a full refund
          {order.flagState?.until
            ? ` after ${new Date(order.flagState.until).toLocaleString()}`
            : " once they've had 24 hours to respond"}
          .
        </p>
      )}

      {order.status === "cancelled" && (
        <div className="row" style={{ marginTop: 14 }}>
          <button className="btn sm danger" disabled={busy} onClick={remove}>
            🗑 Delete order
          </button>
        </div>
      )}

      {!["completed", "cancelled"].includes(order.status) && (
        <OrderChat
          orderId={order.id}
          me={me}
          otherName={otherName}
          unread={order.unread || 0}
          onSeen={() => order.unread && onUpdate({ ...order, unread: 0 })}
        />
      )}

      {role === "customer" && order.status === "completed" && (
        order.review ? (
          <div style={{ marginTop: 12 }}>
            <span className="muted" style={{ fontSize: 13 }}>
              Your review:
            </span>{" "}
            <Stars value={order.review.rating} />
            {order.review.comment && (
              <div style={{ fontSize: 14, marginTop: 4 }}>{order.review.comment}</div>
            )}
          </div>
        ) : (
          <ReviewForm order={order} onReviewed={onReviewed} />
        )
      )}
    </div>
  );
}

export default function Orders() {
  const { user } = useAuth();
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [paystackEnabled, setPaystackEnabled] = useState(false);
  const [feeRate, setFeeRate] = useState(0);
  const [payMsg, setPayMsg] = useState("");

  useEffect(() => {
    api
      .get("/orders")
      .then(setOrders)
      .finally(() => setLoading(false));
    api
      .get("/config")
      .then((c) => {
        setPaystackEnabled(!!c.paystackEnabled);
        setFeeRate(c.platformFeeRate || 0);
      })
      .catch(() => {});
    // Refresh in the background so status changes and unread badges show up.
    const t = setInterval(() => api.get("/orders").then(setOrders).catch(() => {}), 15000);
    return () => clearInterval(t);
  }, []);

  const onUpdate = (updated) =>
    setOrders((prev) => prev.map((o) => (o.id === updated.id ? updated : o)));

  const onRemove = (id) => setOrders((prev) => prev.filter((o) => o.id !== id));

  const onReviewed = (orderId, review) =>
    setOrders((prev) => prev.map((o) => (o.id === orderId ? { ...o, review } : o)));

  // Returning from Paystack's checkout — verify the payment by its reference,
  // then strip the query so a refresh doesn't re-trigger it.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const reference = params.get("reference") || params.get("trxref");
    if (!reference) return;
    window.history.replaceState({}, "", window.location.pathname);
    api
      .post("/pay/verify", { reference })
      .then((updated) => {
        onUpdate(updated);
        setPayMsg("✅ Payment received — your money is held safely in escrow.");
      })
      .catch((e) => setPayMsg(`⚠️ ${e.message}`));
  }, []);

  if (loading) return <Spinner />;

  return (
    <div style={{ margin: "26px 0" }}>
      <h1>{user.role === "provider" ? "Incoming Orders" : "My Orders"}</h1>
      {payMsg && (
        <div className={payMsg.startsWith("⚠️") ? "error" : "success"} style={{ marginBottom: 14 }}>
          {payMsg}
        </div>
      )}
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
            <OrderCard
              key={o.id}
              order={o}
              role={user.role}
              me={user.id}
              onUpdate={onUpdate}
              onRemove={onRemove}
              onReviewed={onReviewed}
              paystackEnabled={paystackEnabled}
              feeRate={feeRate}
            />
          ))}
        </div>
      )}
    </div>
  );
}
