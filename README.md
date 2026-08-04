# CampusConnect

**A Smart Courier & On-Demand Service Marketplace for KNUST**

A full-stack web app that lets students and staff browse campus services
(printing, food runs, repairs, tech help, photography, courier delivery and
more), place on-demand orders, and have them delivered to their hall — while
service providers manage listings and fulfil orders from a dashboard.

Built from the CampusConnect project proposal. Matches the proposed stack
(React frontend, Node.js backend) and uses a zero-config local JSON datastore
so it runs with no external accounts. Google Maps & Payment integrations are
represented as working mock flows (delivery location + MoMo/cash) ready to be
swapped for the real APIs.

## Tech stack
- **Frontend:** React 18 + React Router + Vite
- **Backend:** Node.js + Express, JWT auth, bcrypt password hashing
- **Database:** JSON file store (`server/data.json`) — drop-in replaceable with MongoDB/Firestore

## Features
- Email/password auth with two roles: **Customer** and **Provider**
- Browse / search services across categories (printing, gas refill, repairs, rentals, secondhand & more) — providers can create new categories when what they offer isn't listed
- Place orders with delivery location, courier option, and payment method
- Full order lifecycle: requested → accepted → in progress → out for delivery → delivered → completed (+ cancel)
- Customer order tracking with status timeline
- Provider dashboard: publish/hide listings, manage incoming orders, see earnings

## Getting started

Requires Node.js 18+.

```bash
cd campusconnect
npm run install:all     # installs root, server and client deps
npm run dev             # starts API (:4000) and web app (:5173) together
```

Then open **http://localhost:5173**.

> Running the two parts separately instead:
> `npm --prefix server run dev` and `npm --prefix client run dev`.

### Demo accounts (password: `password`)
| Role | Email |
|------|-------|
| Customer | `student@knust.edu.gh` |
| Provider | `kwame@knust.edu.gh` (also `adjoa@`, `yaw@`, `kojo@`, `esi@`) |

Or register a new account from the Sign up page.

## Try the full flow
1. Log in as the **customer**, open a service, place an order (pick courier + MoMo).
2. Log out, log in as the **provider** (`kwame@knust.edu.gh`).
3. In **Dashboard / My Orders**, advance the order through to *Delivered*.
4. Log back in as the customer and **Confirm received** to complete it.

## API overview
`POST /api/auth/register` · `POST /api/auth/login` · `GET /api/auth/me`
`GET /api/categories`
`GET /api/services` · `GET /api/services/:id` · `GET /api/services/mine` · `POST /api/services` · `PATCH /api/services/:id`
`POST /api/orders` · `GET /api/orders` · `GET /api/orders/:id` · `PATCH /api/orders/:id/status`

## Resetting demo data
Delete `server/data.json` and restart the server — it reseeds automatically.

## Going to production
- Replace the JSON store in `server/db.js` with MongoDB (Mongoose) or Firestore.
- Wire the order `payment` block to a real gateway (Paystack/Flutterwave/MoMo).
- Add Google Maps API for live courier tracking on the delivery location.
- Set `JWT_SECRET` and `PORT` via environment variables.

---
Group members: Michael Kwarteng Anim (3371022), Adjei Albert Arko (3362822)
