# Nearmart Delivery Partner App — API guide

> **Status: LIVE.** Every endpoint below works on the production server.

For the Flutter developer building the **delivery partner (rider) app**: partners sign
in with their phone, go online, receive tasks (shop deliveries, laundry pickups and
returns), navigate, and complete them with the customer's code and cash collection.

Partners are created by the store in **Admin → Delivery partners**. The store assigns
each task to a partner from the order / booking page; the partner gets a push and
accepts it in the app.

---

## 1. Basics

| | |
|---|---|
| Base URL | `https://nearmart.buytogetherindia.com/api/v1` |
| Auth | `Authorization: Bearer <accessToken>` on everything except the two OTP calls and refresh |
| Envelope | `{ "success": true, "message": "OK", "data": … }` — read `data` |
| Errors | `{ "success": false, "message": "…", "code"?, "details"?: [ { "path", "message" } ] }` — show `message` |
| Money | **paise** (integer). ₹160 = `16000` |
| Dates | ISO 8601 UTC; date filters are `YYYY-MM-DD` (India time) |
| Paging | `page`, `limit` (max 100) → `{ items, page, limit, total, pages }` |

Status codes: `400` bad input (e.g. wrong code) · `401` token expired / signed in on
another phone · `403` not a partner / switched off · `404` · `409` state changed (task
taken back, order not packed yet) — refresh and show `message` · `429` slow down.

---

## 2. Sign in (phone OTP)

### `POST /auth/rider/request-otp`
```json
{ "phone": "9876543210" }
```
→ `data: {}` (on the test server also `{ "devOtp": "123456" }`).
Unregistered number → `403 "This number isn't registered as a Nearmart delivery partner"`.

### `POST /auth/rider/verify-otp`
```json
{ "phone": "9876543210", "otp": "123456", "device": { "token": "<FCM token>", "platform": "android" } }
```
`device` is optional but recommended (registers push). Response:
```json
{
  "accessToken": "eyJ…", "refreshToken": "c81f…", "expiresIn": 900,
  "rider": { "id": "6b01…", "name": "Suresh", "phone": "9876543210", "vehicle": "bike",
             "modules": ["grocery", "produce"], "isOnline": false,
             "payoutPerTaskPaise": 3000, "cashInHandPaise": 0 }
}
```
`modules` empty = works for all shops. One phone at a time: signing in elsewhere ends
the old session (it gets `401`).

### `POST /auth/refresh` — `{ "refreshToken" }` → new `accessToken` **and** new `refreshToken` (save both; the old one is dead).
On a `401`, refresh once and retry; if refresh fails (400/401/403) go to login. One refresh at a time.

### `POST /auth/logout` — `{ "refreshToken" }`.  `GET /auth/me` — the `rider` object.

---

## 3. Profile, shift, location

| Call | Body | Notes |
|---|---|---|
| `GET /rider/me` | — | `rider` fields + `today: { deliveries, earningsPaise, cashInHandPaise }` |
| `POST /rider/shift` | `{ "online": true }` | Go online/offline. `409` going offline with an accepted task |
| `POST /rider/location` | `{ "lat": 22.72, "lng": 75.88, "heading": 90, "speed": 6.2, "accuracy": 12 }` | Every **15 s** while online (foreground service). The admin shows a partner as online only if a ping arrived in the last 10 min |

---

## 4. Tasks

| `kind` | From → To | What it moves |
|---|---|---|
| `order_delivery` | Store → customer | Order `ready → dispatched → delivered` |
| `laundry_pickup` | Customer → laundry | Booking `pickup_scheduled → picked_up` |
| `laundry_return` | Laundry → customer | Booking `ready → out_for_return → completed` |

### Status flow
```
offered ──accept──→ accepted ──arrived──→ at_pickup ──picked-up──→ picked_up ──arrived──→ at_drop ──complete──→ completed
   ├─reject─→ rejected                      (arrived is optional; picked-up / complete work from the previous step too)
   └─(10 min, no answer)─→ expired          any active step ──fail──→ failed      store can ──→ cancelled
```

