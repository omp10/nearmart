# Nearmart v2

Backend API and admin/operations web panel for the Nearmart multi-category platform:
Grocery, Vegetables & Fresh Produce, Laundry Services, and Electrical & Electronics.
The customer mobile app is built separately and consumes this API.

```
backend/   Node 20+, Express 5, MongoDB (Mongoose), zod, JWT
admin/     React 19, Vite, Tailwind 4, TanStack Query
deploy/    PM2 + nginx examples
```

## Run locally

Prerequisites: Node 20+ and MongoDB (local install or Atlas).

```bash
cd backend
cp .env.example .env        # fill MONGO_URI and the two JWT secrets
npm install
npm run seed:admin          # needs SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD in env or .env
npm run dev                 # http://localhost:5000/api/v1/health

cd ../admin
npm install
npm run dev                 # http://localhost:5173 (proxies /api to :5000)
```

`npm test` in `backend/` runs the API tests against an in-memory MongoDB (no setup needed).

## API conventions

- Base path `/api/v1`. Bodies: `{ success, message, data }`; errors: `{ success: false, message, details?, code? }`.
- Input is validated with zod at the route; services receive clean data.
- Audiences: customer app at the root paths (e.g. `/catalog/*`), web panel under `/admin/*`. Ops users call
  the same `/admin/*` endpoints; the API limits them to their assigned modules.
- Money is stored and sent as integer paise (`pricePaise: 5950` = ₹59.50).

### Catalogue (Phase 1)

| Endpoint | Who | Notes |
|---|---|---|
| `GET /catalog/modules`, `/catalog/categories?module=` | app | active modules; category tree with hidden branches removed |
| `GET /catalog/products?module&category&q&brand&minPrice&maxPrice&inStock&featured&sort&page` | app | `q` matches word prefixes in name/brand/keywords; stock counts never exposed, only `inStock` and `maxQty` per variant |
| `GET /catalog/products/:idOrSlug`, `/catalog/brands?module=` | app | product detail; brand list for filters |
| `/admin/catalog/modules`, `/categories`, `/products` | panel | CRUD; categories nest 3 levels; module switches are admin-only |
| `/admin/catalog/inventory`, `…/:productId/variants/:variantId/{adjust,stock,threshold}`, `/inventory/movements` | panel | per-variant stock, lowest first; every change goes into a ledger |

### Service areas, addresses and slots (Phase 2)

| Endpoint | Who | Notes |
|---|---|---|
| `GET /serviceability?pincode=&lat=&lng=` | app | which modules can serve a location |
| `PATCH /me`, `/me/addresses` (CRUD) | customer | up to 10 addresses, exactly one default; each comes back with `serviceableModules` |
| `GET /slots?module&kind&pincode&lat&lng&days` | app | upcoming slots by IST date; past-cutoff slots hidden, full ones `available: false` |
| `/admin/zones` (+ `POST /check`) | panel | zones by pincode list and/or GeoJSON polygon; per-zone delivery fee settings for checkout |
| `/admin/slots/rules`, `/blackouts`, `/preview` | panel | weekly slot rules per module/kind (delivery, pickup, return), optional per zone; closed dates |

A location is served when its pincode is listed in a zone or its map pin falls inside the zone's
polygon (MongoDB 2dsphere), so pincode-only service works without a paid map API. Overlapping zones
are ranked by `priority`. Slot ids (`<ruleId>_<date>`) are re-checked at checkout. Capacity is
enforced by a conditional counter, so a slot can't be overbooked under concurrent orders. All dates
and times are IST.

Stock only changes through the inventory endpoints (and orders, from Phase 3). Each change is an
atomic conditional update, so stock can't go negative under concurrent orders. Editing a product never
touches existing variants' stock. A stock change bumps the product's version, so a product form saved
from a stale copy is re-applied to fresh data rather than overwriting the new stock.

### Auth

| Who | How | Session |
|---|---|---|
| Customer (app) | `POST /auth/customer/request-otp` then `/auth/customer/verify-otp` | Access token + refresh token in the body. One device at a time: a new login signs the old phone out. |
| Staff (panel) | `POST /auth/staff/login` (email + password) | Access token in the body; refresh token in an httpOnly cookie. Multiple tabs/devices allowed. |

Refresh tokens rotate on every `POST /auth/refresh`. A token reused after rotation revokes that whole
login's sessions (theft detection), except within 10 seconds, which covers two tabs refreshing at once.
Staff permissions are `section → [view, create, update, delete]`; super admins have everything.
A sub-admin can only grant permissions they hold, and can't change their own access.

In development, `SMS_PROVIDER=console` returns the OTP as `devOtp` in the request-otp response so the
app team can test without an SMS account. The production config refuses this.

## What came from the old repo

Phase 0 is a rewrite of the old platform's foundations, not a copy. Behaviour was kept; these
known problems were fixed:

| Area | Kept | Changed |
|---|---|---|
| OTP | rate limit per phone, attempt cap, SMS India Hub | code stored as HMAC (was plaintext); attempts counted atomically; one-time use guaranteed; SMS template configurable (was hard-coded "Switcheats") |
| Sessions | single-device customers via `tokenVersion` | refresh tokens are opaque, stored hashed, rotated, with reuse detection (were reusable JWTs stored in plaintext); staff sessions end on password change or deactivation |
| Roles | section/action permissions, super/sub admin | one `staff` collection for admin + ops; every admin route checks permissions (old `/payments/admin/*` accepted any logged-in user) |
| Payments | Razorpay webhook with amount check | constant-time signature checks; webhook events deduplicated; client verify fetches the payment to confirm the amount; `Payment` points at any order or booking; no wallet, settlements or payouts (out of scope §12) |
| Push | FCM, dead-token pruning | official `firebase-admin` SDK; tokens in their own collection; in-app inbox |
| Uploads | sharp → WebP, size limits | content is decoded, not trusted from the mimetype; fixed folder allow-list |
| Removed | — | public FCM test routes, hard-coded deploy secret, restaurant/delivery/dining models |

## Roadmap

| Phase | Scope (SOW §) | Backend | Admin panel |
|---|---|---|---|
| **0 (done)** | §9 foundation | config, auth (OTP + staff), roles, uploads, push + inbox, Razorpay, tests | login, layout, permission-aware nav, staff & roles |
| **1 (done)** | §3, §4, §6, §7 | module on/off, nested categories, products with variants (SKU, unit, pack size, selling/offer price, per-variant stock), specs, warranty, produce notes, stock ledger, public browse/search API | categories, products, product editor, inventory |
| **2 (done)** | §2, §5, §7 | service areas (pincodes and/or polygon), customer profile & addresses, serviceability, delivery/pickup/return slots with capacity, closed dates | service areas (with location checker), slots (rules, 7-day preview, closed dates) |
| 3 | §2, §3, §4, §6 | cart (split per module at checkout), server-side pricing & tax, coupons, orders with a per-module status flow, unavailable-item handling, payment events → order status | orders, coupons |
| 4 | §5 | laundry service catalogue (per-kg rates), pickup slots, bookings, weight confirmation and price adjustment | bookings |
| 5 | §7, §8 | dashboard counts, reports + CSV/XLSX export, settings (contact, policies), banners, ops panel views scoped to the user's modules | dashboard, reports, settings, banners |
| 6 | §10 | OpenAPI spec for the app team, load/UAT fixes, deployment | — |

Open decisions to confirm with the client before Phases 2–4 (SOW §11): vendor vs. internal ops,
the cross-category checkout split, how vegetables are priced (fixed pack vs. packed weight),
laundry final-weight handling, and the providers for SMS, payments and maps.
