# Deploying Nearmart

This is a single-server setup: Ubuntu VPS, Node 20, PM2, nginx and Let's Encrypt, with MongoDB on
Atlas or on the same box. It suits launch traffic; the scaling notes at the end say what to change
when it outgrows one machine.

## 0. What you need from the client first

| Item | Used for | Where it goes |
|---|---|---|
| Domain + DNS access | `admin.example.com` (panel + API) | nginx `server_name`, `CORS_ORIGINS` |
| SMS India Hub account with an approved **DLT template** | OTP SMS | `SMS_*` env; `SMS_OTP_TEMPLATE` must match the template exactly |
| Razorpay account (KYC done), live key id + secret | online payments | `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET` |
| Razorpay webhook secret | payment/refund confirmation | `RAZORPAY_WEBHOOK_SECRET` |
| Firebase project service-account JSON | push notifications | `FIREBASE_SERVICE_ACCOUNT_PATH` |
| Decisions in SOW §11 | vendor model, laundry price difference, veg pricing | already assumed in code; see README |

## 1. Server

```bash
# Ubuntu 22.04/24.04, as a sudo user
sudo apt update && sudo apt install -y nginx git
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - && sudo apt install -y nodejs
sudo npm i -g pm2
sudo mkdir -p /var/www/nearmart/{uploads,admin} && sudo chown -R $USER /var/www/nearmart
```

**MongoDB.** Atlas (M10 or larger, region `ap-south-1` Mumbai) is the simplest choice: backups and
monitoring are included. Allow-list only the server's IP. Self-hosting is also fine: MongoDB 7, bound
to `127.0.0.1`, with auth enabled. The app does not need a replica set.

## 2. Code and configuration

```bash
cd /var/www/nearmart
git clone <repo-url> app && cd app
cd backend && npm ci --omit=dev && cd ..
cd admin && npm ci && npm run build && cp -r dist/* /var/www/nearmart/admin/ && cd ..
cp backend/.env.example backend/.env && chmod 600 backend/.env
```

Production values in `backend/.env` (the server refuses to start if any are inconsistent):

```ini
NODE_ENV=production
PORT=5000
HOST=127.0.0.1
TRUST_PROXY=true
CORS_ORIGINS=https://admin.example.com
MONGO_URI=mongodb+srv://…
JWT_ACCESS_SECRET=<48+ random bytes, hex>     # node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
JWT_REFRESH_SECRET=<different 48+ random bytes>
COOKIE_SAMESITE=strict
COOKIE_SECURE=true
USE_DEFAULT_OTP=false
SMS_PROVIDER=smsindiahub
SMS_INDIA_HUB_API_KEY=…
SMS_INDIA_HUB_SENDER_ID=…
SMS_INDIA_HUB_DLT_TEMPLATE_ID=…
SMS_OTP_TEMPLATE=<exact DLT text with {otp}>
UPLOAD_STORAGE_ROOT=/var/www/nearmart/uploads
UPLOAD_BASE_URL=https://admin.example.com/uploads
FIREBASE_SERVICE_ACCOUNT_PATH=/var/www/nearmart/secrets/firebase.json   # chmod 600
RAZORPAY_KEY_ID=rzp_live_…
RAZORPAY_KEY_SECRET=…
RAZORPAY_WEBHOOK_SECRET=…
```

`UPLOAD_BASE_URL` is absolute so the mobile app gets full image URLs.

## 3. Database setup (first deploy, and after model changes)

```bash
cd /var/www/nearmart/app/backend
npm run db:indexes                      # builds indexes; production does not auto-build them
SEED_ADMIN_EMAIL=owner@client.com SEED_ADMIN_PASSWORD='<long password>' npm run seed:admin
```

The super admin then creates the other staff in the panel (Staff & roles). Never reuse the seed password.

## 4. Run

```bash
cd /var/www/nearmart/app
pm2 start deploy/ecosystem.config.cjs --env production
pm2 install pm2-logrotate && pm2 save && pm2 startup     # restart on reboot, rotate logs
```

Keep **one** API instance. Rate limits are kept in memory, and the job that expires unpaid
orders and bookings runs inside the API process.

## 5. nginx and TLS

```bash
sudo cp deploy/nginx.example.conf /etc/nginx/sites-available/nearmart   # edit server_name
sudo ln -s /etc/nginx/sites-available/nearmart /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo apt install -y certbot python3-certbot-nginx && sudo certbot --nginx -d admin.example.com
```

## 6. Third-party wiring

- **Razorpay → Settings → Webhooks:** URL `https://admin.example.com/api/v1/payments/webhook/razorpay`,
  secret = `RAZORPAY_WEBHOOK_SECRET`, events `payment.captured`, `payment.failed`, `order.paid`,
  `refund.processed`. Use the "test webhook" button and check `pm2 logs`.
- **Firebase:** the customer app's Android channel id must be `high_importance_channel`
  (see `notifications/push.service.js`).
- **App team:** the API contract is at `https://admin.example.com/api/v1/openapi.yaml`.

## 7. Go-live checklist

- [ ] `curl https://admin.example.com/api/v1/health` → `{"status":"up"}`
- [ ] OTP arrives on a real phone (DLT template accepted)
- [ ] Panel: create service area, slots, categories, products, laundry services, settings (contact, policies)
- [ ] Place a ₹1 online test order with live keys, check it becomes **New**, cancel it, and confirm the refund arrives
- [ ] Place a cash order, then advance it through to Delivered
- [ ] Laundry: book, weigh, return, complete
- [ ] Push notification received on the device
- [ ] Reports download as CSV and Excel
- [ ] Backups confirmed (Atlas snapshot schedule, or the cron below)
- [ ] Uptime monitor on `/api/v1/health` (UptimeRobot, Better Stack, or similar)

## 8. Operations

**Deploy an update**

```bash
cd /var/www/nearmart/app && git pull
cd backend && npm ci --omit=dev && npm run db:indexes && cd ..
cd admin && npm ci && npm run build && rsync -a --delete dist/ /var/www/nearmart/admin/ && cd ..
pm2 reload nearmart-api
```

**Backups (self-hosted MongoDB).** Back up the database and the uploads folder nightly, and copy them off the server:

```cron
30 2 * * * mongodump --uri="$MONGO_URI" --archive=/var/backups/nearmart-$(date +\%F).gz --gzip && find /var/backups -name 'nearmart-*.gz' -mtime +14 -delete
45 2 * * * tar czf /var/backups/uploads-$(date +\%F).tgz -C /var/www/nearmart uploads && find /var/backups -name 'uploads-*.tgz' -mtime +14 -delete
```

**Logs:** `pm2 logs nearmart-api` (JSON lines; each request has an id, also returned as
`x-request-id` and in error bodies as `requestId`, so a customer's screenshot can be traced).

## Scaling beyond one server

1. Move rate limiting to Redis (`rate-limit-redis`) and run the expiry job (`expireUnpaidOrders`,
   `expireUnpaidBookings`) in one dedicated process. Then `instances: 'max'` is safe.
2. Move uploads to object storage (S3, Cloudflare R2 or DigitalOcean Spaces) behind a CDN, by
   replacing `uploads/storage.service.js` `saveImage`.
3. Use MongoDB Atlas with a replica set, and Atlas Search if product search needs typo tolerance.
