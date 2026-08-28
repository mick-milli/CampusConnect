import "./env.js"; // must be first — populates process.env before db.js loads
import express from "express";
import cors from "cors";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { randomUUID, createHmac } from "crypto";
import multer from "multer";
import { load, flush, USING_SUPABASE, Categories, Users, Services, Orders, Reviews, Notifications, Messages } from "./db.js";
import { supaAuth, AUTH_ENABLED } from "./supabaseAuth.js";
import { STORAGE_ENABLED, isStorageUrl, ensureBucket, putObject } from "./storage.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOADS_DIR = path.join(__dirname, "uploads");
fs.mkdirSync(UPLOADS_DIR, { recursive: true });
// The built React app (single-service deploy); absent during local dev (Vite).
const CLIENT_DIST = path.join(__dirname, "..", "client", "dist");

const PORT = process.env.PORT || 4000;

// ---- Paystack (real MoMo/card charges) ----
// Set PAYSTACK_SECRET_KEY (sk_test_… / sk_live_…) in server/.env to go live.
// Without it, the escrow flow falls back to a simulated charge so dev still works.
const PAYSTACK_SECRET = process.env.PAYSTACK_SECRET_KEY || "";
const PAYSTACK_ENABLED = /^sk_(test|live)_/.test(PAYSTACK_SECRET);
const PAYSTACK_BASE = "https://api.paystack.co";

