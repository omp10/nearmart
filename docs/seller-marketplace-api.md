# Nearmart Marketplace Sellers — API guide

> **Status: LIVE.** Independent sellers sign up, apply to sell in one or more shops,
> and once an admin approves them they list products, pack orders and get paid,
> net of Nearmart's commission.

The **seller dashboard** web app at `/seller/` uses this API. A future seller mobile app
uses the same calls with `X-Client: mobile`. This is separate from the store/staff app in
[seller-app-api.md](seller-app-api.md), which is for Nearmart's own staff.

Base URL `https://nearmart.buytogetherindia.com/api/v1`. The envelope, errors, paging and
**money in paise** rules are the same as the other guides.

---

## 1. Lifecycle

```
sign up (phone → OTP verified → details) → draft ──submit──→ submitted ──approve──→ approved ⇄ suspended
                         ↑                  └──reject (reason)──→ rejected ──edit + submit──┘
```

- **draft / rejected:** the seller fills in and submits the application. When rejected, `rejectionReason` says what to fix.
- **submitted:** the application is read-only while the admin reviews it.
- **approved:** the seller can sell. Each shop (`grocery`, `produce`, `electronics`) is approved separately (`modules[].status`), and a request can be limited to top-level categories.
- **suspended:** products are hidden and the selling calls return `403`.

A seller's products are visible to customers only while the seller is **approved, active and
open** (`isOpen`), and only in shops approved for them.

---

## 2. Auth — `/auth/seller`

| Call | Body | Notes |
|---|---|---|
| `POST /signup/request-otp` | `{ phone }` | `409` if the number already has an account. Test server returns `devOtp` |
| `POST /signup/verify-otp` | `{ phone, otp }` | Checks the OTP on its own → `{ signupToken, phone, expiresIn: 1800 }`. Wrong code: `401` |
| `POST /signup` | `{ signupToken, businessName, ownerName, email, password }` | Onboarding, within 30 min of verifying. Password ≥ 10 chars. Expired/invalid token: `401` (verify again). Returns a session (below) |
| `POST /login` | `{ login, password }` | `login` = email or 10-digit phone. Locks for 15 min after 8 wrong passwords |
| `POST /refresh` | `{ refreshToken? }` | Web: from the `nm_srt` cookie. Mobile: in the body |
| `POST /logout` | `{ refreshToken? }` | |
| `POST /forgot/request-otp` → `POST /forgot/reset` | `{ phone }` → `{ phone, otp, password }` | |
| `POST /change-password` | `{ currentPassword, newPassword }` | Signs out everywhere |

Session: `{ accessToken, expiresIn, seller }`. With `X-Client: mobile` the session also includes
`refreshToken`; on the web, the refresh token is the httpOnly cookie `nm_srt` scoped to
`/api/v1/auth/seller`. Send `Authorization: Bearer <accessToken>` on everything below.

---

## 3. Application — `/seller` (any status)

| Call | Body / notes |
|---|---|
| `GET /me` | The seller: `status`, `rejectionReason`, `store`, `address`, `legal`, `bank`, `documents[]`, `modules[]` (`key`, `categories`, `status`), `isOpen`, `commission`, `statusHistory` |
| `PATCH /application` | Any of: `businessName`, `ownerName`, `legal {gstin, pan, fssai}`, `store {description, logo, cover, timings, supportPhone}`, `address {line1, line2, landmark, city, state, pincode, lat, lng}`, `bank {accountName, accountNumber, ifsc, upiId}`, `modules [{ key, categories? }]`. While `submitted`: `409`. After approval: name, tax numbers and modules are locked, and a bank change alerts the admin |
| `GET /catalog/modules` | Shops with their top-level categories, for the "where will you sell" step |
| `POST /documents` | Multipart `file` (PDF/JPEG/PNG/WebP, ≤ 5 MB) + `type`: `gst, pan, fssai, shop_license, cancelled_cheque, id_proof, other`. Stored privately |
| `GET /documents/:docId` | The file (send the bearer token; open it as a blob) |
| `DELETE /documents/:docId` | Only before submitting |
| `POST /application/submit` | `400 "Please add: shop address, PAN, …"` lists anything missing |
| `POST /modules` | `{ key, categories? }`: an approved seller asks to sell in another shop |

## 4. Selling — `/seller`

Catalogue and inventory need an **approved** store. Orders, dashboard, earnings, payouts and commission also work while **suspended**, so orders already received can be finished.

| Call | Notes |
|---|---|
| `GET /dashboard` | `today {orders, salesPaise}`, `openOrders {status: n}`, `lowStockVariants`, `products`, `balance` |
| `POST /store/open` | `{ isOpen }`: the manual switch; off hides the products |
| `PUT /store/hours` | `{ hours: [{ day: 0-6 (0 = Sunday), open: "HH:MM", close: "HH:MM" }], holidays: ["YYYY-MM-DD"] }`. Outside these hours (India time) products hide and checkout is refused. Empty `hours` = always open. `GET /me` returns `tradingNow` |
| `GET /adjustments` | Credits and debits added by Nearmart (refunds after delivery, penalties); settled in the next payout |
| `GET /catalog/categories?module=` | Category tree for the product form |
| `GET/POST /products`, `GET/PATCH/DELETE /products/:id` | Same body as the admin product API. Only the seller's own products, only in approved shops/categories. `isFeatured` is admin-only |
| `GET /inventory`, `POST /inventory/:productId/variants/:variantId/adjust`, `PUT …/stock`, `PATCH …/threshold` | Same as admin inventory |
| `GET /orders?status=open\|placed\|…&from&to&q&page` | The seller's orders (`statusCounts` for tabs). Unpaid online orders aren't shown |
| `GET /orders/:id` | Items, slot, delivery area (no customer phone or street address) |
| `POST /orders/:id/status` | `{ status: "accepted" \| "packing" \| "ready" }`. Dispatch and delivery are handled by Nearmart's riders |
| `POST /orders/:id/items/:lineId/unavailable` | Re-prices the order and refunds the difference if it was paid online |
| `POST /orders/:id/cancel` | `{ reason }`, while placed / accepted / packing |
| `GET /earnings?from&to&page` | `totals {orders, grossPaise, commissionPaise, feePaise, netPaise}`, `balance`, per-order rows |
| `GET /payouts`, `GET /payouts/:id` | Settlements and statements |
| `GET /commission` | Rates per approved shop and `payoutHoldDays` |

