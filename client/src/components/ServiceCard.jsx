import { Link } from "react-router-dom";
import { cedis, CategoryIcon, RatingSummary } from "./common.jsx";
import ImageCarousel from "./ImageCarousel.jsx";

export default function ServiceCard({ service }) {
  const media = service.media?.length
    ? service.media
    : [{ url: `/images/categories/${service.categoryId}.jpg`, type: "image" }];
  return (
    <div className="card service">
      <ImageCarousel media={media} alt={service.title} height={150} />
      <div className="cat">
        <CategoryIcon id={service.categoryId} icon={service.category?.icon} />{" "}
        {service.category?.name || service.categoryId}
      </div>
      <h3>{service.title}</h3>
      <div className="desc">{service.description}</div>
      <div className="muted" style={{ fontSize: 13 }}>
        by {service.provider?.name} · {service.provider?.location || "KNUST"}
      </div>
      <div style={{ marginTop: 6 }}>
        <RatingSummary avg={service.ratingAvg} count={service.ratingCount} />
      </div>
      <div className="foot">
        <span className="price">{cedis(service.price)}</span>
        <Link className="btn sm" to={`/services/${service.id}`}>
          View & Order
        </Link>
      </div>
    </div>
  );
}
