// Datastore with two interchangeable backends:
//   • Supabase Postgres  — when SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are set
//   • local data.json    — the zero-dependency fallback, so dev works with no keys
// Either way the whole DB is mirrored in memory for fast synchronous reads; the
// backend is the durable store that every write is persisted to.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { randomUUID } from "crypto";
import bcrypt from "bcryptjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_FILE = path.join(__dirname, "data.json");

// Categories live in the datastore (not a fixed constant) so providers can
// add their own when what they offer isn't listed. These are just the seeds.
const DEFAULT_CATEGORIES = [
  { id: "printing", name: "Printing", icon: "🖨️", description: "Printing, photocopying & binding, delivered to you" },
  { id: "gas", name: "Gas (LPG) Refill", icon: "🔥", description: "Cylinder pickup, refill and return to your hostel" },
  { id: "repairs", name: "Phone & Laptop Repairs", icon: "🛠️", description: "Screens, batteries, hardware & software fixes" },
  { id: "rentals", name: "Item & Gadget Rentals", icon: "🧰", description: "Rent gaming consoles & pads, irons, electric kettles and more" },
  { id: "secondhand", name: "Secondhand Buy & Sell", icon: "♻️", description: "Pre-owned books, gadgets and hostel essentials" },
  { id: "tech", name: "Tech & Digital", icon: "💻", description: "Web/app development, graphic design, IT support" },
  { id: "creative", name: "Creative & Media", icon: "📸", description: "Photography, videography, editing" },
  { id: "courier", name: "Courier & Delivery", icon: "📦", description: "Campus-wide package pickup and drop-off" },
  { id: "event", name: "Event-Based", icon: "🎉", description: "Event planning, decoration, MCs, DJs" },
  { id: "beauty", name: "Personal & Beauty", icon: "💇", description: "Hairdressing, barbering, makeup, nails at home" },
];

// Old fixed categories that no longer exist → their closest replacement.
const RETIRED_CATEGORY_MAP = {
  academic: "printing",
  utility: "repairs",
  errand: "courier",
  hostel: "rentals",
};

const empty = () => ({
  users: [],
  services: [],
  orders: [],
  reviews: [],
  categories: [...DEFAULT_CATEGORIES],
  notifications: [],
  messages: [],
});

let db = empty();

// ---- persistence backend ----
const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
export const USING_SUPABASE = Boolean(SUPABASE_URL && SUPABASE_KEY);

// One table per collection, each row = { id, data: <the object> }.
const COLLECTIONS = ["categories", "users", "services", "orders", "reviews", "notifications", "messages"];
const TABLE = Object.fromEntries(COLLECTIONS.map((c) => [c, "cc_" + c]));

// We talk to Supabase's REST API (PostgREST) directly over fetch — no SDK, so
// no realtime/WebSocket dependency (works on Node 18). The service_role key
// bypasses row-level security.
const REST = `${SUPABASE_URL.replace(/\/$/, "")}/rest/v1`;
const SB_HEADERS = {
  apikey: SUPABASE_KEY,
  Authorization: `Bearer ${SUPABASE_KEY}`,
  "Content-Type": "application/json",
};
async function sbRequest(method, pathAndQuery, body, extraHeaders) {
  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(`${REST}${pathAndQuery}`, {
        method,
        headers: { ...SB_HEADERS, ...extraHeaders },
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!res.ok) throw new Error(`${res.status} ${await res.text().catch(() => "")}`.trim());
      return method === "GET" ? res.json() : null;
    } catch (e) {
      lastErr = e;
      // Retry only transient network hiccups, not real HTTP error responses.
      if (!/fetch failed|ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|socket/i.test(e.message)) throw e;
      await new Promise((r) => setTimeout(r, 300 * (attempt + 1)));
    }
  }
  throw lastErr;
}
const UPSERT_HEADERS = { Prefer: "resolution=merge-duplicates,return=minimal" };

