import { CATEGORY_ICONS } from "../constants.js";

export const cedis = (n) => `GH₵ ${Number(n || 0).toFixed(2)}`;

export const STATUS_LABELS = {
  requested: "Requested",
  accepted: "Accepted",
  in_progress: "In Progress",
  out_for_delivery: "Out for Delivery",
  delivered: "Delivered",
  completed: "Completed",
  cancelled: "Cancelled",
};

export function StatusTag({ status }) {
  return <span className={`tag status-${status}`}>{STATUS_LABELS[status] || status}</span>;
}

export function Spinner({ label = "Loading…" }) {
  return <div className="empty">{label}</div>;
}

export function CategoryIcon({ id }) {
  return <span aria-hidden>{CATEGORY_ICONS[id] || "🔧"}</span>;
}