New products wait for Nearmart's review when the admin turns reviews on: `review: { status: approved | pending | rejected, note }`; pending and rejected products stay hidden. Tax details are checked on save: PAN format, GSTIN format and checksum, GSTIN matching the PAN, 14-digit FSSAI, IFSC.

Notifications use the shared inbox (`GET /notifications`, …). Types: `seller.approved`,
`seller.rejected`, `seller.suspended`, `seller.module`, `seller.order.new`,
`seller.order.cancelled`, `seller.payout.paid`.

---

## 5. Commission and payouts

For each **delivered** order, the seller earns:

```
gross      = items supplied (lines not marked unavailable)
commission = gross × commissionPercent / 100   (rounded)
fee        = fixedFeePaise per order
net        = gross − commission − fee
```

- **Rates:** the commission % and fee are set when the order is placed. They come from the seller's override, or else the shop's default (Admin → Sellers → Commission settings).
- **Nearmart's share:** the delivery fee and coupon discounts.
- **Payable:** an order becomes payable `payoutHoldDays` after delivery (default 3).
- **Payouts:** the admin bundles payable orders into a **payout** (pending) and pays it outside the app. Marking it paid records the mode and reference and notifies the seller. Each order belongs to at most one payout.

## 6. Admin — `/admin/sellers`, `/admin/payouts`

| Call | Permission |
|---|---|
| `GET /admin/sellers?status&q` (with `counts`), `GET /admin/sellers/:id`, `GET …/:id/documents/:docId` | `sellers.view` |
| `POST …/:id/approve { modules?, commissionPercent?, fixedFeePaise?, note? }`, `POST …/:id/reject { reason }`, `POST …/:id/suspend { reason }` | `sellers.update` |
| `POST …/:id/modules/:key { decision: approved\|rejected, note? }`, `PATCH …/:id { commission: { percent, fixedFeePaise, byModule: { grocery: { percent, fixedFeePaise } } }, zones, isActive }` | `sellers.update` |
| `GET /admin/sellers/products/review?status=pending`, `POST /admin/sellers/products/:id/review { decision, note? }` | `sellers.view` / `update` |
| `GET/POST /admin/sellers/:id/adjustments { amountPaise (±), reason, orderId? }`, `DELETE …/adjustments/:adjId` (unsettled only) | `payouts.view` / `create` / `update` |
| `GET /admin/payouts/report?from&to`: commission, fees, seller-funded discounts and seller earnings per seller | `payouts.view` |
| `GET/PUT /admin/sellers/config { commission: { grocery: { percent, fixedFeePaise } … }, payoutHoldDays, acceptAlertMinutes, reviewNewProducts }` | `sellers.view` / `update` |
| `GET /admin/payouts/balances`, `GET /admin/payouts`, `GET /admin/payouts/:id`, `GET /admin/payouts/sellers/:id/earnings` | `payouts.view` |
| `POST /admin/payouts { sellerId }` · `POST /:id/paid { mode, reference?, note? }` · `POST /:id/cancel` | `payouts.create` / `update` |

Commission precedence: the seller's rate for that shop → the seller's rate for all shops → the shop default. A payout saves the bank details it's paid to, includes unsettled adjustments, and deducts seller-funded coupon discounts. If debits outweigh earnings, nothing is paid and the balance carries over.

If a seller hasn't accepted an order within `acceptAlertMinutes`, staff get a `staff.order.seller_late` alert and the seller a `seller.order.reminder`, once. Nothing is cancelled automatically.

Coupons can be limited to one seller (`seller`) and paid for by that seller (`fundedBy: "seller"`).

## 7. Customer app changes

- **Service areas:** addresses carry `zones: { grocery: zoneId, … }`. Pass the ids as `zone=id1,id2` on `GET /catalog/products` to hide sellers that don't deliver there.
- **Same trip:** a second order to the same address in the same shop within 30 minutes of an open order has no delivery fee and no minimum; the quote returns `trip: { withOrder }`.
- **Product badge:** products carry `soldBy: { id, name }`, or `null` for Nearmart's own stock.
- **Cart:** each cart group (one per shop) has `sellers: [{ sellerId, name, subtotalPaise, itemCount }]`.
- **Checkout:** one order per seller. When a shop's cart mixes sellers, `POST /checkout/quote` and `POST /checkout` without `sellerId` return `409` with `details: [{ sellerId, name, issue: "choose_seller" }]`. Send `sellerId` (`""` = Nearmart) to check out that store's items; the rest stay in the cart. Carts with a single store work exactly as before.
- **Quote:** the checkout quote includes `seller: { id, name } | null`.
- **Riders:** rider pickups for a seller's orders go to the seller's shop address and pin.