// Track in-flight Supabase writes so we can flush before shutdown / in tests.
const pending = new Set();
const track = (p) => {
  pending.add(p);
  p.finally(() => pending.delete(p));
  return p;
};
export const flush = () => Promise.all([...pending]);

// Persist a single row (Supabase) or the whole DB (file). Reads always come
// from memory, so these can run in the background without blocking handlers.
function saveRow(collection, obj) {
  if (!USING_SUPABASE) return persistFile();
  track(
    sbRequest("POST", `/${TABLE[collection]}`, [{ id: obj.id, data: obj }], UPSERT_HEADERS).catch((e) =>
      console.error(`Supabase upsert ${collection}/${obj.id}: ${e.message}`)
    )
  );
}
function removeRow(collection, id) {
  if (!USING_SUPABASE) return persistFile();
  track(
    sbRequest("DELETE", `/${TABLE[collection]}?id=eq.${encodeURIComponent(id)}`, null, {
      Prefer: "return=minimal",
    }).catch((e) => console.error(`Supabase delete ${collection}/${id}: ${e.message}`))
  );
}
function persistFile() {
  fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2));
}

export async function load() {
  if (USING_SUPABASE) return loadFromSupabase();
  loadFromFile();
}

function loadFromFile() {
  if (fs.existsSync(DATA_FILE)) {
    try {
      db = JSON.parse(fs.readFileSync(DATA_FILE, "utf-8"));
      if (migrate()) persistFile();
      return;
    } catch {
      console.warn("data.json was corrupt — reseeding.");
    }
  }
  seedInMemory();
  persistFile();
}

async function loadFromSupabase() {
  // Load sequentially (not in parallel) — fewer concurrent connections is much
  // more reliable on flaky networks; each request already retries transient hiccups.
  db = empty();
  for (const c of COLLECTIONS) {
    let rows;
    try {
      rows = await sbRequest("GET", `/${TABLE[c]}?select=data`);
    } catch (e) {
      throw new Error(
        `Loading "${c}" from Supabase failed: ${e.message}. Did you run the schema SQL (server/supabase.sql)?`
      );
    }
    db[c] = (rows || []).map((row) => row.data);
  }

  if (db.users.length === 0) {
    // First run against an empty project — import the local file if we have one,
    // otherwise seed fresh demo data. Either way, push it up to Supabase.
    if (fs.existsSync(DATA_FILE)) {
      try {
        db = { ...empty(), ...JSON.parse(fs.readFileSync(DATA_FILE, "utf-8")) };
        migrate();
        await pushAll();
        console.log("Imported existing data.json into Supabase.");
        return;
      } catch {
        console.warn("Couldn't import data.json — seeding fresh instead.");
      }
    }
    seedInMemory();
    await pushAll();
    console.log("Seeded Supabase with demo data.");
    return;
  }

  if (db.categories.length === 0) db.categories = [...DEFAULT_CATEGORIES];
  if (migrate()) await pushAll();
}

// Bulk-upload the in-memory DB (all collections, or just one) to Supabase.
async function pushAll(only) {
  for (const c of only ? [only] : COLLECTIONS) {
    const rows = db[c].map((o) => ({ id: o.id, data: o }));
    if (!rows.length) continue;
    await sbRequest("POST", `/${TABLE[c]}`, rows, UPSERT_HEADERS).catch((e) => {
      throw new Error(`Writing "${c}" to Supabase failed: ${e.message}`);
    });
  }
}

