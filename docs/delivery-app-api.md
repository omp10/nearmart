# Nearmart Delivery Partner App — API spec

> **Status: NOT LIVE YET.** The server does not have delivery-partner accounts or
> order assignment today. This document is the **agreed contract** the backend
> will implement, so the Flutter app can be built against it now. Endpoints marked
> ✅ already exist; everything under `/rider` and `/auth/rider` is 🚧 to be built.
> Until then, use the mock responses below.

For the Flutter developer building the **delivery partner (rider) app**: riders sign in
with their phone, go online, receive delivery tasks (shop orders, laundry pickups and
returns), navigate, and mark pickup / delivery with an OTP and cash collection.

---

## 1. Basics

Same conventions as the seller app (see `seller-app-api.md` §1):

| | |
|---|---|
| Base URL | `https://nearmart.buytogetherindia.com/api/v1` |
| Auth | `Authorization: Bearer <accessToken>` |
| Envelope | `{ "success": true, "message": "OK", "data": … }`; errors `{ "success": false, "message", "code", "details" }` |
| Money | paise (integer) |
| Coordinates | Requests use `{ "lat", "lng" }`; GeoJSON in responses is `[lng, lat]` |
| Paging | `page`, `limit` → `{ items, page, limit, total, pages }` |

---

## 2. Sign in (phone OTP) 🚧

Riders are created by an admin in **Admin → Delivery partners** (name, phone, shops,
vehicle). Only registered numbers can sign in.

### `POST /auth/rider/request-otp`
```json
{ "phone": "9876543210" }
```
`data`: `{ "expiresInSeconds": 300, "resendAfterSeconds": 30 }`.
Unregistered number → `403 "This number isn't registered as a Nearmart delivery partner"`.

### `POST /auth/rider/verify-otp`
```json
{ "phone": "9876543210", "otp": "123456", "device": { "token": "<FCM token>", "platform": "android" } }
```
`data`:
```json
{
  "accessToken": "eyJ…", "refreshToken": "c81f…", "expiresIn": 900,
  "rider": { "id": "6b01…", "name": "Suresh", "phone": "9876543210", "vehicle": "bike",
             "modules": ["grocery", "produce", "laundry"], "isOnline": false, "rating": 4.8 }
}
```

### `POST /auth/refresh` ✅ — `{ "refreshToken" }` → new `accessToken` + new `refreshToken` (save both).
### `POST /auth/logout` ✅ — `{ "refreshToken" }`.

Refresh rule: on `401`, refresh once and retry; if refresh fails with 400/401/403, sign out.

---

## 3. Rider profile & shift 🚧

| Call | Body | Notes |
|---|---|---|
| `GET /rider/me` | — | Profile + `isOnline`, today's summary `{ deliveries, earningsPaise, cashInHandPaise }` |
| `POST /rider/shift` | `{ "online": true }` | Go online/offline. Offline riders get no new tasks. Can't go offline with an active task (`409`) |
| `POST /rider/location` | `{ "lat": 22.72, "lng": 75.88, "heading": 90, "speed": 6.2, "accuracy": 12 }` | Send every **15 s** while online (and on significant movement). Use a foreground service on Android |

---

## 4. Tasks 🚧

A **task** is one trip leg. Kinds:

| `kind` | From → To | Completes |
|---|---|---|
| `order_delivery` | Store → customer | Order `ready → dispatched → delivered` |
| `laundry_pickup` | Customer → laundry | Booking `pickup_scheduled → picked_up` |
| `laundry_return` | Laundry → customer | Booking `out_for_return → completed` |

### Task status

```
offered → accepted → at_pickup → picked_up → at_drop → completed
   └→ (rejected / expired: offered to the next rider)     └→ failed (customer unreachable etc.)
```

### Task object

```json
{
  "_id": "6b02…",
  "kind": "order_delivery",
  "status": "accepted",
  "module": "grocery",
  "ref": { "type": "order", "id": "6ae0…", "number": "NM-241027-0042" },
  "pickup": { "name": "Nearmart Grocery – Palasia", "phone": "0731…", "address": "…", "location": { "lat": 22.7246, "lng": 75.8839 } },
  "drop":   { "name": "Ravi Sharma", "phone": "98765…", "address": "12 MG Road, Palasia, Indore 452001",
              "landmark": "Near SBI ATM", "location": { "lat": 22.7301, "lng": 75.8812 } },
  "items": [ { "name": "Tata Tea Gold", "variantLabel": "500 g", "qty": 2 } ],
  "itemCount": 5,
  "slot": { "date": "2026-10-27", "label": "6:00 PM – 8:00 PM" },
  "payment": { "method": "cod", "collectPaise": 32500 },
  "distanceMeters": 2400,
  "payoutPaise": 3500,
  "offerExpiresAt": "2026-10-27T12:31:00.000Z",
  "requiresOtp": true,
  "notes": "Ring the bell twice",
  "timeline": [ { "status": "accepted", "at": "2026-10-27T12:30:20.000Z" } ]
}
```

