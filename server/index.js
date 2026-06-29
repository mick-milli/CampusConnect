import express from "express";
import cors from "cors";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { load, CATEGORIES, Users, Services, Orders } from "./db.js";

const PORT = process.env.PORT || 4000;
const JWT_SECRET = process.env.JWT_SECRET || "campusconnect-dev-secret";

const ORDER_FLOW = [
  "requested",
  "accepted",
  "in_progress",
  "out_for_delivery",
  "delivered",
  "completed",
];

load();

const app = express();
app.use(cors());
app.use(express.json());

// ---- helpers ----
const publicUser = (u) =>
  u && { id: u.id, name: u.name, email: u.email, role: u.role, phone: u.phone, location: u.location };

function sign(user) {
  return jwt.sign({ id: user.id, role: user.role }, JWT_SECRET, { expiresIn: "7d" });
}

function auth(required = true) {
  return (req, res, next) => {
    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : null;
    if (!token) {
      if (required) return res.status(401).json({ error: "Authentication required" });
      return next();
    }
    try {
      const payload = jwt.verify(token, JWT_SECRET);
      req.user = Users.byId(payload.id);
      if (!req.user && required) return res.status(401).json({ error: "Invalid token" });
    } catch {
      if (required) return res.status(401).json({ error: "Invalid token" });
    }
    next();
  };
}

const requireRole = (role) => (req, res, next) => {
  if (!req.user || req.user.role !== role)
    return res.status(403).json({ error: `Only ${role}s can do this` });
  next();
};

// Decorate a service with its provider + category for the client.
function decorateService(s) {
  if (!s) return null;
  const provider = publicUser(Users.byId(s.providerId));
  const category = CATEGORIES.find((c) => c.id === s.categoryId) || null;
  return { ...s, provider, category };
}

function decorateOrder(o) {
  if (!o) return null;
  return {
    ...o,
    service: decorateService(Services.byId(o.serviceId)),
    customer: publicUser(Users.byId(o.customerId)),
    provider: publicUser(Users.byId(o.providerId)),
  };
}

// ---- auth routes ----
app.post("/api/auth/register", async (req, res) => {
  const { name, email, password, role, phone, location } = req.body || {};
  if (!name || !email || !password)
    return res.status(400).json({ error: "Name, email and password are required" });
  if (role && !["customer", "provider"].includes(role))
    return res.status(400).json({ error: "Invalid role" });
  if (Users.find((u) => u.email.toLowerCase() === email.toLowerCase()))
    return res.status(409).json({ error: "An account with that email already exists" });

  const user = Users.create({
    name,
    email,
    passwordHash: bcrypt.hashSync(password, 10),
    role: role || "customer",
    phone: phone || "",
    location: location || "",
  });
  res.status(201).json({ token: sign(user), user: publicUser(user) });
});

app.post("/api/auth/login", (req, res) => {
  const { email, password } = req.body || {};
  const user = Users.find((u) => u.email.toLowerCase() === (email || "").toLowerCase());
  if (!user || !bcrypt.compareSync(password || "", user.passwordHash))
    return res.status(401).json({ error: "Invalid email or password" });
  res.json({ token: sign(user), user: publicUser(user) });
});

app.get("/api/auth/me", auth(), (req, res) => res.json({ user: publicUser(req.user) }));

// ---- categories ----
app.get("/api/categories", (_req, res) => res.json(CATEGORIES));

// ---- services ----
app.get("/api/services", (req, res) => {
  const { category, q } = req.query;
  let list = Services.filter((s) => s.active !== false);
  if (category) list = list.filter((s) => s.categoryId === category);
  if (q) {
    const needle = q.toLowerCase();
    list = list.filter(
      (s) => s.title.toLowerCase().includes(needle) || s.description.toLowerCase().includes(needle)
    );
  }
  list.sort((a, b) => b.createdAt - a.createdAt);
  res.json(list.map(decorateService));
});

app.get("/api/services/mine", auth(), requireRole("provider"), (req, res) => {
  res.json(Services.filter((s) => s.providerId === req.user.id).map(decorateService));
});