// Bring older layouts up to date, in memory. Returns whether anything changed.
function migrate() {
  let changed = false;
  if (!db.categories) {
    db.categories = [...DEFAULT_CATEGORIES];
    for (const s of db.services || []) {
      if (RETIRED_CATEGORY_MAP[s.categoryId]) s.categoryId = RETIRED_CATEGORY_MAP[s.categoryId];
    }
    changed = true;
  }
  for (const s of db.services || []) {
    if (s.images && !s.media) {
      s.media = s.images.map((url) => ({ url, type: "image" }));
      delete s.images;
      changed = true;
    }
  }
  if (!db.reviews) {
    db.reviews = [];
    changed = true;
  }
  if (!db.notifications) {
    db.notifications = [];
    changed = true;
  }
  if (!db.messages) {
    db.messages = [];
    changed = true;
  }
  // Normalise old order.payment records ({method, status:"paid"|"pending"}) to
  // the escrow shape ({method, amount, status, reference, paidAt, releasedAt}).
  const PAY_STATES = ["unpaid", "in_escrow", "released", "refunded"];
  for (const o of db.orders || []) {
    const p = o.payment || {};
    if (!PAY_STATES.includes(p.status)) {
      const wasPaid = p.status === "paid";
      o.payment = {
        method: p.method || "cash",
        amount: p.amount ?? o.price ?? 0,
        status: wasPaid ? (o.status === "completed" ? "released" : "in_escrow") : "unpaid",
        reference: p.reference || null,
        paidAt: wasPaid ? o.createdAt || Date.now() : null,
        releasedAt: wasPaid && o.status === "completed" ? o.updatedAt || Date.now() : null,
      };
      changed = true;
    }
  }
  return changed;
}

function seedInMemory() {
  db = empty();
  const hash = (p) => bcrypt.hashSync(p, 10);

  const customer = {
    id: randomUUID(),
    name: "Ama Mensah",
    email: "student@knust.edu.gh",
    passwordHash: hash("password"),
    role: "customer",
    phone: "0541234567",
    location: "Unity Hall, Block C",
    createdAt: Date.now(),
  };

  const providers = [
    { name: "Kwame Prints", email: "kwame@knust.edu.gh", location: "Commercial Area", phone: "0201112222" },
    { name: "Adjoa Couriers", email: "adjoa@knust.edu.gh", location: "Pentagon Hostel", phone: "0203334444" },
    { name: "Yaw Tech Hub", email: "yaw@knust.edu.gh", location: "Brunei Complex", phone: "0205556666" },
    { name: "Kojo Shots", email: "kojo@knust.edu.gh", location: "Ayeduase Gate", phone: "0207778888" },
    { name: "Esi Beauty Hub", email: "esi@knust.edu.gh", location: "Kotei Junction", phone: "0209990000" },
  ].map((p) => ({
    id: randomUUID(),
    passwordHash: hash("password"),
    role: "provider",
    createdAt: Date.now(),
    ...p,
  }));

  db.users = [customer, ...providers];

  const [prints, courier, tech, shots, beauty] = providers;
  // Seed photos are real photographs shipped in server/uploads (see CREDITS.md there).
  const svc = (providerId, categoryId, title, description, price, media = []) => ({
    id: randomUUID(),
    providerId,
    categoryId,
    title,
    description,
    price,
    media,
    active: true,
    createdAt: Date.now(),
  });
  const pics = (...names) => names.map((n) => ({ url: `/uploads/${n}.jpg`, type: "image" }));

  db.services = [
    svc(prints.id, "printing", "Print, Bind & Deliver", "Black/white & colour printing, comb/spiral binding. Delivered to your hall.", 5, pics("seed-print-1", "seed-print-2")),
    svc(prints.id, "printing", "Photocopy & Past Questions", "Bulk photocopying and past-question packs, same-day delivery.", 3, pics("seed-copy-1", "seed-copy-2")),
    svc(courier.id, "courier", "Campus Package Pickup & Drop-off", "Send anything across campus in under 30 minutes.", 8, pics("seed-package-1", "seed-package-2")),
    svc(courier.id, "gas", "Gas (LPG) Cylinder Refill", "We pick up your empty cylinder, refill it in town and return it to your door.", 15, pics("seed-gas-1", "seed-gas-2")),
    svc(tech.id, "tech", "Website & App Development", "Landing pages, portfolios and small apps for student businesses.", 250, pics("seed-web-1", "seed-web-2")),
    svc(tech.id, "repairs", "Phone & Laptop Repairs", "Screen and battery replacement, hardware and software fixes in 24-48 hrs.", 50, pics("seed-repair-1", "seed-repair-2")),
    svc(tech.id, "rentals", "Console & Appliance Rentals", "Rent gaming consoles & pads, irons and electric kettles by the day.", 15, pics("seed-rent-1", "seed-rent-2")),
    svc(tech.id, "secondhand", "Used Phones & Laptops", "Tested pre-owned phones, laptops and accessories at student prices. Trade-ins welcome.", 50, pics("seed-second-1", "seed-second-2")),
    svc(shots.id, "creative", "Event & Portrait Photography", "Professional shoots for graduations, birthdays and portfolios. Edited photos in 48 hrs.", 150, pics("seed-creative-1", "seed-creative-2")),
    svc(shots.id, "event", "DJ & MC Services", "Pro DJ sets and event hosting for hall weeks, parties and socials. Sound system included.", 300, pics("seed-event-1", "seed-event-2")),
    svc(beauty.id, "beauty", "Braids, Makeup & Nails at Your Room", "Knotless braids, gel nails and event makeup — done right in your hostel.", 60, pics("seed-beauty-1", "seed-beauty-2")),
  ];

  // A few sample reviews so the star ratings aren't empty on a fresh install.
  const review = (service, authorName, rating, comment, daysAgo) => ({
    id: randomUUID(),
    serviceId: service.id,
    orderId: null,
    customerId: customer.id,
    providerId: service.providerId,
    authorName,
    rating,
    comment,
    createdAt: Date.now() - daysAgo * 86400000,
  });
  const [print1, , package1, , webDev] = db.services;
  db.reviews = [
    review(print1, "Ama B.", 5, "Super fast — delivered to my hall in 20 minutes. 🔥", 2),
    review(print1, "Kofi M.", 4, "Good quality binding, slightly late but worth it.", 8),
    review(print1, "Esi A.", 5, "Reliable, will order again.", 16),
    review(package1, "Yaw D.", 4, "Package got across campus safely. Smooth handoff.", 5),
    review(webDev, "Nana K.", 5, "Built my hall-week site in two days. Clean work.", 11),
  ];
}

