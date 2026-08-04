import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api.js";
import { useAuth } from "../auth.jsx";
import { cedis, Spinner } from "../components/common.jsx";

// How each order's money reads in the transactions list.
function txnChip(o) {
  const pay = o.payment || {};
  if (pay.method === "cash") return { label: "Cash · in person", cls: "pay-cash" };
  if (pay.status === "refunded") return { label: "Refunded", cls: "pay-refunded" };
  if (pay.status === "in_escrow") return { label: "In escrow", cls: "pay-escrow" };
  if (pay.status === "released") {
    switch (o.payout?.status) {
      case "paid":
        return { label: "Paid out", cls: "pay-released" };
      case "awaiting_details":
        return { label: "Add payout details", cls: "pay-unpaid" };
      case "failed":
        return { label: "Payout failed", cls: "pay-refunded" };
      default:
        return { label: "Payout processing", cls: "pay-escrow" };
    }
  }
  return { label: "Unpaid", cls: "pay-unpaid" };
}

function StatCard({ label, value, hint, accent }) {
  return (
    <div className="card" style={{ padding: 20 }}>
      <div className="muted" style={{ fontSize: 13 }}>{label}</div>
      <div style={{ fontSize: 26, fontWeight: 800, marginTop: 4, color: accent }}>{value}</div>
      {hint && <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>{hint}</div>}
    </div>
  );
}

export default function Earnings() {
  const { user } = useAuth();
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .get("/orders")
      .then(setOrders)
      .finally(() => setLoading(false));
  }, []);

  const sum = useMemo(() => {
    const s = { paidOut: 0, inEscrow: 0, awaiting: 0, cash: 0, actionNeeded: 0 };
    for (const o of orders) {
      const pay = o.payment || {};
      const amt = pay.amount ?? o.price ?? 0;
      if (pay.method === "cash") {
        if (o.status === "completed") s.cash += o.price || 0;
        continue;
      }
      if (pay.status === "in_escrow") s.inEscrow += amt;
      else if (pay.status === "released") {
        if (o.payout?.status === "paid") s.paidOut += amt;
        else {
          s.awaiting += amt;
          if (["awaiting_details", "failed"].includes(o.payout?.status)) s.actionNeeded += 1;
        }
      }
    }
    return s;
  }, [orders]);

  // Every order that has (or had) money moving through the system, newest first.
  const txns = useMemo(
    () =>
      orders
        .filter(
          (o) =>
            ["in_escrow", "released", "refunded"].includes(o.payment?.status) ||
            (o.payment?.method === "cash" && o.status === "completed")
        )
        .sort((a, b) => b.createdAt - a.createdAt),
    [orders]
  );

  if (loading) return <Spinner />;

  const payoutReady = user?.payout?.ready;

  return (
    <div style={{ margin: "26px 0" }}>
      <h1>Earnings &amp; payouts</h1>

      {!payoutReady && (
        <div className="card" style={{ padding: 16, marginBottom: 16, borderColor: "var(--gold)" }}>
          ⚠️ You haven't set a payout destination yet.{" "}
          <Link to="/settings/payout" style={{ color: "var(--green)", fontWeight: 700 }}>
            Add payout details →
          </Link>{" "}
          so your released earnings can reach you.
        </div>
      )}
      {payoutReady && sum.actionNeeded > 0 && (
        <div className="card" style={{ padding: 16, marginBottom: 16, borderColor: "var(--gold)" }}>
          ⚠️ {sum.actionNeeded} payout{sum.actionNeeded > 1 ? "s need" : " needs"} attention.{" "}
          <Link to="/orders" style={{ color: "var(--green)", fontWeight: 700 }}>
            Review in orders →
          </Link>
        </div>
      )}

      <div className="grid cols-3" style={{ marginBottom: 10 }}>
        <StatCard label="Paid out to you" value={cedis(sum.paidOut)} accent="var(--green)" hint="Completed transfers" />
        <StatCard label="Held in escrow" value={cedis(sum.inEscrow)} hint="Yours once the order is confirmed" />
        <StatCard label="Awaiting payout" value={cedis(sum.awaiting)} hint="Released, transfer pending" />
      </div>
      <div className="grid cols-2" style={{ marginBottom: 24 }}>
        <StatCard label="Cash collected" value={cedis(sum.cash)} hint="Paid to you in person" />
        <StatCard
          label="Lifetime received"
          value={cedis(sum.paidOut + sum.cash)}
          accent="var(--green)"
          hint="Transfers + cash"
        />
      </div>

      <h2 style={{ margin: "0 0 12px" }}>Transactions</h2>
      {txns.length === 0 ? (
        <div className="empty">No transactions yet. Earnings show up here once customers pay.</div>
      ) : (
        <div className="card" style={{ padding: 0 }}>
          <ul className="txn-list">
            {txns.map((o) => {
              const chip = txnChip(o);
              return (
                <li key={o.id} className="txn-row">
                  <div style={{ minWidth: 0 }}>
                    <Link to="/orders" className="txn-title">
                      {o.service?.title || "Service"}
                    </Link>
                    <div className="muted" style={{ fontSize: 12 }}>
                      {o.customer?.name ? `${o.customer.name} · ` : ""}
                      {new Date(o.createdAt).toLocaleDateString()}
                    </div>
                  </div>
                  <div className="txn-right">
                    <span className="txn-amount">{cedis(o.payment?.amount ?? o.price)}</span>
                    <span className={`pay-badge ${chip.cls}`}>{chip.label}</span>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
