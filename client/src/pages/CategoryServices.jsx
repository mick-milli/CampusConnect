import { useEffect, useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { api } from "../api.js";
import ServiceCard from "../components/ServiceCard.jsx";
import { Spinner, CategoryIcon, cedis } from "../components/common.jsx";

// Category browse, provider-first: a category lists the service *types* offered
// in it; picking a type reveals the providers offering that particular service
// (each of whom may offer others too).
export default function CategoryServices() {
  const { catId } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const type = searchParams.get("type") || "";
  const [category, setCategory] = useState(null);
  const [services, setServices] = useState([]);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .get("/categories")
      .then((cats) => setCategory(cats.find((c) => c.id === catId) || null))
      .catch(() => {});
  }, [catId]);

  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams({ category: catId });
    if (q) params.set("q", q);
    api
      .get(`/services?${params}`)
      .then(setServices)
      .finally(() => setLoading(false));
  }, [catId, q]);

  // Group listings by their shared service type so several providers offering
  // the same thing collapse into a single tile.
  const groups = useMemo(() => {
    const map = new Map();
    for (const s of services) {
      const key = s.serviceType || s.title;
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(s);
    }
    return [...map.entries()]
      .map(([name, items]) => ({
        name,
        providers: new Set(items.map((i) => i.provider?.id)).size,
        from: Math.min(...items.map((i) => i.price || 0)),
        icon: items[0]?.category?.icon,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [services]);

  const selected = type ? services.filter((s) => (s.serviceType || s.title) === type) : [];

  const setType = (t) => {
    const next = new URLSearchParams(searchParams);
    if (t) next.set("type", t);
    else next.delete("type");
    setSearchParams(next);
  };

  return (
    <div style={{ margin: "26px 0" }}>
      <Link to="/services" className="muted" style={{ fontSize: 14, fontWeight: 600 }}>
        ← All categories
      </Link>

      <div className="spread" style={{ margin: "14px 0 20px" }}>
        <div>
          <h1 style={{ margin: 0 }}>
            <CategoryIcon id={catId} icon={category?.icon} /> {category?.name || "Services"}
          </h1>
          {category?.description && (
            <p className="muted" style={{ margin: "6px 0 0" }}>
              {category.description}
            </p>
          )}
        </div>
        {!type && (
          <input
            style={{ maxWidth: 260 }}
            placeholder="Search in this category…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        )}
      </div>

      {loading ? (
        <Spinner />
      ) : type ? (
        // ---- providers offering the chosen service type ----
        <>
          <button className="linkish-plain muted" onClick={() => setType("")}>
            ← All {category?.name || "category"} services
          </button>
          <h2 style={{ margin: "10px 0 4px" }}>Providers offering “{type}”</h2>
          <p className="muted" style={{ marginTop: 0 }}>
            {selected.length} listing{selected.length === 1 ? "" : "s"} — each provider may offer
            other services too.
          </p>
          {selected.length === 0 ? (
            <div className="empty">No providers offer this right now.</div>
          ) : (
            <div className="grid cols-3">
              {selected.map((s) => (
                <ServiceCard key={s.id} service={s} />
              ))}
            </div>
          )}
        </>
      ) : groups.length === 0 ? (
        <div className="empty">
          No services here yet{q ? " matching your search" : ""}. Check back soon!
        </div>
      ) : (
        // ---- service types offered in this category ----
        <div className="cat-grid">
          {groups.map((g) => (
            <button
              key={g.name}
              className="card cat-tile type-tile"
              onClick={() => setType(g.name)}
            >
              <span className="cat-icon">{g.icon || "✨"}</span>
              <strong>{g.name}</strong>
              <span className="muted">
                {g.providers} provider{g.providers === 1 ? "" : "s"} · from {cedis(g.from)}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