// ---- generic helpers ----
const clone = (x) => JSON.parse(JSON.stringify(x));

export const Categories = {
  all: () => clone(db.categories),
  byId: (id) => clone(db.categories.find((c) => c.id === id) || null),
  byName: (name) =>
    clone(db.categories.find((c) => c.name.toLowerCase() === name.toLowerCase()) || null),
  create: ({ name, icon, description }) => {
    let id = name.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    if (!id) id = randomUUID();
    while (db.categories.some((c) => c.id === id)) id += "-x";
    const cat = { id, name: name.trim(), icon: icon || "✨", description: description || "" };
    db.categories.push(cat);
    saveRow("categories", cat);
    return clone(cat);
  },
};

export const Users = {
  all: () => clone(db.users),
  find: (fn) => clone(db.users.find(fn) || null),
  byId: (id) => clone(db.users.find((u) => u.id === id) || null),
  create: (data) => {
    const user = { id: randomUUID(), createdAt: Date.now(), ...data };
    db.users.push(user);
    saveRow("users", user);
    return clone(user);
  },
  update: (id, patch) => {
    const u = db.users.find((x) => x.id === id);
    if (!u) return null;
    Object.assign(u, patch);
    saveRow("users", u);
    return clone(u);
  },
};

export const Services = {
  all: () => clone(db.services),
  byId: (id) => clone(db.services.find((s) => s.id === id) || null),
  filter: (fn) => clone(db.services.filter(fn)),
  create: (data) => {
    const s = { id: randomUUID(), active: true, createdAt: Date.now(), ...data };
    db.services.push(s);
    saveRow("services", s);
    return clone(s);
  },
  update: (id, patch) => {
    const s = db.services.find((x) => x.id === id);
    if (!s) return null;
    Object.assign(s, patch);
    saveRow("services", s);
    return clone(s);
  },
};

