// Tiny zero-dependency JSON-file datastore.
// Keeps the whole DB in memory and persists to data.json on every write.
// Good enough for a demo/MVP; swap for MongoDB/Firestore in production.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { randomUUID } from "crypto";
import bcrypt from "bcryptjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_FILE = path.join(__dirname, "data.json");

export const CATEGORIES = [
  { id: "academic", name: "Academic Support", icon: "📚", description: "Typing, formatting, printing & binding" },
  { id: "tech", name: "Tech & Digital", icon: "💻", description: "Web/app development, graphic design, IT support" },
  { id: "errand", name: "Errand & Convenience", icon: "🛵", description: "Food delivery, shopping, queue assistance" },
  { id: "hostel", name: "Hostel & Lifestyle", icon: "🧹", description: "Cleaning, moving, room setup, basic repairs" },
  { id: "creative", name: "Creative & Media", icon: "📸", description: "Photography, videography, editing" },
  { id: "courier", name: "Courier & Delivery", icon: "📦", description: "Campus-wide package pickup and drop-off" },
  { id: "utility", name: "Utility & Technical", icon: "🔌", description: "Electrical fixes, WiFi setup, maintenance" },
  { id: "event", name: "Event-Based", icon: "🎉", description: "Event planning, decoration, MCs, DJs" },
  { id: "beauty", name: "Personal & Beauty", icon: "💇", description: "Hairdressing, barbering, makeup, nails at home" },
];

const empty = () => ({ users: [], services: [], orders: [] });

let db = empty();

function persist() {
  fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2));
}

export function load() {
  if (fs.existsSync(DATA_FILE)) {
    try {
      db = JSON.parse(fs.readFileSync(DATA_FILE, "utf-8"));
      return;
    } catch {
      console.warn("data.json was corrupt — reseeding.");
    }
  }
  seed();
}

function seed() {
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
  ].map((p) => ({
    id: randomUUID(),
    passwordHash: hash("password"),
    role: "provider",
    createdAt: Date.now(),
    ...p,
  }));

  db.users = [customer, ...providers];

  const [prints, courier, tech] = providers;
  const svc = (providerId, categoryId, title, description, price) => ({
    id: randomUUID(),
    providerId,
    categoryId,
    title,
    description,
    price,
    active: true,
    createdAt: Date.now(),
  });

  db.services = [
    svc(prints.id, "academic", "Print, Bind & Deliver", "Black/white & colour printing, comb/spiral binding. Delivered to your hall.", 5),
    svc(prints.id, "academic", "Project Typing & Formatting", "Fast, accurate typing and APA/IEEE formatting for assignments and theses.", 30),
    svc(courier.id, "courier", "Campus Package Pickup & Drop-off", "Send anything across campus in under 30 minutes.", 8),
    svc(courier.id, "errand", "Food & Grocery Run", "We grab your food or shopping and bring it to your door.", 10),
    svc(tech.id, "tech", "Website & App Development", "Landing pages, portfolios and small apps for student businesses.", 250),
    svc(tech.id, "tech", "Graphic Design", "Flyers, logos and social media posts with same-day turnaround.", 40),
    svc(tech.id, "utility", "WiFi & Device Setup", "Router setup, network fixes and device troubleshooting in your room.", 25),
  ];

  persist();
  console.log("Seeded database with demo data.");
}

// ---- generic helpers ----
const clone = (x) => JSON.parse(JSON.stringify(x));

export const Users = {
  all: () => clone(db.users),
  find: (fn) => clone(db.users.find(fn) || null),
  byId: (id) => clone(db.users.find((u) => u.id === id) || null),
  create: (data) => {
    const user = { id: randomUUID(), createdAt: Date.now(), ...data };
    db.users.push(user);
    persist();
    return clone(user);
  },
};

export const Services = {
  all: () => clone(db.services),
  byId: (id) => clone(db.services.find((s) => s.id === id) || null),
  filter: (fn) => clone(db.services.filter(fn)),
  create: (data) => {
    const s = { id: randomUUID(), active: true, createdAt: Date.now(), ...data };
    db.services.push(s);
    persist();
    return clone(s);
  },
  update: (id, patch) => {
    const s = db.services.find((x) => x.id === id);
    if (!s) return null;
    Object.assign(s, patch);
    persist();
    return clone(s);
  },
};

export const Orders = {
  all: () => clone(db.orders),
  byId: (id) => clone(db.orders.find((o) => o.id === id) || null),
  filter: (fn) => clone(db.orders.filter(fn)),
  create: (data) => {
    const o = { id: randomUUID(), createdAt: Date.now(), updatedAt: Date.now(), ...data };
    db.orders.push(o);
    persist();
    return clone(o);
  },
  update: (id, patch) => {
    const o = db.orders.find((x) => x.id === id);
    if (!o) return null;
    Object.assign(o, patch, { updatedAt: Date.now() });
    persist();
    return clone(o);
  },
};
