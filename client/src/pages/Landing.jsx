import { Link, useNavigate } from "react-router-dom";

// Static copy of the seeded marketplace categories so the landing page
// renders instantly and offline. Providers can add more once signed up.
const CATEGORIES = [
  { id: "printing", name: "Printing", icon: "🖨️", blurb: "Print, copy & bind — delivered" },
  { id: "gas", name: "Gas (LPG) Refill", icon: "🔥", blurb: "Cylinder pickup, refill & return" },
  { id: "repairs", name: "Phone & Laptop Repairs", icon: "🛠️", blurb: "Screens, batteries & software fixes" },
  { id: "rentals", name: "Item & Gadget Rentals", icon: "🧰", blurb: "Gaming consoles & pads, irons, electric kettles & more" },
  { id: "secondhand", name: "Secondhand Buy & Sell", icon: "♻️", blurb: "Pre-owned books, gadgets & essentials" },
  { id: "tech", name: "Tech & Digital", icon: "💻", blurb: "Dev, design & IT support" },
  { id: "creative", name: "Creative & Media", icon: "📸", blurb: "Photo, video & editing" },
  { id: "courier", name: "Courier & Delivery", icon: "📦", blurb: "Campus-wide pickup & drop-off" },
  { id: "event", name: "Event-Based", icon: "🎉", blurb: "Planning, décor, MCs & DJs" },
  { id: "beauty", name: "Personal & Beauty", icon: "💇", blurb: "Hair, makeup & nails at home" },
];

const STEPS = [
  {
    icon: "🔎",
    title: "Tell us what you need",
    text: "Pick a service — a print job, a food run, a room clean — and describe the task in seconds.",
  },
  {
    icon: "🤝",
    title: "Get matched with a provider",
    text: "Verified student and staff providers on campus accept your order and get to work.",
  },
  {
    icon: "🚀",
    title: "Delivered to your hall/hostel",
    text: "Track every step from accepted to out-for-delivery, then pay with MoMo or cash.",
  },
];

const PERKS = [
  { icon: "🎓", title: "Campus-verified providers", text: "Every provider signs up with a KNUST identity, so you know who you're dealing with." },
  { icon: "📍", title: "Hall/hostel-to-hall/hostel courier", text: "Anything you order can be couriered anywhere on campus — Unity, Katanga, Africa Hall and beyond." },
  { icon: "📱", title: "MoMo & cash payments", text: "Pay the way campus already pays. No cards required, no surprises." },
  { icon: "🕒", title: "Live order tracking", text: "Follow your order through every status until it lands at your door." },
];

const TESTIMONIALS = [
  {
    quote:
      "I sent my project report for printing and binding from my room and it arrived at Unity Hall before my 2pm lecture. Never queuing at the print shop again.",
    name: "Ama O.",
    role: "Level 300, Pharmacy",
  },
  {
    quote:
      "As a provider, CampusConnect turned my photography side-hustle into steady weekend bookings. The dashboard makes managing orders painless.",
    name: "Kwame A.",
    role: "Photographer · Provider",
  },
  {
    quote:
      "Ordered waakye during a study marathon at the library. Courier found me on the second floor. 10/10.",
    name: "Yaw D.",
    role: "Level 200, Computer Eng.",
  },
];

