import { Link } from "react-router-dom";
import { cedis, CategoryIcon } from "./common.jsx";

export default function ServiceCard({ service }) {
  return (
    <div className="card service">
      <div className="cat">
        <CategoryIcon id={service.categoryId} /> {service.category?.name || service.categoryId}
      </div>
      <h3>{service.title}</h3>
      <div className="desc">{service.description}</div>
      <div className="muted" style={{ fontSize: 13 }}>
        by {service.provider?.name} · {service.provider?.location || "KNUST"}
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
