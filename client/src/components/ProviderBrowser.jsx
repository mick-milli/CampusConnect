import { useEffect, useState } from "react";
import { api } from "../api.js";
import { Spinner, CategoryIcon } from "./common.jsx";
import ProviderCard from "./ProviderCard.jsx";

// Shared provider showcase used on both the public landing and the customer
// dashboard: a "Providers on campus" grid with the service tabs (category
// filter chips) right underneath. Customers pick a service tab, then choose the
// provider they prefer.
export default function ProviderBrowser({
  title = "Providers on campus",
  subtitle = null,
  showSearch = true,
  limit = null,
}) {
  const [providers, setProviders] = useState([]);
  const [categories, setCategories] = useState([]);
  const [category, setCategory] = useState(""); // "" = all
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get("/categories").then(setCategories).catch(() => {});
  }, []);

  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams();
    if (category) params.set("category", category);
    if (showSearch && q.trim()) params.set("q", q.trim());
    const qs = params.toString();
    api
      .get(`/providers${qs ? `?${qs}` : ""}`)
      .then(setProviders)
      .finally(() => setLoading(false));
  }, [category, q, showSearch]);

  const shown = limit ? providers.slice(0, limit) : providers;

  return (
    <>
      <div className="spread">
        <h2 className="section-title" style={{ margin: 0 }}>
          {title}
        </h2>
        {showSearch && (
          <input
            style={{ maxWidth: 260 }}
            placeholder="Search providers…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        )}
      </div>
      {subtitle && (
        <p className="muted" style={{ margin: "6px 0 0" }}>
          {subtitle}
        </p>
      )}

      {/* service tabs — filter the providers by the service area they work in */}
      <div className="chip-row" style={{ margin: "14px 0 4px" }}>
        <button
          className={`chip filter${category === "" ? " active" : ""}`}
          onClick={() => setCategory("")}
        >
          All
        </button>
        {categories.map((c) => (
          <button
            key={c.id}
            className={`chip filter${category === c.id ? " active" : ""}`}
            onClick={() => setCategory(c.id)}
          >
            <CategoryIcon id={c.id} icon={c.icon} /> {c.name}
          </button>
        ))}
      </div>

      {loading ? (
        <Spinner />
      ) : shown.length === 0 ? (
        <div className="empty">
          No providers{category || q ? " match your filters" : " yet"}.
        </div>
      ) : (
        <div className="grid cols-3" style={{ margin: "18px 0 30px" }}>
          {shown.map((p) => (
            <ProviderCard key={p.id} provider={p} />
          ))}
        </div>
      )}
    </>
  );
}
