/**
 * Test logins for every business module, for demos and app-store review:
 *
 *   per module   an ops user for the panel (email + password), a seller approved
 *                for that shop (laundry has none: it sells services, not products),
 *                a delivery partner and a customer (phone + OTP)
 *
 *   npm run seed:accounts           create the missing ones, print every login
 *   npm run seed:accounts -- --reset  also give existing ones a new password
 *
 * Passwords are generated and printed once; they're never stored in plain
 * text, so keep the output. Riders and customers sign in with an OTP, which is
 * DEFAULT_OTP_CODE while USE_DEFAULT_OTP=true.
 */
import crypto from 'node:crypto';
import { connectDB, disconnectDB } from '../src/config/db.js';
import { env } from '../src/config/env.js';
import { PRODUCT_MODULES } from '../src/modules/catalog/module.model.js';
import { Rider } from '../src/modules/riders/rider.model.js';
import { Seller } from '../src/modules/sellers/seller.model.js';
import { BUSINESS_MODULES, STAFF_ROLES } from '../src/modules/staff/permissions.js';
import { Staff } from '../src/modules/staff/staff.model.js';
import { User } from '../src/modules/users/user.model.js';

const reset = process.argv.includes('--reset');
const DOMAIN = 'nearmart.test';
const TITLE = { grocery: 'Grocery', produce: 'Produce', laundry: 'Laundry', electronics: 'Electronics' };

const newPassword = () => `Nm-${crypto.randomBytes(9).toString('base64url')}`;
/** 90000001 + module number + role digit: 9000000111 is the grocery seller. */
const phoneFor = (moduleIndex, role) => `90000001${moduleIndex + 1}${{ seller: 1, rider: 2, customer: 3 }[role]}`;

const OPS_PERMISSIONS = {
    dashboard: ['view'],
    catalog: ['view', 'create', 'update'],
    inventory: ['view', 'create', 'update'],
    orders: ['view', 'update'],
    bookings: ['view', 'update'],
    riders: ['view'],
    sellers: ['view'],
    customers: ['view'],
    coupons: ['view'],
    banners: ['view'],
    reports: ['view']
};

/** Creates the account, or (with --reset) gives an existing one a new password. Returns the password, or null if unchanged. */
const ensureWithPassword = async (Model, filter, fields) => {
    const existing = await Model.findOne(filter).select('+password');
    const password = newPassword();
    if (!existing) {
        await Model.create({ ...filter, ...fields, password });
        return password;
    }
    if (!reset) return null;
    existing.password = password;
    existing.tokenVersion += 1;
    existing.failedLogins = 0;
    existing.lockedUntil = null;
    await existing.save();
    return password;
};

const rows = [];
await connectDB();
try {
    for (const [i, module] of BUSINESS_MODULES.entries()) {
        const name = TITLE[module];

        const opsEmail = `${module}.admin@${DOMAIN}`;
        const opsPassword = await ensureWithPassword(Staff, { email: opsEmail }, {
            name: `${name} Manager (test)`,
            role: STAFF_ROLES.OPS,
            modules: [module],
            permissions: OPS_PERMISSIONS
        });
        rows.push([name, 'Admin panel (ops)', opsEmail, opsPassword ?? '(unchanged; --reset for a new one)']);

        if (PRODUCT_MODULES.includes(module)) {
            const sellerEmail = `${module}.seller@${DOMAIN}`;
            const sellerPhone = phoneFor(i, 'seller');
            const sellerPassword = await ensureWithPassword(Seller, { email: sellerEmail }, {
                phone: sellerPhone,
                businessName: `Nearmart Test ${name} Store`,
                ownerName: `${name} Seller (test)`,
                status: 'approved',
                submittedAt: new Date(),
                reviewedAt: new Date(),
                statusHistory: [{ status: 'approved', note: 'Test account', by: { kind: 'system', id: null } }],
                modules: [{ key: module, status: 'approved', decidedAt: new Date(), note: 'Test account' }],
                store: { timings: 'Open all day (test store)', supportPhone: sellerPhone },
                address: { line1: 'Test address', city: 'Indore', state: 'Madhya Pradesh', pincode: '452001', lat: 22.7196, lng: 75.8577 }
            });
            rows.push([name, 'Seller', `${sellerEmail} or ${sellerPhone}`, sellerPassword ?? '(unchanged; --reset for a new one)']);
        }

        const riderPhone = phoneFor(i, 'rider');
        await Rider.updateOne(
            { phone: riderPhone },
            { $setOnInsert: { name: `${name} Rider (test)`, vehicle: 'bike', modules: [module], isActive: true } },
            { upsert: true }
        );
        rows.push([name, 'Rider app', riderPhone, 'OTP']);

        const customerPhone = phoneFor(i, 'customer');
        await User.updateOne({ phone: customerPhone }, { $setOnInsert: { name: `${name} Customer (test)`, isActive: true } }, { upsert: true });
        rows.push([name, 'Customer app', customerPhone, 'OTP']);
    }

    const otp = env.USE_DEFAULT_OTP ? env.DEFAULT_OTP_CODE : 'sent by SMS';
    console.log(`\nTest logins (OTP: ${otp})\n`);
    console.log(['Module', 'Role', 'Login', 'Password'].join(' | '));
    for (const r of rows) console.log(r.join(' | '));
} finally {
    await disconnectDB();
}