// Thin Paystack REST helper (Node 18+ ships a global fetch).
async function paystack(endpoint, { method = "GET", body } = {}) {
  const res = await fetch(`${PAYSTACK_BASE}${endpoint}`, {
    method,
    headers: {
      Authorization: `Bearer ${PAYSTACK_SECRET}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.status === false)
    throw new Error(json.message || `Paystack request failed (${res.status})`);
  return json.data;
}
// Amounts are charged in the minor unit (pesewas for GHS).
const toMinor = (amount) => Math.round((Number(amount) || 0) * 100);

const ORDER_FLOW = [
  "requested",
  "accepted",
  "in_progress",
  "out_for_delivery",
  "delivered",
  "completed",
];

const STATUS_LABELS = {
  requested: "Requested",
  accepted: "Accepted",
  in_progress: "In Progress",
  out_for_delivery: "Out for Delivery",
  delivered: "Delivered",
  completed: "Completed",
  cancelled: "Cancelled",
};

const money = (n) => `GH₵ ${Number(n || 0).toFixed(2)}`;

// Platform commission taken from a provider's payout on each successfully
// completed (released) order. A flagged/refunded order never releases, so it's
// never charged — the 5% only ever applies to a clean sale.
const PLATFORM_FEE_RATE = 0.05;
const feeBreakdown = (amount) => {
  const gross = Number(amount) || 0;
  const fee = Math.round(gross * PLATFORM_FEE_RATE * 100) / 100;
  return { fee, net: Math.round((gross - fee) * 100) / 100 };
};

// Payment methods. "cash" is settled in person on delivery; "momo" and "card"
// are online methods whose funds are held in escrow until work is confirmed.
const PAY_METHODS = ["cash", "momo", "card"];
const ONLINE_METHODS = ["momo", "card"];

// Once an order is funded it's locked in: neither party can cancel it. The
// provider must get the work delivered within this window, or the escrowed funds
// are automatically refunded to the customer (see sweepExpiredEscrow). Once it's
// delivered the clock stops — it's then on the customer to confirm or flag it —
// so a provider who did the work isn't refunded out from under them.
const ESCROW_DEADLINE_MS = Number(process.env.ESCROW_DEADLINE_MS) || 24 * 60 * 60 * 1000;

// A fresh order's payment record. Online orders start "unpaid" and are funded
// into escrow after the provider accepts; cash orders are paid on delivery.
function newPayment(method, amount) {
  return {
    method: PAY_METHODS.includes(method) ? method : "cash",
    amount,
    status: "unpaid", // unpaid → in_escrow → released | refunded
    reference: null,
    paidAt: null,
    releasedAt: null,
  };
}


// Fire-and-forget in-app notification for a single user.
function notify(userId, type, text, orderId = null) {
  if (!userId) return;
  Notifications.create({ userId, type, text, orderId });
}

const app = express();
// (auth now managed by Supabase Auth — see supabaseAuth.js)
app.use(cors());
// Keep the raw body around so the Paystack webhook can verify its signature.
app.use(
  express.json({
    limit: "2mb",
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  })
);
app.use("/uploads", express.static(UPLOADS_DIR));
// In production the API also serves the built React app (single-service deploy).
if (fs.existsSync(CLIENT_DIST)) app.use(express.static(CLIENT_DIST));

// ---- media uploads (service photos & videos) ----
const MEDIA_MIMES = {
  "image/jpeg": { ext: "jpg", type: "image" },
  "image/png": { ext: "png", type: "image" },
  "image/webp": { ext: "webp", type: "image" },
  "video/mp4": { ext: "mp4", type: "video" },
  "video/webm": { ext: "webm", type: "video" },
  "video/quicktime": { ext: "mov", type: "video" },
};
const MAX_MEDIA = 6;

// Buffer uploads in memory so we can hand them to Supabase Storage (or, in
// local dev, write them to the uploads dir ourselves — see storeUpload).
const uploadMedia = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 80 * 1024 * 1024, files: MAX_MEDIA },
  fileFilter: (_req, file, cb) => cb(null, Boolean(MEDIA_MIMES[file.mimetype])),
});

// A URL we produced ourselves: a Supabase Storage object (when configured) or a
// local uploads file that's actually on disk (dev fallback).
function isValidUploadUrl(url) {
  if (typeof url !== "string" || !url) return false;
  if (STORAGE_ENABLED) return isStorageUrl(url);
  return /^\/uploads\/[\w-]+\.[a-z0-9]+$/.test(url) && fs.existsSync(path.join(UPLOADS_DIR, path.basename(url)));
}

// Keep only well-formed {url,type} entries that point at media we host.
function sanitizeMedia(media) {
  if (!Array.isArray(media)) return [];
  return media
    .filter((m) => m && ["image", "video"].includes(m.type) && isValidUploadUrl(m.url))
    .map((m) => ({ url: m.url, type: m.type }))
    .slice(0, MAX_MEDIA);
}

// ---- avatar uploads (single profile image) ----
const AVATAR_MIMES = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
const uploadAvatar = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => cb(null, Boolean(AVATAR_MIMES[file.mimetype])),
});

// A single uploaded-image URL we host, or "" if it's bogus.
function sanitizeAvatar(url) {
  return isValidUploadUrl(url) ? url : "";
}

// Persist an uploaded (in-memory) file and return its public URL. Supabase
// Storage when configured; otherwise the local uploads dir for zero-config dev.
async function storeUpload(file, ext) {
  if (STORAGE_ENABLED) return putObject(file.buffer, file.mimetype, ext);
  const filename = `${randomUUID()}.${ext}`;
  fs.writeFileSync(path.join(UPLOADS_DIR, filename), file.buffer);
  return `/uploads/${filename}`;
}

// ---- helpers ----
const publicUser = (u) =>
  u && {
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role,
    phone: u.phone,
    location: u.location,
    avatar: u.avatar || "",
    bio: u.bio || "",
  };

// Non-sensitive payout summary — only ever returned to the provider themselves.
function payoutSummary(u) {
  const p = u?.payout;
  if (!p) return null;
  return {
    method: p.method, // "mobile_money" | "bank"
    bankName: p.bankName || "",
    accountName: p.accountName || "",
    last4: p.last4 || "",
    ready: !!(p.recipientCode || p.simulated),
  };
}
// The signed-in user's own record, including their payout summary.
const selfUser = (u) => u && { ...publicUser(u), payout: payoutSummary(u) };

// ---- authentication (identities managed by Supabase Auth; server proxies it) ----

// Cache validated access tokens briefly so we don't call Supabase every request.
const tokenCache = new Map(); // token -> { email, authId, metadata, mfaVerified, exp }
const TOKEN_TTL = 60 * 1000;

// Read the assurance level from an (already-validated) access token.
function tokenAal(token) {
  try {
    return JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString()).aal;
  } catch {
    return null;
  }
}

// Ensure a local profile (in cc_providers/cc_customers, by role) exists for a
// Supabase auth user, linked by email so every existing order/service/review
// reference stays intact.
function profileFor(authUser) {
  const email = (authUser.email || "").toLowerCase();
  let profile = Users.find((u) => u.email.toLowerCase() === email);
  const m = authUser.user_metadata || {};
  if (!profile) {
    profile = Users.create({
      email: authUser.email,
      name: m.name || authUser.email.split("@")[0],
      role: m.role === "provider" ? "provider" : "customer",
      phone: m.phone || "",
      location: m.location || "",
      authId: authUser.id,
    });
  } else if (profile.authId !== authUser.id) {
    profile = Users.update(profile.id, { authId: authUser.id });
  }
  return profile;
}

// Validate a Supabase access token and attach the local profile to req.user.
// `allowAal1` lets the MFA-verify step run with a not-yet-elevated token.
function auth(required = true, allowAal1 = false) {
  return async (req, res, next) => {
    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : null;
    if (!token) {
      if (required) return res.status(401).json({ error: "Authentication required" });
      return next();
    }
    try {
      let entry = tokenCache.get(token);
      if (!entry || entry.exp < Date.now()) {
        const u = await supaAuth.getUser(token);
        entry = {
          email: u.email,
          authId: u.id,
          metadata: u.user_metadata,
          mfaVerified: (u.factors || []).some((f) => f.status === "verified"),
          exp: Date.now() + TOKEN_TTL,
        };
        if (tokenCache.size > 1000) tokenCache.clear();
        tokenCache.set(token, entry);
      }
      // A user with a verified factor must present an MFA-completed (aal2) token.
      if (entry.mfaVerified && !allowAal1 && tokenAal(token) !== "aal2") {
        req.user = null;
        if (required) return res.status(401).json({ error: "Two-factor authentication required" });
        return next();
      }
      req.authToken = token;
      req.user = profileFor({ id: entry.authId, email: entry.email, user_metadata: entry.metadata });
      if (req.user?.deactivated) req.user = null;
      if (!req.user && required) return res.status(401).json({ error: "Invalid token" });
    } catch {
      if (required) return res.status(401).json({ error: "Invalid or expired session" });
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
  const category = Categories.byId(s.categoryId);
  const { ratingAvg, ratingCount } = Reviews.stats(s.id);
  return { ...s, provider, category, ratingAvg, ratingCount };
}

// Decorate a provider (a user) into a storefront summary for the browse pages:
// the categories & service types they cover, how many active listings they have,
// an aggregate rating across all their work, and a cover image. With
// `withServices`, also attach the full decorated listing set (storefront page).
function decorateProvider(u, { withServices = false } = {}) {
  if (!u || u.role !== "provider" || u.deactivated) return null;
  const services = Services.filter(
    (s) => s.providerId === u.id && s.active !== false && !s.deleted
  ).sort((a, b) => b.createdAt - a.createdAt);
  // Unique categories the provider offers something in, in listing order.
  const seen = new Set();
  const categories = [];
  for (const s of services) {
    if (seen.has(s.categoryId)) continue;
    seen.add(s.categoryId);
    const c = Categories.byId(s.categoryId);
    if (c) categories.push({ id: c.id, name: c.name, icon: c.icon });
  }
  const serviceTypes = [...new Set(services.map((s) => s.serviceType || s.title).filter(Boolean))];
  const reviews = Reviews.filter((r) => r.providerId === u.id);
  const ratingCount = reviews.length;
  const ratingAvg = ratingCount
    ? Math.round((reviews.reduce((sum, r) => sum + r.rating, 0) / ratingCount) * 10) / 10
    : 0;
  const thumbnail = services.find((s) => s.media?.length)?.media[0]?.url || null;

  // This endpoint is public, so expose only what the storefront UI shows —
  // no contact details (email/phone) to anonymous visitors.
  const { id, name, role, location, avatar, bio } = publicUser(u);
  const card = {
    id,
    name,
    role,
    location,
    avatar,
    bio,
    headline: bio || (categories.length ? categories.map((c) => c.name).join(" · ") : ""),
    categories,
    serviceTypes,
    serviceCount: services.length,
    ratingAvg,
    ratingCount,
    thumbnail,
  };
  if (withServices) card.services = services.map(decorateService);
  return card;
}

// The provider must get a fair chance to make it right before any refund, and a
// flag needs an evidence trail. So the customer first raises it in the order
// chat; then either the provider has replied, or a grace window has passed with
// no response — so a silent provider can't block a refund forever.
const FLAG_SILENCE_MS = Number(process.env.FLAG_SILENCE_MS) || 24 * 60 * 60 * 1000;

function flagChatEligibility(o) {
  const msgs = Messages.forOrder(o.id);
  const fromCustomer = msgs.filter((m) => m.senderId === o.customerId);
  if (!fromCustomer.length) return { ok: false, stage: "raise" };
  if (msgs.some((m) => m.senderId === o.providerId)) return { ok: true, stage: "eligible" };
  // No provider reply yet — allow only once the grace window since the
  // customer's most recent message has elapsed.
  const until = Math.max(...fromCustomer.map((m) => m.createdAt)) + FLAG_SILENCE_MS;
  if (Date.now() >= until) return { ok: true, stage: "eligible" };
  return { ok: false, stage: "wait", until };
}

// Work stages during which a funded order can be flagged for uncompleted work.
const FLAGGABLE_STATES = ["in_progress", "out_for_delivery", "delivered"];

// Whether/why the customer may flag this order right now (null = not in the flag
// window at all). Drives the flag button + hints, and mirrors the /flag guard.
function flagState(o) {
  const inWindow =
    ONLINE_METHODS.includes(o.payment?.method) &&
    o.payment?.status === "in_escrow" &&
    FLAGGABLE_STATES.includes(o.status);
  return inWindow ? flagChatEligibility(o) : null;
}

function decorateOrder(o, viewerId = null) {
  if (!o) return null;
  // Unread chat messages for whoever's asking: those sent by the other party
  // since this viewer last opened the thread (see the messages GET handler).
  let unread = 0;
  if (viewerId) {
    const seen = o.reads?.[viewerId] || 0;
    unread = Messages.forOrder(o.id).filter(
      (m) => m.senderId !== viewerId && m.createdAt > seen
    ).length;
  }
  return {
    ...o,
    service: decorateService(Services.byId(o.serviceId)),
    customer: publicUser(Users.byId(o.customerId)),
    provider: publicUser(Users.byId(o.providerId)),
    // The customer's review for this order, if they've left one.
    review: Reviews.byOrder(o.id),
    unread,
    // Whether/why the customer may flag right now — drives the button + hints.
    flagState: flagState(o),
    // Provider payout state — internal transfer codes are kept server-side.
    payout: o.payout ? { status: o.payout.status, amount: o.payout.amount, at: o.payout.at } : null,
  };
}

// Normalize a display name for duplicate detection: fold accents & case, and
// treat any run of punctuation/whitespace as a single gap. So "Kwame  Prints!"
// and "kwame-prints" collide with "Kwame Prints".
const normalizeName = (s) =>
  String(s || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "") // drop combining accent marks
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

// ---- auth routes ----

// Where GoTrue should send a user after they click an email link. Uses the
// browser's own origin (the Vite dev server in dev, the deployed site in prod),
// so links work in both without extra config; override with CLIENT_URL.
const clientOrigin = (req) => process.env.CLIENT_URL || req.headers.origin || `http://localhost:${PORT}`;

app.post("/api/auth/register", async (req, res) => {
  const { name, email, password, role, phone, location } = req.body || {};
  if (!name || !email || !password)
    return res.status(400).json({ error: "Name, email and password are required" });
  if (role && !["customer", "provider"].includes(role))
    return res.status(400).json({ error: "Invalid role" });
  if (String(password).length < 6)
    return res.status(400).json({ error: "Password must be at least 6 characters" });

  // Provider names appear in the public directory, so they must be distinct
  // (normalized). Customers may legitimately share real names, so they're exempt.
  if ((role || "customer") === "provider") {
    const norm = normalizeName(name);
    if (norm && Users.find((u) => u.role === "provider" && normalizeName(u.name) === norm))
      return res
        .status(409)
        .json({ error: "A provider with that name already exists — please choose a different one." });
  }

  let result;
  try {
    result = await supaAuth.signUp({
      email,
      password,
      metadata: { name, role: role || "customer", phone: phone || "", location: location || "" },
      redirectTo: `${clientOrigin(req)}/auth/confirm`,
    });
  } catch (e) {
    if (e.status === 422 || /already|registered|exists/i.test(e.message))
      return res.status(409).json({ error: "An account with that email already exists" });
    return res.status(400).json({ error: e.message });
  }

  // Email confirmation is on: GoTrue created the user and emailed a link, but
  // returned no session. The user can't sign in until they click it.
  if (!result.access_token)
    return res.status(201).json({ pending: true, email });

  // Confirmation is off on this project → GoTrue returned a live session, so we
  // sign the user straight in (keeps local/dev working without SMTP).
  const profile = profileFor(result.user);
  res.status(201).json({ token: result.access_token, refreshToken: result.refresh_token, user: selfUser(profile) });
});

// Re-send the signup confirmation email. Always reports success — we don't
// reveal whether an address is registered (or already confirmed).
app.post("/api/auth/resend", async (req, res) => {
  const { email } = req.body || {};
  if (!email) return res.status(400).json({ error: "Email is required" });
  try {
    await supaAuth.resendSignup({ email, redirectTo: `${clientOrigin(req)}/auth/confirm` });
  } catch {
    /* swallow — a bad/confirmed/rate-limited address must look the same */
  }
  res.json({ ok: true });
});

app.post("/api/auth/login", async (req, res) => {
  const { email, password } = req.body || {};
  let sess;
  try {
    sess = await supaAuth.signIn(email || "", password || "");
  } catch {
    return res.status(401).json({ error: "Invalid email or password" });
  }
  const profile = profileFor(sess.user);
  if (profile.deactivated)
    return res.status(403).json({ error: "This account has been deactivated." });
  // If the user has a verified TOTP factor, ask for a code before finishing.
  const factor = (sess.user.factors || []).find((f) => f.status === "verified" && f.factor_type === "totp");
  if (factor) return res.json({ mfaRequired: true, factorId: factor.id, token: sess.access_token });
  res.json({ token: sess.access_token, refreshToken: sess.refresh_token, user: selfUser(profile) });
});

// Exchange a refresh token for a fresh access token (keeps sessions alive).
app.post("/api/auth/refresh", async (req, res) => {
  const { refreshToken } = req.body || {};
  if (!refreshToken) return res.status(400).json({ error: "Missing refresh token" });
  try {
    const sess = await supaAuth.refresh(refreshToken);
    const profile = profileFor(sess.user);
    res.json({ token: sess.access_token, refreshToken: sess.refresh_token, user: selfUser(profile) });
  } catch {
    res.status(401).json({ error: "Session expired — please log in again" });
  }
});

app.get("/api/auth/me", auth(), (req, res) => res.json({ user: selfUser(req.user) }));

// ---- MFA (opt-in TOTP) ----
// Whether the signed-in user has 2FA on.
app.get("/api/auth/mfa", auth(), async (req, res) => {
  try {
    const u = await supaAuth.getUser(req.authToken);
    const factor = (u.factors || []).find((f) => f.factor_type === "totp");
    res.json({
      enrolled: factor?.status === "verified",
      pending: !!factor && factor.status !== "verified",
      factorId: factor?.id || null,
    });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// Start enrollment → returns a QR code + secret to add to an authenticator app.
app.post("/api/auth/mfa/enroll", auth(), async (req, res) => {
  try {
    const f = await supaAuth.mfaEnroll(req.authToken, `CampusConnect ${new Date().toISOString().slice(0, 10)}`);
    res.json({ factorId: f.id, qr: f.totp?.qr_code, secret: f.totp?.secret, uri: f.totp?.uri });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// Verify a 6-digit code — confirms enrollment OR completes a login challenge.
// Returns fresh, MFA-elevated (aal2) tokens. Allows an aal1 token in (login step).
app.post("/api/auth/mfa/verify", auth(true, true), async (req, res) => {
  const { factorId, code } = req.body || {};
  if (!factorId || !code) return res.status(400).json({ error: "Enter the 6-digit code" });
  try {
    const ch = await supaAuth.mfaChallenge(req.authToken, factorId);
    const out = await supaAuth.mfaVerify(req.authToken, factorId, ch.id, String(code).trim());
    res.json({ token: out.access_token, refreshToken: out.refresh_token, user: selfUser(req.user) });
  } catch (e) {
    res.status(400).json({
      error: /invalid|code|expired/i.test(e.message) ? "That code isn't valid — try again" : e.message,
    });
  }
});

// Turn 2FA off (requires an MFA-completed session).
app.post("/api/auth/mfa/disable", auth(), async (req, res) => {
  try {
    const factors = ((await supaAuth.getUser(req.authToken)).factors || []).filter((f) => f.factor_type === "totp");
    for (const f of factors) await supaAuth.mfaUnenroll(req.authToken, f.id);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// Upload a profile picture (any signed-in user) → returns its URL.
app.post("/api/avatar", auth(), uploadAvatar.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Please choose an image (JPG, PNG or WebP)" });
  try {
    const url = await storeUpload(req.file, AVATAR_MIMES[req.file.mimetype]);
    res.status(201).json({ url });
  } catch (e) {
    res.status(502).json({ error: `Couldn't upload image: ${e.message}` });
  }
});

// Edit your own profile — name, short bio, contact and avatar.
app.patch("/api/auth/me", auth(), (req, res) => {
  const { name, bio, phone, location, avatar } = req.body || {};
  const patch = {};
  if (name !== undefined) {
    const n = String(name).trim();
    if (!n) return res.status(400).json({ error: "Name can't be empty" });
    // Same rule as registration: a provider can't rename to another provider's
    // (normalized) name. Excludes themselves, so tweaking your own casing is fine.
    if (req.user.role === "provider") {
      const norm = normalizeName(n);
      if (norm && Users.find((u) => u.role === "provider" && u.id !== req.user.id && normalizeName(u.name) === norm))
        return res
          .status(409)
          .json({ error: "A provider with that name already exists — please choose a different one." });
    }
    patch.name = n.slice(0, 80);
  }
  if (bio !== undefined) patch.bio = String(bio).trim().slice(0, 300);
  if (phone !== undefined) patch.phone = String(phone).trim().slice(0, 30);
  if (location !== undefined) patch.location = String(location).trim().slice(0, 120);
  if (avatar !== undefined) patch.avatar = sanitizeAvatar(avatar);

  const updated = Users.update(req.user.id, patch);
  res.json({ user: selfUser(updated) });
});

// Change password — must confirm the current one (verified via a fresh sign-in).
app.post("/api/auth/change-password", auth(), async (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (!currentPassword || !newPassword)
    return res.status(400).json({ error: "Current and new password are required" });
  if (String(newPassword).length < 6)
    return res.status(400).json({ error: "New password must be at least 6 characters" });
  try {
    await supaAuth.signIn(req.user.email, currentPassword);
  } catch {
    return res.status(400).json({ error: "Current password is incorrect" });
  }
  try {
    await supaAuth.updatePassword(req.authToken, newPassword);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// Deactivate the account — confirm with the password. Blocks future logins and
// hides any of the provider's listings from the marketplace.
app.post("/api/auth/deactivate", auth(), async (req, res) => {
  const { password } = req.body || {};
  try {
    await supaAuth.signIn(req.user.email, password || "");
  } catch {
    return res.status(400).json({ error: "Password is incorrect" });
  }
  Users.update(req.user.id, { deactivated: true, deactivatedAt: Date.now() });
  if (req.user.role === "provider") {
    for (const s of Services.filter((x) => x.providerId === req.user.id)) {
      Services.update(s.id, { active: false });
    }
  }
  res.json({ ok: true });
});

// ---- categories ----
app.get("/api/categories", (_req, res) => res.json(Categories.all()));

// ---- providers (public storefronts) ----
// The marketplace is browsed provider-first (Alibaba-style). These are public so
// the landing page can showcase real providers before a visitor signs in.
app.get("/api/providers", (req, res) => {
  const { category, q } = req.query;
  let list = Users.all()
    .filter((u) => u.role === "provider" && !u.deactivated)
    .map((u) => decorateProvider(u))
    .filter((p) => p && p.serviceCount > 0);
  if (category) list = list.filter((p) => p.categories.some((c) => c.id === category));
  if (q) {
    const needle = String(q).toLowerCase();
    const has = (v) => (v || "").toLowerCase().includes(needle);
    list = list.filter(
      (p) =>
        has(p.name) ||
        has(p.headline) ||
        has(p.location) ||
        p.categories.some((c) => has(c.name)) ||
        p.serviceTypes.some((t) => has(t))
    );
  }
  // Best-rated, then most listings, first.
  list.sort((a, b) => b.ratingAvg - a.ratingAvg || b.serviceCount - a.serviceCount);
  res.json(list);
});

app.get("/api/providers/:id", (req, res) => {
  const provider = decorateProvider(Users.byId(req.params.id), { withServices: true });
  if (!provider) return res.status(404).json({ error: "Provider not found" });
  res.json(provider);
});

// ---- services ----
app.get("/api/services", auth(), (req, res) => {
  const { category, q } = req.query;
  let list = Services.filter((s) => s.active !== false && !s.deleted);
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
  res.json(
    Services.filter((s) => s.providerId === req.user.id && !s.deleted).map(decorateService)
  );
});

app.get("/api/services/:id", auth(), (req, res) => {
  const s = Services.byId(req.params.id);
  if (!s || s.deleted) return res.status(404).json({ error: "Service not found" });
  res.json(decorateService(s));
});

// Public list of a service's reviews, newest first.
app.get("/api/services/:id/reviews", auth(), (req, res) => {
  const s = Services.byId(req.params.id);
  if (!s) return res.status(404).json({ error: "Service not found" });
  const reviews = Reviews.forService(s.id).sort((a, b) => b.createdAt - a.createdAt);
  res.json(reviews);
});

// Step 1: providers upload photos/videos here (multipart), get back their URLs.
app.post("/api/media", auth(), requireRole("provider"), uploadMedia.array("files", MAX_MEDIA), async (req, res) => {
  try {
    const media = await Promise.all(
      (req.files || []).map(async (f) => ({
        url: await storeUpload(f, MEDIA_MIMES[f.mimetype].ext),
        type: MEDIA_MIMES[f.mimetype].type,
      }))
    );
    res.status(201).json({ media });
  } catch (e) {
    res.status(502).json({ error: `Couldn't upload files: ${e.message}` });
  }
});

// Step 2: the service is created referencing the uploaded media.
app.post("/api/services", auth(), requireRole("provider"), (req, res) => {
  const { title, description, price, categoryId, categoryName, serviceType, media } = req.body || {};
  if (!title) return res.status(400).json({ error: "Title is required" });

  // Providers can pick an existing category or create a new one by name
  // when what they offer isn't listed yet.
  let category = null;
  if (categoryId) {
    category = Categories.byId(categoryId);
    if (!category) return res.status(400).json({ error: "Unknown category" });
  } else if (categoryName && categoryName.trim()) {
    category = Categories.byName(categoryName) || Categories.create({ name: categoryName });
  } else {
    return res.status(400).json({ error: "Pick a category or name a new one" });
  }

  const s = Services.create({
    providerId: req.user.id,
    categoryId: category.id,
    title,
    // The shared label the browse pages group providers under; defaults to the
    // title so a listing always groups somewhere even if the field is left blank.
    serviceType: String(serviceType || "").trim().slice(0, 80) || title,
    description: description || "",
    price: Number(price) || 0,
    media: sanitizeMedia(media),
  });
  res.status(201).json(decorateService(s));
});

app.patch("/api/services/:id", auth(), requireRole("provider"), (req, res) => {
  const s = Services.byId(req.params.id);
  if (!s || s.deleted) return res.status(404).json({ error: "Service not found" });
  if (s.providerId !== req.user.id) return res.status(403).json({ error: "Not your service" });
  const { title, description, price, active, serviceType, media, categoryId } = req.body || {};
  const patch = {};
  if (title !== undefined) {
    if (!String(title).trim()) return res.status(400).json({ error: "Title can't be empty" });
    patch.title = String(title).trim();
  }
  if (serviceType !== undefined) patch.serviceType = String(serviceType).trim().slice(0, 80);
  if (description !== undefined) patch.description = description;
  if (price !== undefined) patch.price = Number(price) || 0;
  if (active !== undefined) patch.active = !!active;
  // Only the uploaded media the provider kept (or newly added) are persisted;
  // sanitizeMedia drops anything not backed by a real file on disk.
  if (media !== undefined) patch.media = sanitizeMedia(media);
  // Switching to a different existing category (new categories are created at
  // publish time, not here).
  if (categoryId !== undefined) {
    const category = Categories.byId(categoryId);
    if (!category) return res.status(400).json({ error: "Unknown category" });
    patch.categoryId = category.id;
  }
  res.json(decorateService(Services.update(s.id, patch)));
});

// Soft-delete: the listing disappears from the marketplace and the provider's
// dashboard, but the record is kept so past orders still resolve their details.
app.delete("/api/services/:id", auth(), requireRole("provider"), (req, res) => {
  const s = Services.byId(req.params.id);
  if (!s || s.deleted) return res.status(404).json({ error: "Service not found" });
  if (s.providerId !== req.user.id) return res.status(403).json({ error: "Not your service" });
  Services.update(s.id, { deleted: true, active: false });
  res.json({ ok: true });
});

// ---- orders ----
app.post("/api/orders", auth(), requireRole("customer"), (req, res) => {
  const { serviceId, note, deliveryLocation, courier, payment } = req.body || {};
  const service = Services.byId(serviceId);
  if (!service) return res.status(404).json({ error: "Service not found" });

  const dropoff = deliveryLocation || req.user.location || "";

  const order = Orders.create({
    serviceId,
    customerId: req.user.id,
    providerId: service.providerId,
    note: note || "",
    deliveryLocation: dropoff,
    courier: !!courier,
    price: service.price,
    payment: newPayment(payment, service.price),
    status: "requested",
    history: [{ status: "requested", at: Date.now() }],
  });
  notify(
    service.providerId,
    "order",
    `New order for "${service.title}" from ${req.user.name}`,
    order.id
  );
  res.status(201).json(decorateOrder(order, req.user.id));
});

app.get("/api/orders", auth(), async (req, res) => {
  // Settle any overdue escrow before listing, so refunds show up promptly for
  // whoever's looking (the interval sweep is the backstop when nobody is).
  await sweepExpiredEscrow().catch(() => {});
  const key = req.user.role === "provider" ? "providerId" : "customerId";
  const list = Orders.filter((o) => o[key] === req.user.id).sort((a, b) => b.createdAt - a.createdAt);
  res.json(list.map((o) => decorateOrder(o, req.user.id)));
});

app.get("/api/orders/:id", auth(), (req, res) => {
  const o = Orders.byId(req.params.id);
  if (!o) return res.status(404).json({ error: "Order not found" });
  if (o.customerId !== req.user.id && o.providerId !== req.user.id)
    return res.status(403).json({ error: "Not your order" });
  res.json(decorateOrder(o, req.user.id));
});

// Either participant can permanently delete a cancelled order — it's removed
// for both parties, along with its chat and notifications.
app.delete("/api/orders/:id", auth(), (req, res) => {
  const o = Orders.byId(req.params.id);
  if (!o) return res.status(404).json({ error: "Order not found" });
  if (o.customerId !== req.user.id && o.providerId !== req.user.id)
    return res.status(403).json({ error: "Not your order" });
  if (o.status !== "cancelled")
    return res.status(400).json({ error: "Only cancelled orders can be deleted" });
  Orders.remove(o.id);
  res.json({ ok: true, id: o.id });
});

app.patch("/api/orders/:id/status", auth(), async (req, res) => {
  const o = Orders.byId(req.params.id);
  if (!o) return res.status(404).json({ error: "Order not found" });
  const { status } = req.body || {};
  if (!ORDER_FLOW.includes(status) && status !== "cancelled")
    return res.status(400).json({ error: "Invalid status" });

  const isProvider = o.providerId === req.user.id;
  const isCustomer = o.customerId === req.user.id;
  if (!isProvider && !isCustomer) return res.status(403).json({ error: "Not your order" });

  // Once money is in escrow the order is locked in — neither party can cancel it
  // (no cancelling just to trigger a refund). If it isn't completed in time,
  // sweepExpiredEscrow refunds the customer automatically (see ESCROW_DEADLINE_MS).
  if (status === "cancelled" && o.payment?.status === "in_escrow")
    return res.status(409).json({
      error:
        "This order is funded and can no longer be cancelled. If the provider doesn't deliver within 24 hours, the money in escrow is refunded to the customer automatically.",
    });

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

  // Escrow guard: an online order must be funded before the provider starts
  // work, so the money is safely held until the customer confirms completion.
  const isOnline = ONLINE_METHODS.includes(o.payment?.method);
  const workStates = ["in_progress", "out_for_delivery", "delivered"];
  if (isProvider && isOnline && o.payment?.status === "unpaid" && workStates.includes(status)) {
    return res
      .status(409)
      .json({ error: "Waiting for the customer's escrow payment before work can begin." });
  }

  const patch = {
    status,
    history: [...(o.history || []), { status, at: Date.now() }],
  };
  // Release escrowed funds to the provider once the customer confirms the work
  // is done, locking in the platform fee and the net the provider is owed. A
  // funded order can't be cancelled here — an unfinished one is auto-refunded by
  // sweepExpiredEscrow — so there's no cancel-refund path in this handler.
  if (o.payment?.status === "in_escrow" && status === "completed")
    patch.payment = {
      ...o.payment,
      status: "released",
      releasedAt: Date.now(),
      ...feeBreakdown(o.payment.amount),
    };
  let updated = Orders.update(o.id, patch);

  // Tell the other party their order moved.
  const service = Services.byId(o.serviceId);
  const label = STATUS_LABELS[status] || status;
  const recipientId = isProvider ? o.customerId : o.providerId;
  const text =
    status === "cancelled"
      ? `Order "${service?.title || "service"}" was cancelled`
      : `Order "${service?.title || "service"}" is now ${label}`;
  notify(recipientId, "status", text, o.id);

  // On release, pay the provider out via Transfers.
  if (patch.payment?.status === "released") {
    await payProvider(updated);
    updated = Orders.byId(o.id); // pick up the payout state payProvider wrote
  }

  res.json(decorateOrder(updated, req.user.id));
});

// A customer flags an order for uncompleted work → full refund, order closed.
// Only once the money is actually in escrow, the work is underway, and the two
// parties have talked it over in the order chat — so the provider had a fair
// chance to resolve it first, and there's a record of the dispute.
app.post("/api/orders/:id/flag", auth(), requireRole("customer"), async (req, res) => {
  const o = Orders.byId(req.params.id);
  if (!o) return res.status(404).json({ error: "Order not found" });
  if (o.customerId !== req.user.id) return res.status(403).json({ error: "Not your order" });
  if (o.payment?.status !== "in_escrow")
    return res.status(400).json({ error: "Only an order with money still held in escrow can be flagged" });
  if (!FLAGGABLE_STATES.includes(o.status))
    return res.status(400).json({ error: "You can flag once the provider has started the work" });
  const chat = flagChatEligibility(o);
  if (!chat.ok)
    return res.status(409).json({
      error:
        chat.stage === "wait"
          ? "You've raised this with the provider — you can flag if it's still unresolved 24 hours after your message."
          : "Message the provider in the order chat to raise the issue before flagging.",
    });

  const reason = String(req.body?.reason || "").trim().slice(0, 500);
  const service = Services.byId(o.serviceId);
  const updated = Orders.update(o.id, {
    status: "cancelled",
    payment: { ...o.payment, status: "refunded" },
    flag: { reason, at: Date.now(), by: "customer" },
    history: [...(o.history || []), { status: "cancelled", at: Date.now() }],
  });
  notify(
    o.providerId,
    "payment",
    `${req.user.name} flagged "${service?.title || "an order"}" as uncompleted — ${money(o.payment.amount)} is being refunded to them.`,
    o.id
  );
  // Reverse the customer's escrow charge (this notifies them).
  await refundEscrow(updated);
  res.json(decorateOrder(Orders.byId(o.id), req.user.id));
});

// ---- escrow payment (customer funds an accepted order via MoMo/card) ----

// Move an order's funds into escrow and notify the provider. Idempotent, so
// the payment redirect return and the webhook can both call it safely.
function fundEscrow(o, reference) {
  if (["in_escrow", "released"].includes(o.payment?.status)) return o;
  const payment = { ...o.payment, status: "in_escrow", reference, paidAt: Date.now() };
  const updated = Orders.update(o.id, { payment });
  const service = Services.byId(o.serviceId);
  const customer = Users.byId(o.customerId);
  notify(
    o.providerId,
    "payment",
    `${customer?.name || "The customer"} funded ${money(payment.amount)} into escrow for "${service?.title || "your service"}" — safe to start.`,
    o.id
  );
  return updated;
}

// Reverse a customer's escrow charge when an order is refunded (cancelled or
// flagged). Cash, unfunded and simulated (dev) charges never moved real money,
// so they're a no-op beyond recording the state. Records refund state on the
// order and notifies the customer; safe to call once per refund.
//   simulated → dev/no real charge   ·   pending → Paystack processing
//   processed → money returned       ·   failed → needs manual follow-up
async function refundEscrow(o) {
  const pay = o.payment || {};
  const amount = pay.amount || 0;
  const service = Services.byId(o.serviceId);
  const setRefund = (r) => Orders.update(o.id, { payment: { ...pay, refund: { at: Date.now(), ...r } } });

  const noRealCharge =
    !PAYSTACK_ENABLED || !ONLINE_METHODS.includes(pay.method) || !pay.reference || String(pay.reference).startsWith("sim_");
  if (noRealCharge) {
    setRefund({ status: "simulated" });
    notify(o.customerId, "payment", `${money(amount)} has been refunded to you for "${service?.title || "the order"}".`, o.id);
    return;
  }
  try {
    const data = await paystack("/refund", {
      method: "POST",
      body: { transaction: pay.reference, amount: toMinor(amount) },
    });
    setRefund({ status: data?.status === "processed" ? "processed" : "pending", reference: pay.reference });
    notify(o.customerId, "payment", `Your ${money(amount)} refund for "${service?.title || "the order"}" is on its way.`, o.id);
  } catch (e) {
    setRefund({ status: "failed", error: e.message });
    notify(o.customerId, "payment", `We couldn't process your ${money(amount)} refund automatically — support will sort it out.`, o.id);
    console.error(`Paystack refund for order ${o.id}: ${e.message}`);
  }
}

// Auto-refund any funded order the provider hasn't delivered within the escrow
// deadline (24h from when the money landed in escrow). Since a funded order can't
// be cancelled, this is the customer's guarantee: no delivery in time → money
// comes back. Delivered orders are excluded — the provider has done their part,
// so it's on the customer to confirm or flag it, not for us to refund it away.
// Runs on an interval, at startup, and lazily when orders are listed.
// Non-reentrant so overlapping calls (interval + a request) can't double-refund.
let sweepingEscrow = false;
async function sweepExpiredEscrow() {
  if (sweepingEscrow) return;
  sweepingEscrow = true;
  try {
    const now = Date.now();
    const due = Orders.filter(
      (o) =>
        o.payment?.status === "in_escrow" &&
        !["completed", "cancelled", "delivered"].includes(o.status) &&
        o.payment?.paidAt &&
        now - o.payment.paidAt >= ESCROW_DEADLINE_MS
    );
    for (const o of due) {
      const service = Services.byId(o.serviceId);
      const amount = o.payment.amount;
      // Flip state first so a concurrent/next sweep won't pick it up again.
      const updated = Orders.update(o.id, {
        status: "cancelled",
        payment: { ...o.payment, status: "refunded" },
        autoRefund: { at: now, reason: "Not delivered within 24 hours of funding" },
        history: [...(o.history || []), { status: "cancelled", at: now }],
      });
      notify(
        o.customerId,
        "payment",
        `"${service?.title || "Your order"}" wasn't delivered within 24 hours — ${money(amount)} is being refunded to you from escrow.`,
        o.id
      );
      notify(
        o.providerId,
        "payment",
        `"${service?.title || "An order"}" wasn't delivered within 24 hours, so ${money(amount)} was refunded to the customer from escrow.`,
        o.id
      );
      await refundEscrow(updated);
    }
  } finally {
    sweepingEscrow = false;
  }
}

// Pay the provider their escrowed funds via a Paystack Transfer once the order
// is released. Records payout state on the order; safe to retry.
//   awaiting_details → provider has no payout destination yet
//   pending / otp_required → transfer accepted, settling
//   paid → money sent   ·   failed → transfer error, retryable
async function payProvider(o) {
  const provider = Users.byId(o.providerId);
  // The provider is paid their net share — the customer's payment minus the
  // platform fee locked in at release (older orders fall back to the gross).
  const amount = o.payment?.net ?? o.payment?.amount ?? 0;
  const service = Services.byId(o.serviceId);
  const setPayout = (p) => Orders.update(o.id, { payout: { amount, at: Date.now(), ...p } });

  if (!provider?.payout?.recipientCode && !provider?.payout?.simulated) {
    setPayout({ status: "awaiting_details" });
    notify(
      o.providerId,
      "payment",
      `Add your payout details to receive ${money(amount)} for "${service?.title || "your service"}".`,
      o.id
    );
    return;
  }

  // Simulated payout when Paystack isn't configured.
  if (!PAYSTACK_ENABLED || provider.payout.simulated || !provider.payout.recipientCode) {
    setPayout({ status: "paid", simulated: true });
    notify(o.providerId, "payment", `${money(amount)} paid out to your ${provider.payout.bankName || "account"}.`, o.id);
    return;
  }

  try {
    const reference = `pyt_${o.id.slice(0, 8)}_${Date.now().toString(36)}`;
    const tr = await paystack("/transfer", {
      method: "POST",
      body: {
        source: "balance",
        amount: toMinor(amount),
        recipient: provider.payout.recipientCode,
        reason: `CampusConnect payout · order ${o.id.slice(0, 8)}`,
        reference,
      },
    });
    const status = tr.status === "success" ? "paid" : tr.status === "otp" ? "otp_required" : "pending";
    setPayout({ status, transferCode: tr.transfer_code, reference });
    notify(
      o.providerId,
      "payment",
      status === "paid"
        ? `${money(amount)} paid out to your ${provider.payout.bankName || "account"}.`
        : `Your payout of ${money(amount)} is processing.`,
      o.id
    );
  } catch (e) {
    setPayout({ status: "failed", error: e.message });
    notify(o.providerId, "payment", `Payout of ${money(amount)} failed: ${e.message}. Check your payout details.`, o.id);
  }
}

// Shared guard: is this order in a state the given customer can pay for?
function payabilityError(o, req) {
  if (o.customerId !== req.user.id) return [403, "Not your order"];
  if (["cancelled", "completed"].includes(o.status))
    return [400, "This order can no longer be paid for"];
  if (o.status === "requested")
    return [400, "You can pay once the provider accepts the order"];
  if (o.payment?.status && o.payment.status !== "unpaid")
    return [409, "This order has already been paid"];
  return null;
}

// Lets the client know whether to run the real Paystack flow or the dev fallback.
app.get("/api/config", (_req, res) => {
  res.json({ paystackEnabled: PAYSTACK_ENABLED, currency: "GHS", platformFeeRate: PLATFORM_FEE_RATE });
});

// Start a payment. With Paystack configured this initializes a transaction and
// returns its hosted checkout URL; otherwise it simulates the charge instantly.
app.post("/api/orders/:id/pay/init", auth(), requireRole("customer"), async (req, res) => {
  const o = Orders.byId(req.params.id);
  if (!o) return res.status(404).json({ error: "Order not found" });
  const method = req.body?.method;
  if (!ONLINE_METHODS.includes(method))
    return res.status(400).json({ error: "Choose Mobile Money or card" });
  const err = payabilityError(o, req);
  if (err) return res.status(err[0]).json({ error: err[1] });

  // Dev fallback: no keys configured → simulate the charge.
  if (!PAYSTACK_ENABLED) {
    const reference = `sim_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    const updated = fundEscrow({ ...o, payment: { ...o.payment, method } }, reference);
    return res.json({ mode: "simulated", order: decorateOrder(updated, req.user.id) });
  }

  try {
    const customer = Users.byId(o.customerId);
    const reference = `esc_${o.id.slice(0, 8)}_${Date.now().toString(36)}`;
    const origin = req.headers.origin || `http://localhost:${PORT}`;
    const data = await paystack("/transaction/initialize", {
      method: "POST",
      body: {
        email: customer?.email,
        amount: toMinor(o.payment?.amount),
        currency: "GHS",
        reference,
        channels: method === "momo" ? ["mobile_money"] : ["card"],
        callback_url: `${origin}/orders`,
        metadata: { orderId: o.id },
      },
    });
    // Remember the pending reference + method so verify/webhook can match it.
    Orders.update(o.id, { payment: { ...o.payment, method, reference } });
    res.json({ mode: "paystack", authorizationUrl: data.authorization_url, reference });
  } catch (e) {
    res.status(502).json({ error: `Couldn't start payment: ${e.message}` });
  }
});

// Confirm a payment by reference (called when Paystack redirects back).
app.post("/api/pay/verify", auth(), requireRole("customer"), async (req, res) => {
  const reference = String(req.body?.reference || "");
  if (!reference) return res.status(400).json({ error: "Missing payment reference" });
  const o = Orders.filter(
    (x) => x.payment?.reference === reference && x.customerId === req.user.id
  )[0];
  if (!o) return res.status(404).json({ error: "No matching order for that payment" });
  // Already handled (e.g. by the webhook) — just return the current state.
  if (["in_escrow", "released"].includes(o.payment?.status))
    return res.json(decorateOrder(o, req.user.id));
  if (!PAYSTACK_ENABLED) return res.status(400).json({ error: "Payments are not configured" });

  try {
    const data = await paystack(`/transaction/verify/${encodeURIComponent(reference)}`);
    if (data.status !== "success" || data.amount < toMinor(o.payment?.amount))
      return res.status(400).json({ error: `Payment not completed (${data.status})` });
    const updated = fundEscrow(o, reference);
    res.json(decorateOrder(updated, req.user.id));
  } catch (e) {
    res.status(502).json({ error: `Couldn't verify payment: ${e.message}` });
  }
});

// Paystack server-to-server confirmation. Verify the signature over the raw
// body, then escrow the matching order (idempotent).
app.post("/api/paystack/webhook", (req, res) => {
  if (!PAYSTACK_ENABLED) return res.sendStatus(200);
  const signature = req.headers["x-paystack-signature"];
  const hash = createHmac("sha512", PAYSTACK_SECRET)
    .update(req.rawBody || Buffer.from(""))
    .digest("hex");
  if (hash !== signature) return res.sendStatus(401);

  const evt = req.body;
  // Customer charge landed → move into escrow.
  if (evt?.event === "charge.success") {
    const ref = evt.data?.reference;
    const orderId = evt.data?.metadata?.orderId;
    const o = orderId
      ? Orders.byId(orderId)
      : Orders.filter((x) => x.payment?.reference === ref)[0];
    if (o && (evt.data?.amount || 0) >= toMinor(o.payment?.amount)) fundEscrow(o, ref);
  }
  // Provider payout settled or bounced → update its final state.
  if (["transfer.success", "transfer.failed", "transfer.reversed"].includes(evt?.event)) {
    const ref = evt.data?.reference;
    const code = evt.data?.transfer_code;
    const o = Orders.filter(
      (x) => x.payout?.reference === ref || x.payout?.transferCode === code
    )[0];
    if (o) {
      const paid = evt.event === "transfer.success";
      Orders.update(o.id, { payout: { ...o.payout, status: paid ? "paid" : "failed", at: Date.now() } });
      notify(
        o.providerId,
        "payment",
        paid
          ? `${money(o.payout?.amount)} paid out to you.`
          : `A payout of ${money(o.payout?.amount)} failed — please check your payout details.`,
        o.id
      );
    }
  }
  // Customer refund settled or bounced → record it and let them know.
  if (["refund.processed", "refund.failed"].includes(evt?.event)) {
    const ref = evt.data?.transaction_reference || evt.data?.transaction?.reference;
    const o = ref ? Orders.filter((x) => x.payment?.reference === ref)[0] : null;
    if (o) {
      const done = evt.event === "refund.processed";
      Orders.update(o.id, {
        payment: { ...o.payment, refund: { ...(o.payment.refund || {}), status: done ? "processed" : "failed", at: Date.now() } },
      });
      notify(
        o.customerId,
        "payment",
        done
          ? `${money(o.payment?.amount)} has been refunded to you.`
          : `Your ${money(o.payment?.amount)} refund didn't go through — support will help sort it out.`,
        o.id
      );
    }
  }
  res.sendStatus(200);
});

// ---- provider payout details (Paystack Transfer recipients) ----

// List banks / mobile-money providers for the payout form.
app.get("/api/payout/banks", auth(), requireRole("provider"), async (req, res) => {
  const type = req.query.type === "bank" ? "ghipss" : "mobile_money";
  if (!PAYSTACK_ENABLED) {
    const sim =
      type === "mobile_money"
        ? [
            { name: "MTN Mobile Money", code: "MTN" },
            { name: "Telecel Cash", code: "VOD" },
            { name: "AirtelTigo Money", code: "ATL" },
          ]
        : [
            { name: "GCB Bank", code: "040100" },
            { name: "Ecobank Ghana", code: "130100" },
            { name: "Fidelity Bank", code: "240100" },
          ];
    return res.json(sim);
  }
  try {
    const data = await paystack(`/bank?currency=GHS&type=${type}`);
    res.json((data || []).map((b) => ({ name: b.name, code: b.code })));
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

// Save (or replace) the provider's payout destination as a transfer recipient.
app.post("/api/payout/recipient", auth(), requireRole("provider"), async (req, res) => {
  const { method, bankCode, bankName, accountNumber, accountName } = req.body || {};
  if (!["mobile_money", "bank"].includes(method))
    return res.status(400).json({ error: "Choose Mobile Money or Bank" });
  const acct = String(accountNumber || "").trim();
  const name = String(accountName || "").trim();
  if (!bankCode) return res.status(400).json({ error: method === "bank" ? "Select your bank" : "Select your network" });
  if (!acct) return res.status(400).json({ error: method === "bank" ? "Enter your account number" : "Enter your MoMo number" });
  if (!name) return res.status(400).json({ error: "Enter the account holder's name" });

  const recipientType = method === "bank" ? "ghipss" : "mobile_money";
  const base = {
    method,
    type: recipientType,
    bankCode: String(bankCode),
    bankName: String(bankName || "").slice(0, 60),
    accountName: name.slice(0, 80),
    last4: acct.slice(-4),
  };

  if (!PAYSTACK_ENABLED) {
    Users.update(req.user.id, { payout: { ...base, simulated: true } });
    return res.json({ user: selfUser(Users.byId(req.user.id)) });
  }
  try {
    const data = await paystack("/transferrecipient", {
      method: "POST",
      body: {
        type: recipientType,
        name,
        account_number: acct,
        bank_code: String(bankCode),
        currency: "GHS",
      },
    });
    Users.update(req.user.id, { payout: { ...base, recipientCode: data.recipient_code } });
    res.json({ user: selfUser(Users.byId(req.user.id)) });
  } catch (e) {
    res.status(502).json({ error: `Couldn't save payout details: ${e.message}` });
  }
});

// Retry a payout that's awaiting details or previously failed.
app.post("/api/orders/:id/payout/retry", auth(), requireRole("provider"), async (req, res) => {
  const o = Orders.byId(req.params.id);
  if (!o) return res.status(404).json({ error: "Order not found" });
  if (o.providerId !== req.user.id) return res.status(403).json({ error: "Not your order" });
  if (o.payment?.status !== "released")
    return res.status(400).json({ error: "This order hasn't been released yet" });
  if (o.payout?.status === "paid")
    return res.status(409).json({ error: "This payout is already complete" });
  await payProvider(o);
  res.json(decorateOrder(Orders.byId(o.id), req.user.id));
});

// A customer rates a completed order (one review per order).
app.post("/api/orders/:id/review", auth(), requireRole("customer"), (req, res) => {
  const o = Orders.byId(req.params.id);
  if (!o) return res.status(404).json({ error: "Order not found" });
  if (o.customerId !== req.user.id) return res.status(403).json({ error: "Not your order" });
  if (o.status !== "completed")
    return res.status(400).json({ error: "You can only review completed orders" });
  if (Reviews.byOrder(o.id)) return res.status(409).json({ error: "You've already reviewed this order" });

  const rating = Number(req.body?.rating);
  if (!(rating >= 1 && rating <= 5))
    return res.status(400).json({ error: "Rating must be between 1 and 5 stars" });

  const review = Reviews.create({
    serviceId: o.serviceId,
    orderId: o.id,
    customerId: req.user.id,
    providerId: o.providerId,
    authorName: req.user.name,
    rating: Math.round(rating),
    comment: (req.body?.comment || "").trim().slice(0, 500),
  });
  res.status(201).json(review);
});

// ---- order chat (customer ⇄ provider) ----
// Both parties on an order can read and post; nobody else can.
function orderForParticipant(req, res) {
  const o = Orders.byId(req.params.id);
  if (!o) {
    res.status(404).json({ error: "Order not found" });
    return null;
  }
  if (o.customerId !== req.user.id && o.providerId !== req.user.id) {
    res.status(403).json({ error: "Not your order" });
    return null;
  }
  return o;
}

app.get("/api/orders/:id/messages", auth(), (req, res) => {
  const o = orderForParticipant(req, res);
  if (!o) return;
  const msgs = Messages.forOrder(o.id).sort((a, b) => a.createdAt - b.createdAt);
  // Opening the thread marks it read for this viewer (only persist if there's
  // something newer than they've already seen, to avoid needless writes).
  const latest = msgs.length ? msgs[msgs.length - 1].createdAt : 0;
  if (latest > (o.reads?.[req.user.id] || 0))
    Orders.update(o.id, { reads: { ...(o.reads || {}), [req.user.id]: Date.now() } });
  res.json(msgs);
});

app.post("/api/orders/:id/messages", auth(), (req, res) => {
  const o = orderForParticipant(req, res);
  if (!o) return;
  const text = (req.body?.text || "").trim();
  if (!text) return res.status(400).json({ error: "Message cannot be empty" });

  const msg = Messages.create({
    orderId: o.id,
    senderId: req.user.id,
    senderName: req.user.name,
    text: text.slice(0, 1000),
  });
  const recipientId = o.customerId === req.user.id ? o.providerId : o.customerId;
  const preview = text.length > 60 ? `${text.slice(0, 60)}…` : text;
  notify(recipientId, "message", `${req.user.name.split(" ")[0]}: ${preview}`, o.id);
  res.status(201).json(msg);
});

// ---- notifications ----
app.get("/api/notifications", auth(), (req, res) => {
  const list = Notifications.forUser(req.user.id)
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 50);
  res.json(list);
});

// Mark notifications read — all of them, or only { ids: [...] }.
app.post("/api/notifications/read", auth(), (req, res) => {
  const list = Notifications.markRead(req.user.id, req.body?.ids)
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 50);
  res.json(list);
});

// ---- misc ----
app.get("/api/health", (_req, res) => res.json({ ok: true, service: "CampusConnect API" }));

// SPA fallback: any non-API GET returns the app shell so client-side routes
// (e.g. /orders, /auth/confirm) resolve on a hard refresh or an email link.
if (fs.existsSync(CLIENT_DIST)) {
  app.get("*", (req, res, next) => {
    if (req.path.startsWith("/api/") || req.path.startsWith("/uploads/")) return next();
    res.sendFile(path.join(CLIENT_DIST, "index.html"));
  });
}

app.use((req, res) => res.status(404).json({ error: "Not found" }));

// Load the datastore, ensure the storage bucket exists, then start serving.
load()
  .then(ensureBucket)
  .then(() => {
    app.listen(PORT, () => {
      console.log(
        `CampusConnect API running on http://localhost:${PORT} · storage: ${USING_SUPABASE ? "Supabase" : "local file"} · auth: ${AUTH_ENABLED ? "Supabase Auth" : "DISABLED (set SUPABASE keys)"}`
      );
    });
    // Refund overdue escrow even when nobody's browsing: sweep now (catch up on
    // anything that expired while we were down) and then on a steady interval.
    const sweepEvery = Number(process.env.ESCROW_SWEEP_INTERVAL_MS) || 10 * 60 * 1000;
    sweepExpiredEscrow().catch((e) => console.error("escrow sweep:", e.message));
    setInterval(() => sweepExpiredEscrow().catch((e) => console.error("escrow sweep:", e.message)), sweepEvery);
  })
  .catch((e) => {
    console.error("Failed to start — could not load the datastore:\n ", e.message);
    process.exit(1);
  });

// Flush any pending Supabase writes on a clean shutdown so nothing is lost.
for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, async () => {
    try {
      await flush();
    } finally {
      process.exit(0);
    }
  });
}
