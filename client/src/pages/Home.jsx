import { useEffect, useState } from "react";
import { api } from "../api.js";
import ServiceCard from "../components/ServiceCard.jsx";
import { Spinner } from "../components/common.jsx";

export default function Home() {
  const [categories, setCategories] = useState([]);
  const [services, setServices] = useState([]);
  const [active, setActive] = useState("");
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get("/categories").then(setCategories).catch(() => {});
  }, []);

  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams();
    if (active) params.set("category", active);
    if (q) params.set("q", q);
    const qs = params.toString();
    api
      .get(`/services${qs ? `?${qs}` : ""}`)
      .then(setServices)
      .finally(() => setLoading(false));
  }, [active, q]);

  return (
    <>
      <section className="hero">
        <span className="badge">🎓 Built for KNUST campus</span>
        <h1>Campus services, delivered to your door.</h1>
        <p>
          Printing, food runs, repairs, tech help, photography and more — book any campus
          service on-demand and have it couriered to your hall.
        </p>
        <a className="btn gold" href="#browse">
          Browse services
        </a>
      </section>

      <div id="browse">
        <div className="spread">
          <h2 className="section-title" style={{ margin: 0 }}>
            Explore services
          </h2>
          <input
            style={{ maxWidth: 260 }}
            placeholder="Search services…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>

        <div className="chips" style={{ margin: "14px 0 22px" }}>
          <button className={`chip ${!active ? "active" : ""}`} onClick={() => setActive("")}>
            All
          </button>
          {categories.map((c) => (
            <button
              key={c.id}
              className={`chip ${active === c.id ? "active" : ""}`}
              onClick={() => setActive(c.id)}
              title={c.description}
            >
              {c.icon} {c.name}
            </button>
          ))}
        </div>

        {loading ? (
          <Spinner />
        ) : services.length === 0 ? (
          <div className="empty">No services found. Try a different category.</div>
        ) : (
          <div className="grid cols-3">
            {services.map((s) => (
              <ServiceCard key={s.id} service={s} />
            ))}
          </div>
        )}
      </div>
    </>
  );
}
