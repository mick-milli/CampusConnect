import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api.js";
import { useAuth } from "../auth.jsx";
import { Spinner } from "../components/common.jsx";

// Customer browse page: mirrors the landing page's category tiles (photo,
// name, short description — no prices). Services only appear after clicking
// into a category.
export default function Home() {
  const { user } = useAuth();
  const [categories, setCategories] = useState([]);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .get("/categories")
      .then(setCategories)
      .finally(() => setLoading(false));
  }, []);

  const needle = q.trim().toLowerCase();
  const shown = needle
    ? categories.filter(
        (c) =>
          c.name.toLowerCase().includes(needle) ||
          (c.description || "").toLowerCase().includes(needle)
      )
    : categories;

  return (
    <>
      <section className="hero compact">
        <span className="badge">🎓 KNUST campus marketplace</span>
        <h1>Welcome back{user ? `, ${user.name.split(" ")[0]}` : ""}.</h1>
        <p>What do you need done today? Pick a category to see its services.</p>
      </section>

      <div className="spread">
        <h2 className="section-title" style={{ margin: 0 }}>
          Explore categories
        </h2>
        <input
          style={{ maxWidth: 260 }}
          placeholder="Search categories…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>

      {loading ? (
        <Spinner />
      ) : shown.length === 0 ? (
        <div className="empty">No categories match your search.</div>
      ) : (
        <div className="cat-grid" style={{ margin: "18px 0 30px" }}>
          {shown.map((c) => (
            <Link key={c.id} to={`/services/category/${c.id}`} className="card cat-tile">
              <span className="cat-icon">{c.icon}</span>
              <strong>{c.name}</strong>
              <span className="muted">{c.description}</span>
              <img
                className="cat-photo"
                src={`/images/categories/${c.id}.jpg`}
                alt={c.name}
                loading="lazy"
                onError={(e) => (e.currentTarget.style.display = "none")}
              />
            </Link>
          ))}
        </div>
      )}
    </>
  );
}
