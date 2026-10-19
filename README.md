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
- Audiences: customer app at the root paths, admin panel under `/admin/*`, ops panel under `/ops/*`.
- Money is stored as integer paise wherever it touches payments.

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
| 1 | §3, §6, §7 | modules, nested categories, products with variants (SKU, unit, pack size, MRP/offer price, per-variant stock), specs & warranty fields | catalogue, categories, inventory |
| 2 | §2 location | service areas (pincode list and/or polygon), customer addresses, serviceability check, delivery slots | zones, slots |
| 3 | §2, §3, §4, §6 | cart (split per module at checkout), server-side pricing & tax, coupons, orders with a per-module status flow, unavailable-item handling, payment events → order status | orders, coupons |
| 4 | §5 | laundry service catalogue (per-kg rates), pickup slots, bookings, weight confirmation and price adjustment | bookings |
| 5 | §7, §8 | dashboard counts, reports + CSV/XLSX export, settings (contact, policies), banners, ops panel views scoped to the user's modules | dashboard, reports, settings, banners |
| 6 | §10 | OpenAPI spec for the app team, load/UAT fixes, deployment | — |

Open decisions to confirm with the client before Phases 2–4 (SOW §11): vendor vs. internal ops,
the cross-category checkout split, how vegetables are priced (fixed pack vs. packed weight),
laundry final-weight handling, and the providers for SMS, payments and maps.
