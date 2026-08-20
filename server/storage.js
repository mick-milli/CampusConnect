// Supabase Storage helper. Uploaded media & avatars go into a public bucket so
// they survive restarts/redeploys — most hosts (including Render's free tier)
// have an ephemeral filesystem. Plain fetch, no SDK needed on Node 18+.
import { randomUUID } from "crypto";

const URL = (process.env.SUPABASE_URL || "").replace(/\/$/, "");
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const BUCKET = process.env.SUPABASE_BUCKET || "uploads";

export const STORAGE_ENABLED = Boolean(URL && KEY);
const API = `${URL}/storage/v1`;
export const PUBLIC_PREFIX = `${API}/object/public/${BUCKET}/`;

const authHeaders = { apikey: KEY, Authorization: `Bearer ${KEY}` };

// Create the public bucket once. Idempotent and best-effort: a bucket that
// already exists (or a transient error) never blocks startup.
export async function ensureBucket() {
  if (!STORAGE_ENABLED) return;
  try {
    const res = await fetch(`${API}/bucket`, {
      method: "POST",
      headers: { ...authHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({ id: BUCKET, name: BUCKET, public: true }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      if (!/exist|duplicate/i.test(body)) console.error(`Storage bucket init (${res.status}): ${body}`);
    }
  } catch (e) {
    console.error(`Storage bucket init failed: ${e.message}`);
  }
}

// Upload a buffer and return its public URL.
export async function putObject(buffer, contentType, ext) {
  const objectPath = `${randomUUID()}.${ext}`;
  const res = await fetch(`${API}/object/${BUCKET}/${objectPath}`, {
    method: "POST",
    headers: { ...authHeaders, "Content-Type": contentType, "x-upsert": "true" },
    body: buffer,
  });
  if (!res.ok) throw new Error(`Storage upload failed (${res.status}): ${await res.text().catch(() => "")}`);
  return `${PUBLIC_PREFIX}${objectPath}`;
}

// Was this URL produced by us (a public object in our bucket)?
export const isStorageUrl = (url) => typeof url === "string" && url.startsWith(PUBLIC_PREFIX);