### Task object
```json
{
  "_id": "6b02…",
  "kind": "order_delivery",
  "status": "offered",
  "module": "grocery",
  "ref": { "type": "order", "id": "6ae0…", "number": "NM-241027-0042" },
  "rider": "6b01…",
  "pickup": { "name": "Nearmart Grocery", "phone": "0731…", "address": "…", "landmark": "", "lat": null, "lng": null },
  "drop":   { "name": "Ravi Sharma", "phone": "98765…", "address": "12 MG Road, Palasia, Indore, 452001",
              "landmark": "Near SBI ATM", "lat": 22.7301, "lng": 75.8812 },
  "items": [ { "name": "Tata Tea Gold", "variantLabel": "500 g", "qty": 2 } ],
  "slot": { "date": "2026-10-27", "label": "6:00 PM – 8:00 PM" },
  "notes": "Ring the bell twice",
  "payment": { "method": "cod", "collectPaise": 32500 },
  "requiresOtp": true,
  "payoutPaise": 3000,
  "offerExpiresAt": "2026-10-27T12:40:00.000Z",
  "collected": null,
  "photos": [],
  "failReason": null, "failNote": "",
  "timeline": [ { "status": "offered", "at": "2026-10-27T12:30:00.000Z", "note": "Assigned by the store" } ],
  "createdAt": "…", "updatedAt": "…", "completedAt": null
}
```
- **`pickup` / `drop` `lat`/`lng` can be `null`** (store location isn't stored yet; old addresses may have no pin) — then navigate by `address`.
- **`payment.collectPaise > 0`** → collect exactly that before completing (cash or UPI). `0` = prepaid.
- **`requiresOtp: true`** (deliveries and laundry returns) → ask the customer for the **4-digit code** shown in their app. Laundry pickups don't need a code.
- `offerExpiresAt` → show a countdown; after it the offer lapses and the store reassigns.

### Calls

| Call | Body | Effect |
|---|---|---|
| `GET /rider/tasks?status=active` | — | Offered + in-progress tasks, oldest first |
| `GET /rider/tasks?status=done&from=YYYY-MM-DD&to=YYYY-MM-DD&page=1` | — | Finished ones (completed / failed / rejected / expired / cancelled), newest first |
| `GET /rider/tasks/:id` | — | One task |
| `POST /rider/tasks/:id/accept` | — | `offered → accepted` (customer is notified with your name). `409` if expired/withdrawn |
| `POST /rider/tasks/:id/reject` | `{ "reason": "Too far" }` | Store is alerted to reassign |
| `POST /rider/tasks/:id/arrived` | `{ "lat", "lng" }` | `accepted → at_pickup` or `picked_up → at_drop`. If both positions are known and you're > 1 km away → `400 "You're about 3.2 km away…"` |
| `POST /rider/tasks/:id/picked-up` | `{ "lat"?, "lng"?, "photo"? }` | → `picked_up`; order becomes **dispatched** / booking **picked_up** or **out_for_return**. `409 "The store hasn't packed this order yet"` if not ready |
| `POST /rider/tasks/:id/complete` | `{ "otp": "4821", "collectedPaise": 32500, "collectionMode": "cash" \| "upi", "lat"?, "lng"?, "photo"? }` | → `completed`; order **delivered** (COD marked paid) / booking **completed**. Wrong code → `400 "That code doesn't match…"`; wrong amount → `400 "Collect ₹325 before completing"` |
| `POST /rider/tasks/:id/fail` | `{ "reason": "customer_unreachable" \| "wrong_address" \| "refused" \| "other", "note": "…" }` | → `failed`; store is alerted to reschedule |
| `POST /uploads/image?folder=deliveries` | multipart field `file` | Proof photo → `{ "url" }`; pass it as `photo` |

`photo` must be a full URL. Cash collected (`collectionMode: "cash"`) adds to your cash in hand; UPI doesn't.

---

## 5. Pushes and inbox

Register FCM: in `verify-otp` (`device`) or later with `POST /notifications/devices { "token", "platform" }`;
remove on sign-out with `DELETE /notifications/devices { "token" }`.

| `type` (in push `data`) | `data` | What to do |
|---|---|---|
| `rider.task.offer` | `taskId`, `expiresAt` | Loud sound, full-screen offer card with countdown → accept / reject |
| `rider.task.cancelled` | `taskId` | The store took it back or the order was cancelled — drop it from the screen |
| `rider.deposit` | `depositId` | Cash deposit confirmed / rejected |

Every push also lands in the inbox: `GET /notifications` → `{ items, page, limit, total, unread }`,
`POST /notifications/:id/read`, `POST /notifications/read-all`.
While online, also poll `GET /rider/tasks?status=active` every **20 s** in case a push is missed.

---

## 6. Earnings and cash

| Call | Body | Returns |
|---|---|---|
| `GET /rider/earnings?from=YYYY-MM-DD&to=YYYY-MM-DD` | — | `{ totalPaise, deliveries, perDay: [ { date, deliveries, earningsPaise } ] }` (completed tasks × payout) |
| `GET /rider/cash` | — | `{ inHandPaise, pendingDeposits: [ { _id, amountPaise, mode, reference, status, createdAt } ] }` |
| `POST /rider/cash/deposit` | `{ "amountPaise": 120000, "mode": "upi" \| "store", "reference": "UPI ref" }` | Creates a pending deposit (min ₹1). Can't exceed cash in hand minus pending deposits. The store confirms it in the admin; then cash in hand goes down |

---

## 7. Suggested screens

1. **Login** — phone → OTP (auto-read SMS), send FCM token with verify.
2. **Home** — Online/Offline switch, today's deliveries · earnings · cash in hand, active task cards.
3. **Offer** — full screen with sound and countdown: kind, ref number, drop address & distance, items count, collect amount, payout; Accept / Reject (reason).
4. **Active task** — stepper *Go to pickup → Picked up → Go to customer → Deliver*; navigation (`google.navigation:q=lat,lng` or address), call store / customer (`tel:`), items, notes.
5. **Deliver** — 4 OTP boxes (if `requiresOtp`), "Collect ₹325" with Cash / UPI, optional photo, swipe to complete.
6. **Can't deliver** — reason picker + note.
7. **History / Earnings / Cash** (date range; deposit form).
8. **Notifications**, **Profile** (sign out).

Android permissions: location (foreground service while online), notifications, camera.

---

## 8. What the customer sees

Once a partner **accepts**, the customer's order page (`GET /orders/:id` and
`GET /laundry/bookings/:id`) includes:
```json
"delivery": { "kind": "order_delivery", "status": "picked_up", "otp": "4821",
              "rider": { "name": "Suresh", "phone": "98…", "vehicle": "bike" },
              "location": { "lat": 22.72, "lng": 75.88, "at": "…" } }
```
They also get a push: "Suresh will deliver order #… Share code 4821 at the door."
(`location` is present only after pickup.)

---

## 9. Store side (admin panel / API), for reference

| Call | Purpose |
|---|---|
| `GET/POST /admin/riders`, `GET/PATCH /admin/riders/:id` | Partners (needs `riders` permission) |
| `POST /admin/riders/tasks` `{ kind, refId, riderId, payoutPaise? }` | Assign (needs `orders.update` / `bookings.update`) |
| `GET /admin/riders/tasks?status=active\|done\|all&riderId&refId` | Live and past tasks |
| `POST /admin/riders/tasks/:id/cancel` `{ reason }` | Take a task back |
| `GET /admin/riders/deposits`, `POST …/:id/confirm` · `…/reject` | Cash deposits |

## 10. Testing

Ask the admin to add you as a partner (Admin → Delivery partners) with your phone, then
assign yourself a test order that's **Ready** (or Accepted/Packing — pickup waits for Ready).