- `payment.collectPaise` > 0 → **collect cash/UPI** before completing. `0` = prepaid.
- `requiresOtp` → ask the customer for the 4-digit code shown in their app.
- Customer phone is masked/proxied server-side later; for now it's the real number — use `tel:`.

### Calls

| Call | Body | Effect |
|---|---|---|
| `GET /rider/tasks?status=active` | — | Offered + in-progress tasks (usually 0–3) |
| `GET /rider/tasks?status=done&from=YYYY-MM-DD&to=YYYY-MM-DD&page=1` | — | History |
| `GET /rider/tasks/:id` | — | One task |
| `POST /rider/tasks/:id/accept` | — | `offered → accepted`. `409` if it expired or someone else took it |
| `POST /rider/tasks/:id/reject` | `{ "reason": "Too far" }` | Offer goes to the next rider |
| `POST /rider/tasks/:id/arrived` | `{ "lat", "lng" }` | `accepted → at_pickup` or `picked_up → at_drop` (server checks you're within ~200 m) |
| `POST /rider/tasks/:id/picked-up` | `{ "lat", "lng", "photo": "<url optional>" }` | Order → `dispatched` / laundry pickup → `picked_up`. Customer is notified |
| `POST /rider/tasks/:id/complete` | `{ "lat", "lng", "otp": "4821", "collectedPaise": 32500, "collectionMode": "cash" \| "upi", "photo": "<url optional>" }` | Order → `delivered` / booking `completed` (return) or hands over at laundry (pickup) |
| `POST /rider/tasks/:id/fail` | `{ "reason": "customer_unreachable" \| "wrong_address" \| "refused" \| "other", "note": "…" }` | Store is alerted to reschedule |
| `POST /uploads/image?folder=deliveries` ✅ (multipart `file`) | — | Proof-of-delivery photo → `{ "url" }` |

Errors to handle: wrong OTP `400 "That code doesn't match"`, cash mismatch `400`,
already completed `409`.

---

## 5. Live updates 🚧

- **Push (FCM)** for new offers: `type: "rider.task.offer"`, `data: { taskId, expiresAt }` —
  play a loud sound, show a full-screen accept card with a countdown to `offerExpiresAt`.
- Other pushes: `rider.task.cancelled` (customer/store cancelled — remove it),
  `rider.task.updated` (address/notes changed).
- Also poll `GET /rider/tasks?status=active` every **20 s** while online, as a fallback.
- Inbox ✅: `GET /notifications`, `POST /notifications/:id/read`, `POST /notifications/read-all`.
- Device ✅: `POST /notifications/devices` `{ token, platform }` after login.

---

## 6. Earnings & cash 🚧

| Call | Returns |
|---|---|
| `GET /rider/earnings?from=YYYY-MM-DD&to=YYYY-MM-DD` | `{ totalPaise, deliveries, perDay: [ { date, deliveries, earningsPaise } ], tipsPaise, incentivesPaise }` |
| `GET /rider/cash` | `{ inHandPaise, pendingDeposits: [ … ] }` — COD collected and not yet deposited |
| `POST /rider/cash/deposit` | `{ "amountPaise": 120000, "mode": "upi" \| "store", "reference": "UPI ref" }` — store/admin confirms it |

---

## 7. Suggested app screens

1. **Login** — phone → OTP (auto-read SMS).
2. **Home** — big Online/Offline switch, today's deliveries / earnings / cash in hand, map with your position.
3. **Offer card** — full-screen, sound, countdown, pickup & drop distance, payout, Accept / Reject.
4. **Active task** — stepper (Go to pickup → Picked up → Go to customer → Deliver), Google Maps navigation button (`google.navigation:q=lat,lng`), call store / call customer, item list, notes.
5. **Deliver** — OTP boxes, "Collect ₹325 cash" confirmation (cash / UPI), optional photo, swipe-to-complete.
6. **Fail delivery** — reason picker.
7. **History** and **Earnings** (date range), **Cash** with deposit.
8. **Profile** — vehicle, documents later, sign out.

Permissions: location (foreground + background for shifts), notifications, camera (photo proof).

---

## 8. Mock data for building now

Until the 🚧 endpoints are live, point the app at a mock that returns the task object
above for `GET /rider/tasks?status=active` and `{ "success": true, "message": "OK", "data": … }`
for every action. Keep the API layer behind one interface so switching to the real
server is a base-URL change.
