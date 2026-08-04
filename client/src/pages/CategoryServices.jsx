import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../api.js";
import ServiceCard from "../components/ServiceCard.jsx";
import { Spinner, CategoryIcon } from "../components/common.jsx";

// Services within one category — prices and descriptions live here,
// one click away from the category tiles on the browse page.
export default function CategoryServices() {
  const { catId } = useParams();
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
        <input
          style={{ maxWidth: 260 }}
          placeholder="Search in this category…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>

      {loading ? (
        <Spinner />
      ) : services.length === 0 ? (
        <div className="empty">
          No services here yet{q ? " matching your search" : ""}. Check back soon!
        </div>
      ) : (
        <div className="grid cols-3">
          {services.map((s) => (
            <ServiceCard key={s.id} service={s} />
          ))}
        </div>
      )}
    </div>
  );
}
