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
  { id: "laundry", name: "Laundry & Ironing", icon: "🧺", description: "Wash, dry, fold and ironing — picked up and delivered to your hostel" },
];

// Old fixed categories that no longer exist → their closest replacement.
const RETIRED_CATEGORY_MAP = {
  academic: "printing",
  utility: "repairs",
  errand: "courier",
  hostel: "rentals",
};

const empty = () => ({
  providers: [],
  customers: [],
  services: [],
  orders: [],
  reviews: [],
  categories: [...DEFAULT_CATEGORIES],
  notifications: [],
  messages: [],
});

let db = empty();

// Providers and customers are stored in separate collections/tables, but most
// of the app treats "users" as one set — these read/route across both.
const allUsers = () => [...db.providers, ...db.customers];
const userTable = (role) => (role === "provider" ? "providers" : "customers");

// ---- persistence backend ----
const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
export const USING_SUPABASE = Boolean(SUPABASE_URL && SUPABASE_KEY);

// One table per collection, each row = { id, data: <the object> }.
const COLLECTIONS = ["categories", "providers", "customers", "services", "orders", "reviews", "notifications", "messages"];
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

  // One-time migration from the legacy single cc_users table into the split
  // cc_providers / cc_customers tables (cc_users is left in place as a backup).
  if (db.providers.length + db.customers.length === 0) {
    let legacy = [];
    try {
      legacy = ((await sbRequest("GET", `/cc_users?select=data`)) || []).map((r) => r.data);
    } catch {
      /* cc_users may not exist on a fresh project — nothing to migrate */
    }
    if (legacy.length) {
      db.providers = legacy.filter((u) => u.role === "provider");
      db.customers = legacy.filter((u) => u.role !== "provider");
      await pushAll("providers");
      await pushAll("customers");
      console.log(`Migrated ${legacy.length} users from cc_users into cc_providers/cc_customers.`);
    }
  }

  if (allUsers().length === 0) {
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
  // Split the legacy single `users` collection into providers + customers.
  if (Array.isArray(db.users)) {
    db.providers = [...(db.providers || []), ...db.users.filter((u) => u.role === "provider")];
    db.customers = [...(db.customers || []), ...db.users.filter((u) => u.role !== "provider")];
    delete db.users;
    changed = true;
  }
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
    // Provider-centric browse groups listings by service type; older listings
    // predate the field, so seed it from the title (each becomes its own type).
    if (s.serviceType === undefined) {
      s.serviceType = s.title || "";
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
    { name: "Kwame Prints", email: "kwame@knust.edu.gh", location: "Commercial Area", phone: "0201112222", bio: "Same-day printing, binding & photocopying delivered to your hall." },
    { name: "Adjoa Couriers", email: "adjoa@knust.edu.gh", location: "Pentagon Hostel", phone: "0203334444", bio: "Fast campus courier and gas refill runs." },
    { name: "Yaw Tech Hub", email: "yaw@knust.edu.gh", location: "Brunei Complex", phone: "0205556666", bio: "Web & app builds, device repairs, rentals and used gadgets." },
    { name: "Kojo Shots", email: "kojo@knust.edu.gh", location: "Ayeduase Gate", phone: "0207778888", bio: "Event & portrait photography plus DJ/MC services." },
    { name: "Esi Beauty Hub", email: "esi@knust.edu.gh", location: "Kotei Junction", phone: "0209990000", bio: "Braids, makeup and nails done right in your hostel." },
    { name: "Kofi Fix", email: "kofi@knust.edu.gh", location: "Ayeduase Gate", phone: "0201234321", bio: "Phone & laptop repairs with a 24-hour turnaround." },
    { name: "Akosua Printworks", email: "akosua@knust.edu.gh", location: "Ayeduase Gate", phone: "0244001100", bio: "Colour printing, lamination and thesis binding at student rates." },
    { name: "Swift Campus Errands", email: "swift@knust.edu.gh", location: "SRC Block", phone: "0244002200", bio: "Reliable pickups and drop-offs anywhere on campus." },
    { name: "FlameGas Express", email: "flamegas@knust.edu.gh", location: "Kotei Junction", phone: "0244003300", bio: "Same-day LPG cylinder pickup, refill and return." },
    { name: "Nsroma Web Studio", email: "nsroma@knust.edu.gh", location: "Brunei Complex", phone: "0244004400", bio: "Websites, portfolios and mobile apps for campus hustles." },
    { name: "Lens & Light Studio", email: "lenslight@knust.edu.gh", location: "Republic Hall", phone: "0244005500", bio: "Photography, videography and event hosting for every occasion." },
    { name: "PlayZone Rentals", email: "playzone@knust.edu.gh", location: "Unity Hall", phone: "0244006600", bio: "Consoles, pads, projectors and small appliances by the day." },
    { name: "Glow Beauty Bar", email: "glow@knust.edu.gh", location: "Ayeduase New Site", phone: "0244007700", bio: "Braids, nails and makeup for classes, dates and events." },
    { name: "TradeUp KNUST", email: "tradeup@knust.edu.gh", location: "Commercial Area", phone: "0244008800", bio: "Buy, sell and swap tested pre-owned phones and laptops." },
    { name: "FreshFold Laundry", email: "freshfold@knust.edu.gh", location: "Ayeduase New Site", phone: "0244009900", bio: "Wash, dry, fold and ironing — picked up and delivered to your hostel." },
    { name: "CampusWash", email: "campuswash@knust.edu.gh", location: "Kotei Junction", phone: "0244010010", bio: "Fast student laundry: wash, iron and press, delivered to your door." },
  ].map((p) => ({
    id: randomUUID(),
    passwordHash: hash("password"),
    role: "provider",
    createdAt: Date.now(),
    ...p,
  }));

  db.customers = [customer];
  db.providers = providers;

  const [prints, courier, tech, shots, beauty, fix, akosua, swift, flame, nsroma, lens, playzone, glow, tradeup, freshfold, campuswash] = providers;
  // Seed photos are real photographs shipped in server/uploads (see CREDITS.md there).
  // `serviceType` is the shared label the browse pages group providers under, so
  // two providers offering "Phone & Laptop Repair" appear together.
  const svc = (providerId, categoryId, serviceType, title, description, price, media = []) => ({
    id: randomUUID(),
    providerId,
    categoryId,
    serviceType,
    title,
    description,
    price,
    media,
    active: true,
    createdAt: Date.now(),
  });
  const pics = (...names) => names.map((n) => ({ url: `/uploads/${n}.jpg`, type: "image" }));

  db.services = [
    svc(prints.id, "printing", "Print, Bind & Deliver", "Print, Bind & Deliver", "Black/white & colour printing, comb/spiral binding. Delivered to your hall.", 5, pics("seed-print-1", "seed-print-2")),
    svc(prints.id, "printing", "Photocopy & Past Questions", "Photocopy & Past Questions", "Bulk photocopying and past-question packs, same-day delivery.", 3, pics("seed-copy-1", "seed-copy-2")),
    svc(courier.id, "courier", "Campus Courier & Delivery", "Campus Package Pickup & Drop-off", "Send anything across campus in under 30 minutes.", 8, pics("seed-package-1", "seed-package-2")),
    svc(courier.id, "gas", "Gas (LPG) Refill", "Gas (LPG) Cylinder Refill", "We pick up your empty cylinder, refill it in town and return it to your door.", 15, pics("seed-gas-1", "seed-gas-2")),
    svc(tech.id, "tech", "Website & App Development", "Website & App Development", "Landing pages, portfolios and small apps for student businesses.", 250, pics("seed-web-1", "seed-web-2")),
    svc(tech.id, "repairs", "Phone & Laptop Repair", "Phone & Laptop Repairs", "Screen and battery replacement, hardware and software fixes in 24-48 hrs.", 50, pics("seed-repair-1", "seed-repair-2")),
    svc(tech.id, "rentals", "Console & Appliance Rentals", "Console & Appliance Rentals", "Rent gaming consoles & pads, irons and electric kettles by the day.", 15, pics("seed-rent-1", "seed-rent-2")),
    svc(tech.id, "secondhand", "Used Phones & Laptops", "Used Phones & Laptops", "Tested pre-owned phones, laptops and accessories at student prices. Trade-ins welcome.", 50, pics("seed-second-1", "seed-second-2")),
    svc(shots.id, "creative", "Event & Portrait Photography", "Event & Portrait Photography", "Professional shoots for graduations, birthdays and portfolios. Edited photos in 48 hrs.", 150, pics("seed-creative-1", "seed-creative-2")),
    svc(shots.id, "event", "DJ & MC Services", "DJ & MC Services", "Pro DJ sets and event hosting for hall weeks, parties and socials. Sound system included.", 300, pics("seed-event-1", "seed-event-2")),
    svc(beauty.id, "beauty", "Braids, Makeup & Nails", "Braids, Makeup & Nails at Your Room", "Knotless braids, gel nails and event makeup — done right in your hostel.", 60, pics("seed-beauty-1", "seed-beauty-2")),
    // Second provider under an existing service type so grouping is visible.
    svc(fix.id, "repairs", "Phone & Laptop Repair", "Screen & Battery Replacement", "Cracked screens and dead batteries fixed same-day, plus water-damage recovery.", 45, pics("seed-repair-1", "seed-repair-2")),
    // More providers competing on the same services, so customers pick who they prefer.
    svc(akosua.id, "printing", "Print, Bind & Deliver", "Colour Print, Laminate & Bind", "Colour printing, lamination and hard/soft binding for theses and reports.", 6, pics("seed-print-2", "seed-print-1")),
    svc(akosua.id, "printing", "Photocopy & Past Questions", "Past Questions & Handouts", "Past-question packs and lecture handouts photocopied and delivered.", 3, pics("seed-copy-2", "seed-copy-1")),
    svc(swift.id, "courier", "Campus Courier & Delivery", "Anywhere-on-Campus Courier", "Fast pickups and deliveries between halls, gates and lecture blocks.", 7, pics("seed-package-2", "seed-package-1")),
    svc(flame.id, "gas", "Gas (LPG) Refill", "LPG Cylinder Pickup & Refill", "Empty cylinder collected, refilled in town and returned to your door.", 14, pics("seed-gas-2", "seed-gas-1")),
    svc(nsroma.id, "tech", "Website & App Development", "Websites & Mobile Apps", "Custom sites and simple mobile apps built for student businesses.", 220, pics("seed-web-2", "seed-web-1")),
    svc(lens.id, "creative", "Event & Portrait Photography", "Portrait & Event Shoots", "Graduation, birthday and portfolio shoots with edited photos in 48 hrs.", 130, pics("seed-creative-2", "seed-creative-1")),
    svc(lens.id, "event", "DJ & MC Services", "DJ & Event Hosting", "DJ sets and MC hosting for hall weeks, parties and socials.", 280, pics("seed-event-2", "seed-event-1")),
    svc(playzone.id, "rentals", "Console & Appliance Rentals", "Console & Projector Rentals", "PS5/PS4 consoles, extra pads, projectors and kettles by the day.", 18, pics("seed-rent-2", "seed-rent-1")),
    svc(glow.id, "beauty", "Braids, Makeup & Nails", "Nails, Braids & Glam Makeup", "Gel nails, knotless braids and event makeup in the comfort of your room.", 55, pics("seed-beauty-2", "seed-beauty-1")),
    svc(tradeup.id, "secondhand", "Used Phones & Laptops", "Pre-owned Phones & Laptops", "Tested second-hand phones and laptops, with trade-ins welcome.", 45, pics("seed-second-2", "seed-second-1")),
    // Laundry providers — two competing on "Wash, Dry & Fold", each also offering another listed service.
    svc(freshfold.id, "laundry", "Wash, Dry & Fold", "Wash, Dry & Fold", "Same-day wash, dry and fold. We pick up and deliver to your hostel.", 20, pics("seed-rent-1", "seed-rent-2")),
    svc(freshfold.id, "courier", "Campus Courier & Delivery", "Laundry & Parcel Pickup", "Pickups and drop-offs anywhere on campus, laundry or parcels.", 7, pics("seed-package-1", "seed-package-2")),
    svc(campuswash.id, "laundry", "Wash, Dry & Fold", "Wash, Iron & Press", "Wash, iron and press for shirts, dresses and bedding. Delivered to your door.", 18, pics("seed-rent-2", "seed-rent-1")),
    svc(campuswash.id, "rentals", "Console & Appliance Rentals", "Iron & Steamer Rentals", "Rent a steam iron or garment steamer by the day.", 10, pics("seed-rent-1", "seed-rent-2")),
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
  // Reference seeded services by position (see the db.services array above).
  const S = db.services;
  const [print1, , package1, gasRefill, webDev, phoneRepair, rental1, used1,
    kojoPhoto, kojoDj, esiBeauty, kofiRepair, akosuaPrint, , swiftCourier,
    flameGas, nsromaWeb, lensPhoto, lensDj, playRental, glowBeauty, tradeUsed,
    freshLaundry, , washLaundry] = S;
  db.reviews = [
    review(print1, "Ama B.", 5, "Super fast — delivered to my hall in 20 minutes. 🔥", 2),
    review(print1, "Kofi M.", 4, "Good quality binding, slightly late but worth it.", 8),
    review(print1, "Esi A.", 5, "Reliable, will order again.", 16),
    review(package1, "Yaw D.", 4, "Package got across campus safely. Smooth handoff.", 5),
    review(gasRefill, "Abena L.", 5, "Picked up my cylinder and returned it refilled the same day.", 9),
    review(webDev, "Nana K.", 5, "Built my hall-week site in two days. Clean work.", 11),
    review(phoneRepair, "Kwabena O.", 5, "Cracked screen fixed in a few hours. Works like new.", 6),
    review(rental1, "Adwoa F.", 4, "Console was clean and worked perfectly. Smooth rental.", 13),
    review(used1, "Kojo T.", 5, "Phone was well-tested and exactly as described.", 20),
    // Kojo Shots
    review(kojoPhoto, "Efua N.", 5, "Amazing shots — edited photos came within 48 hours.", 4),
    review(kojoPhoto, "Kwame P.", 5, "Made my graduation shoot so much fun. Recommend.", 18),
    review(kojoDj, "Yaw D.", 4, "Kept hall week alive all night. Great energy.", 10),
    // Esi Beauty Hub
    review(esiBeauty, "Akua S.", 5, "Neat braids done right in my room. Loved it.", 7),
    review(esiBeauty, "Ama B.", 4, "Nails came out great and lasted for weeks.", 21),
    // Kofi Fix
    review(kofiRepair, "Kofi M.", 5, "Fixed my battery same day. Honest pricing.", 5),
    review(kofiRepair, "Nana K.", 4, "Quick water-damage recovery — got my phone back working.", 15),
    // Akosua Printworks
    review(akosuaPrint, "Esi A.", 5, "Clean colour prints and solid binding for my thesis.", 6),
    review(akosuaPrint, "Adwoa F.", 4, "Sorted my handouts overnight. Very handy.", 17),
    // Swift Campus Errands
    review(swiftCourier, "Kwabena O.", 5, "Fast pickup and drop-off across campus.", 3),
    review(swiftCourier, "Abena L.", 5, "Found me at the library easily. Smooth handoff.", 12),
    // FlameGas Express
    review(flameGas, "Kojo T.", 5, "Refilled my cylinder the same day. No stress.", 8),
    review(flameGas, "Efua N.", 4, "Saved me the trip to town. Fair price.", 19),
    // Nsroma Web Studio
    review(nsromaWeb, "Kwame P.", 5, "Built my portfolio site — clean, professional work.", 9),
    review(nsromaWeb, "Ama B.", 4, "Great communication and delivered on time.", 22),
    // Lens & Light Studio
    review(lensPhoto, "Akua S.", 5, "Beautiful portraits with quick edits.", 6),
    review(lensDj, "Yaw D.", 4, "Great MC — read the crowd well all night.", 14),
    // PlayZone Rentals
    review(playRental, "Adwoa F.", 5, "Console and projector were spotless. Easy pickup.", 5),
    review(playRental, "Kofi M.", 4, "Fair daily rate and everything worked.", 16),
    // Glow Beauty Bar
    review(glowBeauty, "Efua N.", 5, "Flawless makeup for my event — lasted all day.", 4),
    review(glowBeauty, "Esi A.", 4, "Braids and nails on point, done in my room.", 18),
    // TradeUp KNUST
    review(tradeUsed, "Kwabena O.", 5, "Laptop exactly as described and well tested.", 7),
    review(tradeUsed, "Nana K.", 4, "Smooth trade-in, no surprises.", 20),
    // FreshFold Laundry
    review(freshLaundry, "Adwoa F.", 5, "Clothes came back clean, folded and smelling great.", 4),
    review(freshLaundry, "Kojo T.", 5, "Picked up from my hostel and delivered next day. So convenient.", 12),
    review(freshLaundry, "Ama B.", 4, "Neat ironing, nothing shrank. Will use again.", 19),
    // CampusWash
    review(washLaundry, "Efua N.", 5, "Fast turnaround and my shirts were perfectly pressed.", 6),
    review(washLaundry, "Kwabena O.", 4, "Good price and delivered right to my door on time.", 14),
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
  all: () => clone(allUsers()),
  find: (fn) => clone(allUsers().find(fn) || null),
  byId: (id) => clone(allUsers().find((u) => u.id === id) || null),
  // A user's collection is decided by role (providers vs customers).
  create: (data) => {
    const user = { id: randomUUID(), createdAt: Date.now(), ...data };
    const coll = userTable(user.role);
    db[coll].push(user);
    saveRow(coll, user);
    return clone(user);
  },
  update: (id, patch) => {
    for (const coll of ["providers", "customers"]) {
      const u = db[coll].find((x) => x.id === id);
      if (!u) continue;
      Object.assign(u, patch);
      saveRow(coll, u);
      return clone(u);
    }
    return null;
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
