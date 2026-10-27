import fs from 'node:fs/promises';
import path from 'node:path';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { api, createStaff, loginCustomer, loginStaff } from './helpers.js';
import { Order } from '../src/modules/orders/order.model.js';
import { Product } from '../src/modules/catalog/product.model.js';
import { Seller } from '../src/modules/sellers/seller.model.js';
import { Zone } from '../src/modules/zones/zone.model.js';

afterAll(() => fs.rm(path.resolve(process.env.UPLOAD_STORAGE_ROOT, '..', 'private-uploads'), { recursive: true, force: true }));

const A = '/api/v1/admin';
const S = '/api/v1/seller';
const as = (token) => ({ Authorization: `Bearer ${token}` });
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF');

let admin;
let flours;
let tvs;

const signUp = async (phone = '9811122233', extra = {}) => {
    const otpRes = await api().post('/api/v1/auth/seller/signup/request-otp').send({ phone }).expect(200);
    const res = await api()
        .post('/api/v1/auth/seller/signup')
        .send({ phone, otp: otpRes.body.data.devOtp, businessName: 'Sharma Kirana', ownerName: 'Ravi Sharma', email: `${phone}@shop.test`, password: 'kirana-pass-123', ...extra });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return res.body.data;
};

/** Fills in the application, uploads a document and submits it. */
const apply = async (token, modules = [{ key: 'grocery' }]) => {
    await api()
        .patch(`${S}/application`)
        .set(as(token))
        .send({
            legal: { pan: 'ABCDE1234F' },
            address: { line1: '5 MG Road', city: 'Pune', pincode: '411038', lat: 18.5, lng: 73.8 },
            bank: { accountName: 'Sharma Kirana', accountNumber: '1234567890', ifsc: 'HDFC0001234' },
            modules
        })
        .expect(200);
    await api().post(`${S}/documents`).set(as(token)).field('type', 'pan').attach('file', PDF, { filename: 'pan.pdf', contentType: 'application/pdf' }).expect(201);
    const res = await api().post(`${S}/application/submit`).set(as(token));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return res.body.data;
};

const approvedSeller = async (phone, opts = {}) => {
    const session = await signUp(phone, { email: `${phone}@shop.test`, businessName: opts.name ?? `Shop ${phone}` });
    const seller = await apply(session.accessToken, opts.modules);
    await api().post(`${A}/sellers/${seller.id}/approve`).set(as(admin)).send({ commissionPercent: opts.percent ?? 10, fixedFeePaise: opts.fee ?? 0 }).expect(200);
    return { token: session.accessToken, id: seller.id };
};

beforeEach(async () => {
    admin = (await loginStaff(await createStaff())).token;
    await Zone.create({ name: 'Kothrud', modules: ['grocery', 'electronics'], pincodes: ['411038'], deliveryFeePaise: 3000, freeDeliveryAbovePaise: 50000 });
    const post = async (p, body) => (await api().post(`${A}${p}`).set(as(admin)).send(body).expect(201)).body.data;
    flours = await post('/catalog/categories', { module: 'grocery', name: 'Flours' });
    tvs = await post('/catalog/categories', { module: 'electronics', name: 'TVs' });
    await api().put(`${A}/sellers/config`).set(as(admin)).send({ payoutHoldDays: 0 }).expect(200);
});

