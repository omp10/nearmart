# Nearmart Seller (Store) App — API guide

For the Flutter developer building the **store / seller app**: the app store staff
use to receive orders, pack them, update stock and run laundry bookings.

Everything here is **live** on the production server. The seller app signs in as a
**staff user** (the same accounts as the admin panel), so it sees only the shops
and actions that user was given in **Admin → Staff**.

---

## 1. Basics

| | |
|---|---|
| Base URL | `https://nearmart.buytogetherindia.com/api/v1` |
| Format | JSON in, JSON out (`Content-Type: application/json`) |
| Auth | `Authorization: Bearer <accessToken>` on every call except login/refresh |
| Mobile flag | Send **`X-Client: mobile`** on **every** request (it makes login/refresh return the refresh token in the body) |
| Money | Always **paise** (integer). ₹49.90 = `4990`. Show with 2 decimals only when not a whole rupee |
| Dates | ISO 8601 UTC (`2026-10-27T08:30:00.000Z`); slot dates are `YYYY-MM-DD` (India time) |
| IDs | 24-char hex strings (`_id`) |

### Response envelope

Every response looks like this — read `data`:

```json
{ "success": true, "message": "OK", "data": { } }
```

Errors:

```json
{ "success": false, "message": "Order can't move from placed to delivered", "code": "BAD_REQUEST", "details": [ { "path": "status", "message": "…" } ] }
```

