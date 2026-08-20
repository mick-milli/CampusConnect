# Deploying CampusConnect (free)

The whole app runs as **one free Render web service**: the Node API serves the
API *and* the built React frontend. Supabase (which you already use) handles the
database, auth, and now file storage. Uploads go to a **public Supabase Storage
bucket** so they survive restarts (Render's free filesystem is ephemeral).

## 1. Push to GitHub

Commit everything and push to a GitHub repo (Render deploys from GitHub).
`dist/` and `.env` are gitignored on purpose — Render builds the client itself.

## 2. Create the Render service

1. Go to <https://render.com> → sign up (free) → **New → Blueprint**.
2. Pick this repo. Render reads `render.yaml` and proposes one web service.
3. In the service's **Environment** tab, set these (from `server/.env`):
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `PAYSTACK_SECRET_KEY`
   - (optional) `SUPABASE_BUCKET` — defaults to `uploads`
4. Click **Apply / Deploy**. First build runs `install:all && build`, then `npm start`.

Build command: `npm run install:all && npm run build`
Start command: `npm start`  (→ `node server/index.js`)
Health check: `/api/health`

The server auto-creates the public `uploads` Storage bucket on first start.

## 3. After the first deploy — wire up the URL

Once live you'll have a URL like `https://campusconnect.onrender.com`. Then:

- **Render → Environment:** set `CLIENT_URL=https://campusconnect.onrender.com`
  (used to build the email-confirmation redirect), and redeploy.
- **Supabase → Authentication → URL Configuration:**
  - Site URL: `https://campusconnect.onrender.com`
  - Redirect URLs: add `https://campusconnect.onrender.com/auth/confirm`
- **Paystack → Settings → Webhooks:** set
  `https://campusconnect.onrender.com/api/paystack/webhook`

## 4. Keep it awake (optional)

Render's free service sleeps after ~15 min idle (first request then takes ~50s).
Add a scheduled ping to `/api/health` (e.g. a GitHub Action like the existing
`supabase-keepalive.yml`, or an UptimeRobot monitor) to keep it warm.

## Notes / limits

- **Storage:** Supabase free gives 1 GB of storage; the default per-file upload
  cap is ~50 MB. Photos are auto-shrunk client-side; keep videos small.
- **Old media:** any listings whose photos were saved to the *old* local
  `/uploads/...` path (before this change) won't display in production — re-upload
  them from the provider dashboard. New uploads use Supabase Storage.
- **Local dev is unchanged:** without Supabase env vars the server falls back to
  local disk + `data.json`, and the client still runs via `npm run dev`.