describe('seller onboarding', () => {
    it('signs up, applies, gets rejected with a reason, resubmits and is approved', async () => {
        const session = await signUp();
        expect(session.seller.status).toBe('draft');

        // Incomplete applications can't be submitted.
        const early = await api().post(`${S}/application/submit`).set(as(session.accessToken));
        expect(early.status).toBe(400);
        expect(early.body.message).toMatch(/shop address/);

        // Selling needs approval.
        expect((await api().get(`${S}/products`).set(as(session.accessToken))).status).toBe(403);

        const submitted = await apply(session.accessToken);
        expect(submitted.status).toBe('submitted');

        const list = await api().get(`${A}/sellers?status=submitted`).set(as(admin)).expect(200);
        expect(list.body.data.items).toHaveLength(1);
        const id = list.body.data.items[0]._id;

        // The admin can open the private document; it isn't under the public uploads.
        const detail = await api().get(`${A}/sellers/${id}`).set(as(admin)).expect(200);
        const doc = await api().get(`${A}/sellers/${id}/documents/${detail.body.data.documents[0]._id}`).set(as(admin)).expect(200);
        expect(doc.headers['content-type']).toMatch(/pdf/);

        await api().post(`${A}/sellers/${id}/reject`).set(as(admin)).send({ reason: 'PAN copy is unreadable' }).expect(200);
        const me = await api().get(`${S}/me`).set(as(session.accessToken)).expect(200);
        expect(me.body.data).toMatchObject({ status: 'rejected', rejectionReason: 'PAN copy is unreadable' });

        await api().post(`${S}/application/submit`).set(as(session.accessToken)).expect(200);
        const approved = await api().post(`${A}/sellers/${id}/approve`).set(as(admin)).send({ commissionPercent: 12 }).expect(200);
        expect(approved.body.data.status).toBe('approved');
        expect(approved.body.data.modules[0].status).toBe('approved');
        expect((await api().get(`${S}/products`).set(as(session.accessToken))).status).toBe(200);
    });

    it('signs in with email or phone and password, and refreshes from its own cookie', async () => {
        await signUp('9822233344');
        const byEmail = await api().post('/api/v1/auth/seller/login').send({ login: '9822233344@shop.test', password: 'kirana-pass-123' }).expect(200);
        const cookie = byEmail.headers['set-cookie'].find((c) => c.startsWith('nm_srt=')).split(';')[0];
        expect(byEmail.body.data.refreshToken).toBeUndefined();
        await api().post('/api/v1/auth/seller/login').send({ login: '9822233344', password: 'kirana-pass-123' }).expect(200);
        expect((await api().post('/api/v1/auth/seller/login').send({ login: '9822233344', password: 'wrong-password' })).status).toBe(401);
        const refreshed = await api().post('/api/v1/auth/seller/refresh').set('Cookie', cookie).expect(200);
        expect(refreshed.body.data.accessToken).toBeTruthy();
        expect(refreshed.body.data.seller).toMatchObject({ phone: '9822233344', status: 'draft' });
        // A seller token can't reach the admin API, and a phone can't sign up twice.
        expect((await api().get(`${A}/sellers`).set(as(refreshed.body.data.accessToken))).status).toBe(403);
        expect((await api().post('/api/v1/auth/seller/signup/request-otp').send({ phone: '9822233344' })).status).toBe(409);
    });
});