export default function Landing() {
  const navigate = useNavigate();

  const start = (e) => {
    e.preventDefault();
    navigate("/register");
  };

  return (
    <div className="landing">
      {/* ---- hero ---- */}
      <section className="landing-hero">
        <span className="badge">🎓 Built for KNUST · students & staff</span>
        <h1>
          Campus life, <span className="accent">on demand.</span>
        </h1>
        <p>
          CampusConnect is KNUST's marketplace for everyday campus services — printing, gas
          refills, phone & laptop repairs, gadget rentals, secondhand deals and courier
          delivery — booked in seconds and delivered to your hall/hostel.
        </p>

        <form className="hero-cta card" onSubmit={start}>
          <input placeholder="What do you need done? e.g. print & bind my report" />
          <button className="btn gold" type="submit">
            Get started
          </button>
        </form>
        <p className="hero-note muted">
          Sign up free to browse services and place your first order ·{" "}
          <Link to="/login">already a member? Log in</Link>
        </p>

        <div className="stats">
          <div className="stat">
            <strong>Open</strong>
            <span>providers list any service</span>
          </div>
          <div className="stat">
            <strong>100%</strong>
            <span>campus-based providers</span>
          </div>
          <div className="stat">
            <strong>MoMo</strong>
            <span>& cash payments</span>
          </div>
          <div className="stat">
            <strong>Hall/Hostel</strong>
            <span>door delivery</span>
          </div>
        </div>
      </section>

      {/* ---- categories ---- */}
      <section className="landing-section">
        <div className="spread">
          <div>
            <h2 className="section-title" style={{ margin: 0 }}>
              Whatever you need, someone on campus does it
            </h2>
            <p className="muted" style={{ margin: "6px 0 0" }}>
              Create a free account to browse listings and order from any category.
            </p>
          </div>
        </div>
        <div className="cat-grid">
          {CATEGORIES.map((c) => (
            <Link key={c.id} to="/register" className="card cat-tile">
              <span className="cat-icon">{c.icon}</span>
              <strong>{c.name}</strong>
              <span className="muted">{c.blurb}</span>
              <img
                className="cat-photo"
                src={`/images/categories/${c.id}.jpg`}
                alt={c.name}
                loading="lazy"
              />
            </Link>
          ))}
          <Link to="/register" className="card cat-tile more">
            <span className="cat-icon">✨</span>
            <strong>Something else?</strong>
            <span className="muted">Providers can list any service they offer</span>
          </Link>
        </div>
      </section>

      {/* ---- how it works ---- */}
      <section className="landing-section how">
        <h2 className="section-title center">How CampusConnect works</h2>
        <div className="grid cols-3">
          {STEPS.map((s, i) => (
            <div key={s.title} className="card step">
              <div className="step-num">{i + 1}</div>
              <div className="step-icon">{s.icon}</div>
              <h3>{s.title}</h3>
              <p className="muted">{s.text}</p>
            </div>
          ))}
        </div>
        <div className="center" style={{ marginTop: 22 }}>
          <Link className="btn" to="/register">
            Create your free account
          </Link>
        </div>
      </section>

      {/* ---- perks ---- */}
      <section className="landing-section">
        <h2 className="section-title center">Why students choose CampusConnect</h2>
        <div className="grid cols-2">
          {PERKS.map((p) => (
            <div key={p.title} className="card perk">
              <span className="perk-icon">{p.icon}</span>
              <div>
                <h3>{p.title}</h3>
                <p className="muted">{p.text}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ---- testimonials ---- */}
      <section className="landing-section">
        <h2 className="section-title center">Loved across campus</h2>
        <div className="grid cols-3">
          {TESTIMONIALS.map((t) => (
            <figure key={t.name} className="card quote">
              <blockquote>“{t.quote}”</blockquote>
              <figcaption>
                <strong>{t.name}</strong>
                <span className="muted">{t.role}</span>
              </figcaption>
            </figure>
          ))}
        </div>
      </section>

      {/* ---- provider CTA ---- */}
      <section className="provider-cta">
        <div>
          <span className="badge">💼 Earn on your own schedule</span>
          <h2>Have a skill? Turn it into income.</h2>
          <p>
            Join as a provider, publish your services, and manage bookings from your own
            dashboard — photography, repairs, tutoring, food, anything campus needs.
          </p>
        </div>
        <Link className="btn gold" to="/register">
          Become a provider
        </Link>
      </section>

      {/* ---- final CTA ---- */}
      <section className="landing-section final-cta">
        <h2>Ready to get things done?</h2>
        <p className="muted">Join CampusConnect free — it takes less than a minute.</p>
        <div className="row center" style={{ justifyContent: "center" }}>
          <Link className="btn" to="/register">
            Sign up
          </Link>
          <Link className="btn ghost" to="/login">
            Log in
          </Link>
        </div>
      </section>
    </div>
  );
}