export const Reviews = {
  all: () => clone(db.reviews),
  byId: (id) => clone(db.reviews.find((r) => r.id === id) || null),
  filter: (fn) => clone(db.reviews.filter(fn)),
  forService: (serviceId) => clone(db.reviews.filter((r) => r.serviceId === serviceId)),
  byOrder: (orderId) => clone(db.reviews.find((r) => r.orderId === orderId) || null),
  create: (data) => {
    const r = { id: randomUUID(), createdAt: Date.now(), ...data };
    db.reviews.push(r);
    saveRow("reviews", r);
    return clone(r);
  },
  // Average rating + count for a service, used to show stars on cards/pages.
  stats: (serviceId) => {
    const rs = db.reviews.filter((r) => r.serviceId === serviceId);
    if (!rs.length) return { ratingAvg: 0, ratingCount: 0 };
    const sum = rs.reduce((acc, r) => acc + r.rating, 0);
    return { ratingAvg: Math.round((sum / rs.length) * 10) / 10, ratingCount: rs.length };
  },
};

export const Orders = {
  all: () => clone(db.orders),
  byId: (id) => clone(db.orders.find((o) => o.id === id) || null),
  filter: (fn) => clone(db.orders.filter(fn)),
  create: (data) => {
    const o = { id: randomUUID(), createdAt: Date.now(), updatedAt: Date.now(), ...data };
    db.orders.push(o);
    saveRow("orders", o);
    return clone(o);
  },
  update: (id, patch) => {
    const o = db.orders.find((x) => x.id === id);
    if (!o) return null;
    Object.assign(o, patch, { updatedAt: Date.now() });
    saveRow("orders", o);
    return clone(o);
  },
  remove: (id) => {
    const i = db.orders.findIndex((o) => o.id === id);
    if (i === -1) return false;
    db.orders.splice(i, 1);
    removeRow("orders", id);
    // Drop the order's chat and any notifications that pointed at it.
    const msgs = db.messages.filter((m) => m.orderId === id);
    const notes = db.notifications.filter((n) => n.orderId === id);
    db.messages = db.messages.filter((m) => m.orderId !== id);
    db.notifications = db.notifications.filter((n) => n.orderId !== id);
    msgs.forEach((m) => removeRow("messages", m.id));
    notes.forEach((n) => removeRow("notifications", n.id));
    return true;
  },
};

export const Notifications = {
  forUser: (userId) => clone(db.notifications.filter((n) => n.userId === userId)),
  create: (data) => {
    const n = { id: randomUUID(), read: false, createdAt: Date.now(), ...data };
    db.notifications.push(n);
    saveRow("notifications", n);
    return clone(n);
  },
  // Mark a user's notifications read — all of them, or only the given ids.
  markRead: (userId, ids) => {
    const only = Array.isArray(ids) && ids.length ? new Set(ids) : null;
    const changed = [];
    for (const n of db.notifications) {
      if (n.userId === userId && !n.read && (!only || only.has(n.id))) {
        n.read = true;
        changed.push(n);
      }
    }
    changed.forEach((n) => saveRow("notifications", n));
    return clone(db.notifications.filter((n) => n.userId === userId));
  },
};

export const Messages = {
  forOrder: (orderId) => clone(db.messages.filter((m) => m.orderId === orderId)),
  create: (data) => {
    const m = { id: randomUUID(), createdAt: Date.now(), ...data };
    db.messages.push(m);
    saveRow("messages", m);
    return clone(m);
  },
};
