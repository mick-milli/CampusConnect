import { Link } from "react-router-dom";
import { Avatar, RatingSummary, CategoryIcon } from "./common.jsx";

// Alibaba-style storefront card: a provider is the unit you browse, not a lone
// service. Shows who they are, what they cover and how they're rated, then links
// into their storefront where all their listings live.
export default function ProviderCard({ provider }) {
  const cover =
    provider.thumbnail ||
    (provider.categories?.[0] ? `/images/categories/${provider.categories[0].id}.jpg` : null);

  return (
    <Link to={`/providers/${provider.id}`} className="card provider-card">
      <div className="provider-cover">
        {cover && (
          <img
            src={cover}
            alt={provider.name}
            loading="lazy"
            onError={(e) => (e.currentTarget.style.display = "none")}
          />
        )}
      </div>
      <div className="provider-body">
        <div className="provider-head">
          <Avatar user={provider} size={44} />
          <div style={{ minWidth: 0 }}>
            <strong className="provider-name">{provider.name}</strong>
            <div className="muted" style={{ fontSize: 13 }}>
              📍 {provider.location || "KNUST campus"}
            </div>
          </div>
        </div>

        {provider.headline && <p className="provider-headline muted">{provider.headline}</p>}

        <div className="provider-chips">
          {provider.categories.slice(0, 3).map((c) => (
            <span key={c.id} className="chip">
              <CategoryIcon id={c.id} icon={c.icon} /> {c.name}
            </span>
          ))}
          {provider.categories.length > 3 && (
            <span className="chip more">+{provider.categories.length - 3}</span>
          )}
        </div>

        <div className="provider-foot spread">
          <RatingSummary avg={provider.ratingAvg} count={provider.ratingCount} />
          <span className="muted" style={{ fontSize: 13 }}>
            {provider.serviceCount} service{provider.serviceCount === 1 ? "" : "s"}
          </span>
        </div>
      </div>
    </Link>
  );
}
