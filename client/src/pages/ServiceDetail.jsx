import { useEffect, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { api } from "../api.js";
import { useAuth } from "../auth.jsx";
import { cedis, CategoryIcon, Spinner, Stars, RatingSummary, timeAgo, Avatar } from "../components/common.jsx";
import ImageCarousel from "../components/ImageCarousel.jsx";

export default function ServiceDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [service, setService] = useState(null);
  const [reviews, setReviews] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const [form, setForm] = useState({
    note: "",
    deliveryLocation: "",
    courier: true,
    payment: "momo",
  });

  useEffect(() => {
    api
      .get(`/services/${id}`)
      .then((s) => {
        setService(s);
        setForm((f) => ({ ...f, deliveryLocation: user?.location || "" }));
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
    api
      .get(`/services/${id}/reviews`)
      .then(setReviews)
      .catch(() => setReviews([]));
  }, [id, user]);

  const placeOrder = async (e) => {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      await api.post("/orders", { serviceId: id, ...form });
      navigate("/orders");
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <Spinner />;
  if (!service) return <div className="empty">{error || "Service not found."}</div>;

  return (
    <div style={{ margin: "26px 0" }}>
      <button
        className="linkish-plain muted"
        onClick={() =>
          window.history.state?.idx > 0 ? navigate(-1) : navigate("/services")
        }
      >
        ← Back to services
      </button>

      <div className="grid cols-2" style={{ marginTop: 16, alignItems: "start" }}>
        <div className="card" style={{ padding: 24 }}>
          <ImageCarousel
            media={
              service.media?.length
                ? service.media
                : [{ url: `/images/categories/${service.categoryId}.jpg`, type: "image" }]
            }
            alt={service.title}
            height={240}
          />
          <div className="cat" style={{ color: "var(--green)", fontWeight: 700, marginTop: 14 }}>
            <CategoryIcon id={service.categoryId} icon={service.category?.icon} />{" "}
            {service.category?.name}
          </div>
          <h1 style={{ margin: "8px 0" }}>{service.title}</h1>
          <div style={{ margin: "2px 0 8px" }}>
            <RatingSummary avg={service.ratingAvg} count={service.ratingCount} size={15} />
          </div>
          <p className="muted">{service.description}</p>
          <hr style={{ border: "none", borderTop: "1px solid var(--line)", margin: "16px 0" }} />
          <div className="row spread">
            <div className="order-party">
              <Avatar user={service.provider} size={44} />
              <div style={{ minWidth: 0 }}>
                <div className="muted" style={{ fontSize: 13 }}>
                  Service provider
                </div>
                <strong>{service.provider?.name}</strong>
                <div className="muted" style={{ fontSize: 13 }}>
                  📍 {service.provider?.location || "KNUST campus"}
                </div>
              </div>
            </div>
            <div className="price" style={{ fontSize: 22 }}>
              {cedis(service.price)}
            </div>
          </div>
          {service.provider?.bio && (
            <p className="muted" style={{ fontSize: 14, marginTop: 10 }}>
              “{service.provider.bio}”
            </p>
          )}
        </div>

        <form className="card" style={{ padding: 24 }} onSubmit={placeOrder}>
          <h2 style={{ marginTop: 0 }}>Request this service</h2>
          {!user ? (
            <p className="muted">
              Please{" "}
              <Link to="/login" style={{ color: "var(--green)", fontWeight: 700 }}>
                log in
              </Link>{" "}
              as a customer to place an order.
            </p>
          ) : user.role !== "customer" ? (
            <p className="muted">You are signed in as a provider. Log in as a customer to order.</p>
          ) : (
            <>
              {error && <div className="error">{error}</div>}
              <label>Notes / details for the provider</label>
              <textarea
                placeholder="e.g. 40-page document, colour cover, spiral binding"
                value={form.note}
                onChange={(e) => setForm({ ...form, note: e.target.value })}
              />

              <label>Delivery location on campus</label>
              <input
                placeholder="e.g. Republic Hall, Room 214"
                value={form.deliveryLocation}
                onChange={(e) => setForm({ ...form, deliveryLocation: e.target.value })}
              />

              <label className="row" style={{ marginTop: 14 }}>
                <input
                  type="checkbox"
                  style={{ width: 18 }}
                  checked={form.courier}
                  onChange={(e) => setForm({ ...form, courier: e.target.checked })}
                />
                Deliver to me via courier (otherwise I'll pick up)
              </label>

              <label>Payment method</label>
              <select
                value={form.payment}
                onChange={(e) => setForm({ ...form, payment: e.target.value })}
              >
                <option value="momo">Mobile Money</option>
                <option value="card">Debit / Credit card</option>
              </select>
              <p className="muted" style={{ fontSize: 13, marginTop: 8 }}>
                🔒 You'll pay after the provider accepts. Funds are held in
                escrow and released to them only once you confirm the work is done.
                Once you've paid, the order can't be cancelled — but if the provider
                doesn't deliver within 24 hours, your money is automatically refunded to you.
              </p>

              <button className="btn" style={{ width: "100%", marginTop: 18 }} disabled={submitting}>
                {submitting ? "Placing order…" : `Place order · ${cedis(service.price)}`}
              </button>
            </>
          )}
        </form>
      </div>

      <div className="card" style={{ padding: 24, marginTop: 20 }}>
        <div className="spread">
          <h2 style={{ margin: 0 }}>Reviews</h2>
          <RatingSummary avg={service.ratingAvg} count={service.ratingCount} size={16} />
        </div>
        {reviews.length === 0 ? (
          <p className="muted" style={{ marginTop: 12 }}>
            No reviews yet. Order this service and you can be the first to review it.
          </p>
        ) : (
          <ul className="review-list">
            {reviews.map((r) => (
              <li key={r.id} className="review">
                <div className="spread">
                  <strong>{r.authorName}</strong>
                  <Stars value={r.rating} />
                </div>
                {r.comment && <p style={{ margin: "6px 0 0" }}>{r.comment}</p>}
                <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                  {timeAgo(r.createdAt)}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
