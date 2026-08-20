import { useEffect, useState } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { api } from "../api.js";
import ServiceCard from "../components/ServiceCard.jsx";
import { Spinner, Avatar, RatingSummary, CategoryIcon } from "../components/common.jsx";

// A provider's storefront: their profile up top, then every service they offer.
// Public so guests coming from the landing page can browse before signing in —
// ordering a service still routes through the customer-only order flow.
export default function ProviderStore() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [provider, setProvider] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    setLoading(true);
    api
      .get(`/providers/${id}`)
      .then(setProvider)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) return <Spinner />;
  if (!provider) return <div className="empty">{error || "Provider not found."}</div>;

  return (
    <div style={{ margin: "26px 0" }}>
      <button
        className="linkish-plain muted"
        onClick={() => (window.history.state?.idx > 0 ? navigate(-1) : navigate("/services"))}
      >
        ← Back to providers
      </button>

      <div className="card provider-hero" style={{ padding: 24, marginTop: 16 }}>
        <div className="provider-hero-main">
          <Avatar user={provider} size={72} />
          <div style={{ minWidth: 0 }}>
            <h1 style={{ margin: 0 }}>{provider.name}</h1>
            <div className="muted">📍 {provider.location || "KNUST campus"}</div>
            <div style={{ marginTop: 6 }}>
              <RatingSummary avg={provider.ratingAvg} count={provider.ratingCount} size={15} />
            </div>
          </div>
        </div>
        {provider.headline && (
          <p className="muted" style={{ margin: "14px 0 0" }}>
            {provider.headline}
          </p>
        )}
        {provider.categories.length > 0 && (
          <div className="provider-chips" style={{ marginTop: 12 }}>
            {provider.categories.map((c) => (
              <Link key={c.id} to={`/services/category/${c.id}`} className="chip">
                <CategoryIcon id={c.id} icon={c.icon} /> {c.name}
              </Link>
            ))}
          </div>
        )}
      </div>

      <h2 style={{ margin: "24px 0 12px" }}>
        Services ({provider.serviceCount})
      </h2>
      {provider.services?.length ? (
        <div className="grid cols-3">
          {provider.services.map((s) => (
            <ServiceCard key={s.id} service={s} />
          ))}
        </div>
      ) : (
        <div className="empty">This provider hasn't listed any services yet.</div>
      )}
    </div>
  );
}