describe('selling', () => {
    const product = (token, body) => api().post(`${S}/products`).set(as(token)).send({ module: 'grocery', category: flours._id, name: 'Chakki Atta', variants: [{ label: '5 kg', pricePaise: 30000, stockQty: 10 }], ...body });

    it('lists products only in approved shops, shows them to customers, and hides them when the store closes', async () => {
        const seller = await approvedSeller('9833344455');
        expect((await product(seller.token, { module: 'electronics', category: tvs._id })).status).toBe(403);
        const res = await product(seller.token, { isFeatured: true });
        expect(res.status, JSON.stringify(res.body)).toBe(201);
        expect(res.body.data.isFeatured).toBe(false);

        const listed = await api().get('/api/v1/catalog/products?module=grocery').expect(200);
        const row = listed.body.data.items.find((p) => p.name === 'Chakki Atta');
        expect(row.soldBy).toMatchObject({ id: seller.id });

        await api().post(`${S}/store/open`).set(as(seller.token)).send({ isOpen: false }).expect(200);
        const hidden = await api().get('/api/v1/catalog/products?module=grocery').expect(200);
        expect(hidden.body.data.items.find((p) => p.name === 'Chakki Atta')).toBeUndefined();

        // Sellers see only their own products.
        const other = await approvedSeller('9844455566');
        expect((await api().get(`${S}/products/${res.body.data._id}`).set(as(other.token))).status).toBe(404);
    });

    it('splits checkout by seller, lets the seller pack the order, and pays them net of commission', async () => {
        const seller = await approvedSeller('9855566677', { percent: 10, fee: 500 });
        const created = await product(seller.token, {});
        const sellerProduct = created.body.data;
        const own = (await api().post(`${A}/catalog/products`).set(as(admin)).send({ module: 'grocery', category: flours._id, name: 'House Rice', variants: [{ label: '1 kg', pricePaise: 10000, stockQty: 5 }] }).expect(201)).body.data;

        const customer = (await loginCustomer()).accessToken;
        const address = await api().post('/api/v1/me/addresses').set(as(customer)).send({ line1: '12 Paud Road', city: 'Pune', state: 'Maharashtra', pincode: '411038', name: 'Asha' });
        const addressId = address.body.data._id;
        for (const [p, qty] of [[sellerProduct, 2], [own, 1]]) {
            await api().put('/api/v1/cart/items').set(as(customer)).send({ productId: p._id, variantId: p.variants[0]._id, qty }).expect(200);
        }
        const cart = await api().get('/api/v1/cart').set(as(customer)).expect(200);
        expect(cart.body.data.groups[0].sellers).toHaveLength(2);

        // Two stores in one cart: the customer must pick one per checkout.
        const mixed = await api().post('/api/v1/checkout').set(as(customer)).send({ module: 'grocery', addressId, paymentMethod: 'cod' });
        expect(mixed.status).toBe(409);
        expect(mixed.body.details.map((d) => d.sellerId)).toEqual(expect.arrayContaining([seller.id, null]));

        const placed = await api().post('/api/v1/checkout').set(as(customer)).send({ module: 'grocery', addressId, paymentMethod: 'cod', sellerId: seller.id });
        expect(placed.status, JSON.stringify(placed.body)).toBe(201);
        const order = placed.body.data.order;
        expect(order.seller).toMatchObject({ name: 'Shop 9855566677', commissionPercent: 10, fixedFeePaise: 500 });
        expect(order.items).toHaveLength(1);
        // Nearmart's own item stays in the cart for its own checkout.
        await api().post('/api/v1/checkout').set(as(customer)).send({ module: 'grocery', addressId, paymentMethod: 'cod' }).expect(201);

        const inbox = await api().get(`${S}/orders?status=open`).set(as(seller.token)).expect(200);
        expect(inbox.body.data.items.map((o) => o._id)).toEqual([order._id]);
        const view = await api().get(`${S}/orders/${order._id}`).set(as(seller.token)).expect(200);
        expect(view.body.data.customerPhone).toBeUndefined();

        for (const status of ['accepted', 'packing', 'ready']) {
            await api().post(`${S}/orders/${order._id}/status`).set(as(seller.token)).send({ status }).expect(200);
        }
        expect((await api().post(`${S}/orders/${order._id}/status`).set(as(seller.token)).send({ status: 'dispatched' })).status).toBe(400);
        for (const status of ['dispatched', 'delivered']) {
            await api().post(`${A}/orders/${order._id}/status`).set(as(admin)).send({ status }).expect(200);
        }

        // 2 × ₹300 = ₹600 gross; 10% = ₹60 commission; ₹5 fee → ₹535 to the seller.
        const earnings = await api().get(`${S}/earnings`).set(as(seller.token)).expect(200);
        expect(earnings.body.data.totals).toMatchObject({ orders: 1, grossPaise: 60000, commissionPaise: 6000, feePaise: 500, netPaise: 53500 });
        expect(earnings.body.data.balance.payablePaise).toBe(53500);

        const payout = await api().post(`${A}/payouts`).set(as(admin)).send({ sellerId: seller.id }).expect(201);
        expect(payout.body.data).toMatchObject({ netPaise: 53500, orderCount: 1, status: 'pending' });
        expect((await api().post(`${A}/payouts`).set(as(admin)).send({ sellerId: seller.id })).status).toBe(400);
        await api().post(`${A}/payouts/${payout.body.data._id}/paid`).set(as(admin)).send({ mode: 'upi', reference: 'UTR123' }).expect(200);

        const after = await api().get(`${S}/earnings`).set(as(seller.token)).expect(200);
        expect(after.body.data.balance).toMatchObject({ payablePaise: 0, paidPaise: 53500 });
        const statement = await api().get(`${S}/payouts/${payout.body.data._id}`).set(as(seller.token)).expect(200);
        expect(statement.body.data.orders[0]).toMatchObject({ orderNumber: order.orderNumber, netPaise: 53500 });
        expect(statement.body.data.seller.bank).toBeUndefined();
    });

    it('hides a suspended seller\'s products and blocks their checkout', async () => {
        const seller = await approvedSeller('9866677788');
        const p = (await product(seller.token, {})).body.data;
        await api().post(`${A}/sellers/${seller.id}/suspend`).set(as(admin)).send({ reason: 'Quality complaints' }).expect(200);
        expect((await Product.findById(p._id).lean()).sellerHidden).toBe(true);
        expect((await api().get(`${S}/products`).set(as(seller.token))).status).toBe(403);
        expect(await Seller.countDocuments({ status: 'suspended' })).toBe(1);
        expect(await Order.countDocuments()).toBe(0);
    });
});