Show `message` to the user as is (it's written for people). `details` (field-level errors) appears on validation failures — use it to highlight form fields. Status codes: `400` bad
input · `401` not signed in / token expired · `403` no permission for that shop or
section · `404` not found · `409` conflict (e.g. order already moved on) · `429` too
many requests · `5xx` server problem (retry).

### Lists (paging)

List endpoints take `page` (default 1) and `limit` (default 20, max 100) and return:

```json
{ "items": [ … ], "page": 1, "limit": 20, "total": 134, "pages": 7 }
```

---

## 2. Sign in

### `POST /auth/staff/login`

```json
{ "email": "store@nearmart.in", "password": "••••••••••" }
```

Response `data` (with `X-Client: mobile`):

```json
{
  "accessToken": "eyJ…",
  "refreshToken": "f3a9…",
  "expiresIn": 900,
  "user": {
    "id": "6adf…",
    "name": "Indore Grocery Store",
    "email": "store@nearmart.in",
    "phone": "9876543210",
    "role": "ops",
    "isSuperAdmin": false,
    "modules": ["grocery", "produce"],
    "permissions": { "orders": ["view", "update"], "inventory": ["view", "update"], "dashboard": ["view"] }
  }
}
```

Store both tokens in secure storage (`flutter_secure_storage`).

- **`modules`** — the shops this user runs: `grocery`, `produce`, `laundry`, `electronics`.
  `role: "admin"` / `isSuperAdmin: true` means all shops.
- **`permissions`** — section → allowed actions (`view`, `create`, `update`, `delete`).
  Hide screens/buttons the user isn't allowed: e.g. no `inventory.update` → hide stock
  editing. Sections: `dashboard, catalog, inventory, orders, bookings, customers, zones,
  banners, coupons, reports, settings, staff`.

### `POST /auth/refresh`

The access token lasts ~15 min (`expiresIn` seconds). On any `401`, refresh **once**
and retry the request; if refresh also fails with 400/401/403, sign the user out.

```json
{ "refreshToken": "f3a9…" }
```

Returns new `accessToken` **and a new `refreshToken`** — always save the new one (the
old one stops working). Do only one refresh at a time; queue other requests behind it.

### `GET /auth/me` — current user (same shape as `user` above).
### `POST /auth/logout` — `{ "refreshToken": "…" }`.
### `POST /auth/staff/change-password` — `{ "currentPassword", "newPassword" }` (min 10 chars). Signs out everywhere; send the user back to login.

---

## 3. New-order alerts (push)

Staff get a push + inbox entry when a new order or laundry booking arrives for their
shops.

| Call | Purpose |
|---|---|
| `POST /notifications/devices` `{ "token": "<FCM token>", "platform": "android" }` | Register the phone after sign-in (and whenever FCM gives a new token) |
| `DELETE /notifications/devices` `{ "token": "…" }` | On sign-out |
| `GET /notifications?page=1&limit=20` | Inbox → `{ items, page, limit, total, unread }`; each item `{ _id, title, body, data, readAt, createdAt }` |
| `POST /notifications/:id/read` | Mark one read |
| `POST /notifications/read-all` | Mark all read |

Alert payloads carry `type` and `data`: new order → `type: "staff.order.new", data: { orderId }`; laundry → `data: { bookingId }`. Use them to open the right screen on tap. Also poll the
open-orders list every ~30 s while the Orders screen is visible, in case a push is missed.

---

## 4. Dashboard

### `GET /admin/dashboard?module=grocery`

`module` optional (omit = all the user's shops). Returns today's numbers (orders,
revenue, pending orders, low-stock items, bookings). Render whatever counts are
present; treat missing fields as 0.

---

## 5. Orders (grocery, fresh produce, electricals)

### Status flow

```
pending_payment ─(paid online)→ placed → accepted → packing → ready → dispatched → delivered
                                  └────────── cancelled  (allowed until "ready")
```

| Status | Label to show | Store action that moves it on |
|---|---|---|
| `pending_payment` | Awaiting payment | — (customer is paying; auto-cancels if unpaid) |
| `placed` | New order | **Accept** → `accepted` |
| `accepted` | Confirmed | **Start packing** → `packing` |
| `packing` | Being packed | **Packed** → `ready` |
| `ready` | Ready for dispatch | **Hand to delivery** → `dispatched` |
| `dispatched` | Out for delivery | **Delivered** → `delivered` |
| `delivered` | Delivered | — |
| `cancelled` | Cancelled | — |

Only the **next** step is allowed (you can't jump from `placed` to `delivered`). The
customer gets a push notification at each step automatically.

### `GET /admin/orders`

Query: `page, limit, module (grocery|produce|electronics), status (any status above, or "open" = all not finished), from, to (dates), slotDate (YYYY-MM-DD), q (order number or customer phone)`.

Typical screens: **New** = `status=placed`, **Active** = `status=open`, **Today's deliveries** = `slotDate=<today>`.

Each order:

```json
{
  "_id": "6ae0…",
  "orderNumber": "NM-241027-0042",
  "module": "grocery",
  "status": "placed",
  "items": [
    { "_id": "line1…", "product": "6adf…", "variant": "6adf…", "name": "Tata Tea Gold", "variantLabel": "500 g",
      "sku": "TT-500", "image": "https://…/tea.webp", "qty": 2, "mrpPaise": 16500, "unitPricePaise": 15000,
      "lineTotalPaise": 30000, "status": "ok" }
  ],
  "address": { "name": "Ravi", "phone": "98…", "line1": "12 MG Road", "line2": "Palasia", "landmark": "", "city": "Indore",
               "state": "Madhya Pradesh", "pincode": "452001", "location": { "type": "Point", "coordinates": [75.88, 22.72] } },
  "customerPhone": "9876500001",
  "slot": { "id": "…", "date": "2026-10-27", "label": "6:00 PM – 8:00 PM" },
  "pricing": { "subtotalPaise": 30000, "discountPaise": 0, "deliveryFeePaise": 2500, "taxPaise": 0, "totalPaise": 32500, "savingsPaise": 3000 },
  "coupon": { "code": "WELCOME50", "discountPaise": 5000 },
  "payment": { "method": "cod", "status": "pending" },
  "notes": "",
  "statusHistory": [ { "status": "placed", "at": "2026-10-27T08:30:00.000Z", "note": "" } ],
  "cancelReason": "",
  "createdAt": "2026-10-27T08:30:00.000Z"
}
```

Notes: `location.coordinates` is **[lng, lat]** (open Google Maps with `lat,lng`).
`payment.method: "cod"` → collect `pricing.totalPaise` in cash/UPI at the door.

### `GET /admin/orders/:id` — one order (same shape).

### `POST /admin/orders/:id/status`

```json
{ "status": "accepted", "note": "optional, shown in history" }
```

Returns the updated order. `409`/`400` with a clear message if the order already
moved on (refresh and show the message).

### `POST /admin/orders/:id/items/:lineId/unavailable`

Mark one line out of stock while `placed`, `accepted` or `packing`. The total is
re-priced (coupon recalculated); online-paid orders are refunded the difference automatically and COD customers simply pay the new total. The customer is notified. `:lineId` is the
item's `_id`. Body: `{ "note": "optional" }`. If every line becomes unavailable the
order is cancelled.

### `POST /admin/orders/:id/cancel`

`{ "reason": "Customer asked to cancel" }` (min 3 chars). Allowed until `ready`.
Online-paid orders are refunded automatically.

### `POST /admin/orders/:id/retry-refund` — retry a refund that failed (`payment.status = refund_pending`).

---

## 6. Laundry bookings (only for users with the `laundry` shop)

### Status flow

```
pending_payment → placed → pickup_scheduled → picked_up → weighed → processing → ready → out_for_return → completed
                     └────── cancelled  (until picked up)
```

| Status | Store action |
|---|---|
| `placed` | **Confirm pickup** → `pickup_scheduled` |
| `pickup_scheduled` | **Picked up** → `picked_up` |
| `picked_up` | **Weigh** (sets final price) → `weighed` — use the weigh call, not the status call |
| `weighed` | **Start cleaning** → `processing` |
| `processing` | **Ready** → `ready` |
| `ready` | **Out for return** → `out_for_return` |
| `out_for_return` | **Delivered** → `completed` |

### Calls

| Call | Body / query |
|---|---|
| `GET /admin/laundry/bookings` | `page, limit, status (or "active"), pickupDate (YYYY-MM-DD), q` |
| `GET /admin/laundry/bookings/:id` | — |
| `POST /admin/laundry/bookings/:id/status` | `{ "status": "pickup_scheduled", "note": "…" }` |
| `POST /admin/laundry/bookings/:id/weigh` | `{ "lines": [ { "lineId": "<item _id>", "finalQty": 3.5 } ], "note": "…" }` — final kg/pieces per line |
| `POST /admin/laundry/bookings/:id/return-slot` | `{ "slotId": "…" }` (get slots from `GET /slots?module=laundry&kind=return&lat=…&lng=…&pincode=…&days=4`) |
| `POST /admin/laundry/bookings/:id/cancel` | `{ "reason": "…" }` |
| `POST /admin/laundry/bookings/:id/retry-refund` | — |
| `GET /admin/laundry/services` | Price list (`name, pricingUnit kg|piece, ratePaise, minQty, turnaroundHours, isActive`) |
| `PATCH /admin/laundry/services/:id` | Change a rate / switch a service off (needs `catalog.update`) |

A booking has `items[] { _id, name, pricingUnit, estimatedQty, estimatePaise, finalQty, finalPaise }`,
`pricing { estimatePaise, finalPaise, deliveryFeePaise, totalPaise }`,
`payment { method, status, balanceDuePaise }`, `pickupSlot`, `returnSlot`, `address`, `instructions`.

---

## 7. Stock (inventory)

| Call | Purpose |
|---|---|
| `GET /admin/catalog/inventory?module=grocery&stock=low&q=atta&page=1` | Products with their variants' stock. `stock`: `in` · `out` · `low` |
| `POST /admin/catalog/inventory/:productId/variants/:variantId/adjust` | Add/remove stock: `{ "delta": 24, "reason": "restock", "note": "Morning delivery" }` (`reason`: `restock` or `adjustment`; `delta` can be negative) |
| `PUT /admin/catalog/inventory/:productId/variants/:variantId/stock` | Set exact count after a stock-take: `{ "quantity": 40, "note": "…" }` |
| `PATCH /admin/catalog/inventory/:productId/variants/:variantId/threshold` | Low-stock alert level: `{ "threshold": 5 }` |
| `GET /admin/catalog/inventory/movements?productId=…&variantId=…` | Stock history |

Suggested screen: list with a search box, `Low` / `Out` filter chips, and a ± sheet per
variant. A barcode scanner can search with `q=<sku>`.

---

## 8. Products & categories (if the user has `catalog` permissions)

| Call | Notes |
|---|---|
| `GET /admin/catalog/categories?module=grocery` | Tree for pickers |
| `GET /admin/catalog/products?module=&category=&q=&status=active\|inactive&stock=&sort=newest\|name\|price_asc\|price_desc\|stock_asc&page=` | |
| `GET /admin/catalog/products/:id` | |
| `POST /admin/catalog/products` | See body below |
| `PATCH /admin/catalog/products/:id` | Any subset of the fields below (e.g. `{ "isActive": false }` to hide) |
| `DELETE /admin/catalog/products/:id` | |
| `POST /uploads/image?folder=catalog` | **multipart**, field `file` (jpg/png/webp). Returns `{ "url": "https://…" }` — put it in `images` |

Product body:

```json
{
  "module": "grocery",
  "category": "<category id>",
  "name": "Aashirvaad Whole Wheat Atta",
  "brand": "Aashirvaad",
  "description": "…",
  "images": ["https://…/atta.webp"],
  "gstRate": 5,
  "isActive": true,
  "isFeatured": false,
  "variants": [
    { "label": "1 kg", "unit": "kg", "unitQty": 1, "pricePaise": 6800, "offerPricePaise": 6200,
      "stockQty": 50, "lowStockThreshold": 5, "maxPerOrder": 10, "sku": "AASH-1KG", "isActive": true }
  ]
}
```

`unit`: `kg g l ml piece pack bunch dozen box` · `gstRate`: `0 5 12 18 28` ·
when updating variants send each existing variant's `_id` so its stock is kept.

---

## 9. Reports

`GET /admin/reports/:type?from=YYYY-MM-DD&to=YYYY-MM-DD&module=grocery&format=json`

`type`: `orders` · `sales` · `availability` · `bookings`. `format=csv` or `xlsx` downloads a file.

---

## 10. Suggested app screens

1. **Login** (email + password) → store tokens, register FCM device.
2. **Home / Dashboard** — today's counts, shop switcher if `modules.length > 1`.
3. **Orders** — tabs *New* (`placed`), *Preparing* (`accepted`,`packing`), *Ready* (`ready`), *Out* (`dispatched`), *Done*. Big action button per card for the next status; swipe/menu for Cancel. Sound + vibration on new order push.
4. **Order detail** — items with images and "Mark unavailable", customer call button (`tel:`), map button, COD amount, history timeline.
5. **Laundry** (if `laundry` in modules) — bookings by status, weighing form.
6. **Stock** — search, low/out filters, ± adjust.
7. **Products** (if allowed) — list, edit price/offer/active, add with photo upload.
8. **Notifications** — inbox.
9. **Profile** — change password, sign out.

## 11. Test account

Ask the Nearmart admin to create an **ops** user in **Admin → Staff** with the shops and
permissions the store needs (at least `orders: view, update`, `inventory: view, update`,
`dashboard: view`). Use that email/password in the app.
