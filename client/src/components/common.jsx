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

// Profile picture — the uploaded image, or a coloured initials circle as fallback.
export function Avatar({ user, size = 36 }) {
  const name = user?.name || "?";
  const initials = name
    .split(" ")
    .map((w) => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
  const style = { width: size, height: size, fontSize: Math.round(size * 0.4) };
  if (user?.avatar)
    return <img className="avatar" src={user.avatar} alt={name} style={style} />;
  return (
    <span className="avatar avatar-fallback" style={style} aria-hidden>
      {initials || "?"}
    </span>
  );
}

export function CategoryIcon({ id, icon }) {
  return <span aria-hidden>{icon || CATEGORY_ICONS[id] || "✨"}</span>;
}

// Read-only star row (fills to the nearest whole star of `value`).
export function Stars({ value = 0, size = 15 }) {
  const filled = Math.round(value);
  return (
    <span className="stars" style={{ fontSize: size }} aria-label={`${value} out of 5 stars`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <span key={n} className={n <= filled ? "star on" : "star"} aria-hidden>
          ★
        </span>
      ))}
    </span>
  );
}

// Compact "★★★★☆ 4.3 (18)" summary, or a muted placeholder when unrated.
export function RatingSummary({ avg = 0, count = 0, size = 14 }) {
  if (!count)
    return (
      <span className="muted" style={{ fontSize: 13 }}>
        No ratings yet
      </span>
    );
  return (
    <span className="rating-summary" style={{ fontSize: 13 }}>
      <Stars value={avg} size={size} /> <strong>{avg.toFixed(1)}</strong>{" "}
      <span className="muted">
        ({count} review{count === 1 ? "" : "s"})
      </span>
    </span>
  );
}

export function timeAgo(ts) {
  const secs = Math.floor((Date.now() - ts) / 1000);
  const units = [
    ["year", 31536000],
    ["month", 2592000],
    ["week", 604800],
    ["day", 86400],
    ["hour", 3600],
    ["minute", 60],
  ];
  for (const [name, s] of units) {
    const v = Math.floor(secs / s);
    if (v >= 1) return `${v} ${name}${v > 1 ? "s" : ""} ago`;
  }
  return "just now";
}