app.get("/api/services/:id", (req, res) => {
  const s = Services.byId(req.params.id);
  if (!s) return res.status(404).json({ error: "Service not found" });
  res.json(decorateService(s));
});

app.post("/api/services", auth(), requireRole("provider"), (req, res) => {
  const { title, description, price, categoryId } = req.body || {};
  if (!title || !categoryId) return res.status(400).json({ error: "Title and category are required" });
  if (!CATEGORIES.some((c) => c.id === categoryId))
    return res.status(400).json({ error: "Unknown category" });
  const s = Services.create({
    providerId: req.user.id,
    categoryId,
    title,
    description: description || "",
    price: Number(price) || 0,
  });
  res.status(201).json(decorateService(s));
});

app.patch("/api/services/:id", auth(), requireRole("provider"), (req, res) => {
  const s = Services.byId(req.params.id);
  if (!s) return res.status(404).json({ error: "Service not found" });
  if (s.providerId !== req.user.id) return res.status(403).json({ error: "Not your service" });
  const { title, description, price, active } = req.body || {};
  const patch = {};
  if (title !== undefined) patch.title = title;
  if (description !== undefined) patch.description = description;
  if (price !== undefined) patch.price = Number(price) || 0;
  if (active !== undefined) patch.active = !!active;
  res.json(decorateService(Services.update(s.id, patch)));
});

// ---- orders ----
app.post("/api/orders", auth(), requireRole("customer"), (req, res) => {
  const { serviceId, note, deliveryLocation, courier, payment } = req.body || {};
  const service = Services.byId(serviceId);
  if (!service) return res.status(404).json({ error: "Service not found" });

  const order = Orders.create({
    serviceId,
    customerId: req.user.id,
    providerId: service.providerId,
    note: note || "",
    deliveryLocation: deliveryLocation || req.user.location || "",
    courier: !!courier,
    price: service.price,
    // Mock payment flow — a real build would call the Payment API here.
    payment: { method: payment || "cash", status: payment === "momo" ? "paid" : "pending" },
    status: "requested",
    history: [{ status: "requested", at: Date.now() }],
  });
  res.status(201).json(decorateOrder(order));
});

app.get("/api/orders", auth(), (req, res) => {
  const key = req.user.role === "provider" ? "providerId" : "customerId";
  const list = Orders.filter((o) => o[key] === req.user.id).sort((a, b) => b.createdAt - a.createdAt);
  res.json(list.map(decorateOrder));
});

app.get("/api/orders/:id", auth(), (req, res) => {
  const o = Orders.byId(req.params.id);
  if (!o) return res.status(404).json({ error: "Order not found" });
  if (o.customerId !== req.user.id && o.providerId !== req.user.id)
    return res.status(403).json({ error: "Not your order" });
  res.json(decorateOrder(o));
});

app.patch("/api/orders/:id/status", auth(), (req, res) => {
  const o = Orders.byId(req.params.id);
  if (!o) return res.status(404).json({ error: "Order not found" });
  const { status } = req.body || {};
  if (!ORDER_FLOW.includes(status) && status !== "cancelled")
    return res.status(400).json({ error: "Invalid status" });

  const isProvider = o.providerId === req.user.id;
  const isCustomer = o.customerId === req.user.id;
  if (!isProvider && !isCustomer) return res.status(403).json({ error: "Not your order" });

  // Customers may only cancel (before delivery) or mark completed once delivered.
  if (isCustomer && !isProvider) {
    if (status === "cancelled" && ["requested", "accepted"].includes(o.status)) {
      // ok
    } else if (status === "completed" && o.status === "delivered") {
      // ok
    } else {
      return res.status(403).json({ error: "Customers can only cancel early or confirm completion" });
    }
  }

  const updated = Orders.update(o.id, {
    status,
    history: [...(o.history || []), { status, at: Date.now() }],
  });
  res.json(decorateOrder(updated));
});

// ---- misc ----
app.get("/api/health", (_req, res) => res.json({ ok: true, service: "CampusConnect API" }));

app.use((req, res) => res.status(404).json({ error: "Not found" }));

app.listen(PORT, () => {
  console.log(`CampusConnect API running on http://localhost:${PORT}`);
});
