import fs from 'node:fs/promises';
import path from 'node:path';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { api, createStaff, loginCustomer, loginStaff } from './helpers.js';
import { Notification } from '../src/modules/notifications/notification.model.js';
import { Order } from '../src/modules/orders/order.model.js';
import { alertLateSellerOrders } from '../src/modules/orders/order.service.js';
import { Product } from '../src/modules/catalog/product.model.js';
import { Seller } from '../src/modules/sellers/seller.model.js';
import { refreshSchedules } from '../src/modules/sellers/seller.service.js';
import { Zone } from '../src/modules/zones/zone.model.js';

afterAll(() => fs.rm(path.resolve(process.env.UPLOAD_STORAGE_ROOT, '..', 'private-uploads'), { recursive: true, force: true }));

const A = '/api/v1/admin';
const S = '/api/v1/seller';
const as = (token) => ({ Authorization: `Bearer ${token}` });
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF');

let admin;
let flours;
let zone;
let n = 0;

const approvedSeller = async (opts = {}) => {
    n += 1;
    const phone = `98${String(Date.now()).slice(-6)}${String(n).padStart(2, '0')}`;
    const otpRes = await api().post('/api/v1/auth/seller/signup/request-otp').send({ phone }).expect(200);
    const verified = await api().post('/api/v1/auth/seller/signup/verify-otp').send({ phone, otp: otpRes.body.data.devOtp }).expect(200);
    const session = (
        await api()
            .post('/api/v1/auth/seller/signup')
            .send({ signupToken: verified.body.data.signupToken, businessName: opts.name ?? `Shop ${n}`, ownerName: 'Owner', email: `${phone}@shop.test`, password: 'shop-pass-12345' })
            .expect(200)
    ).body.data;
    const token = session.accessToken;
    await api()
        .patch(`${S}/application`)
        .set(as(token))
        .send({
            legal: { pan: 'ABCDE1234F' },
            address: { line1: '5 MG Road', city: 'Pune', pincode: '411038' },
            bank: { accountName: 'Shop', accountNumber: '1234567890', ifsc: 'HDFC0001234' },
            modules: [{ key: 'grocery' }]
        })
        .expect(200);
    await api().post(`${S}/documents`).set(as(token)).field('type', 'pan').attach('file', PDF, { filename: 'pan.pdf', contentType: 'application/pdf' }).expect(201);
    await api().post(`${S}/application/submit`).set(as(token)).expect(200);
    const id = session.seller.id;
    await api().post(`${A}/sellers/${id}/approve`).set(as(admin)).send({ commissionPercent: opts.percent ?? 10, fixedFeePaise: 0 }).expect(200);
    return { token, id };
};

const addProduct = async (seller, body = {}) =>
    (await api().post(`${S}/products`).set(as(seller.token)).send({ module: 'grocery', category: flours._id, name: `Atta ${n}`, variants: [{ label: '5 kg', pricePaise: 30000, stockQty: 20 }], ...body }).expect(201)).body.data;

const customerWithAddress = async (phone = '9876500001') => {
    const token = (await loginCustomer(phone)).accessToken;
    const address = await api().post('/api/v1/me/addresses').set(as(token)).send({ line1: '12 Paud Road', city: 'Pune', state: 'Maharashtra', pincode: '411038', name: 'Asha' });
    return { token, addressId: address.body.data._id };
};

const buy = async (customer, product, sellerId, qty = 1, extra = {}) => {
    await api().put('/api/v1/cart/items').set(as(customer.token)).send({ productId: product._id, variantId: product.variants[0]._id, qty }).expect(200);
    return api().post('/api/v1/checkout').set(as(customer.token)).send({ module: 'grocery', addressId: customer.addressId, paymentMethod: 'cod', sellerId: sellerId ?? '', ...extra });
};

/** Places an order and returns it, failing with the API message if it was refused. */
const placed = async (...args) => {
    const res = await buy(...args);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return res.body.data.order;
};

const deliver = async (orderId) => {
    for (const status of ['accepted', 'packing', 'ready', 'dispatched', 'delivered']) {
        await api().post(`${A}/orders/${orderId}/status`).set(as(admin)).send({ status }).expect(200);
    }
};

beforeEach(async () => {
    admin = (await loginStaff(await createStaff())).token;
    zone = await Zone.create({ name: 'Kothrud', modules: ['grocery'], pincodes: ['411038'], deliveryFeePaise: 3000, freeDeliveryAbovePaise: 100000, minOrderPaise: 20000 });
    flours = (await api().post(`${A}/catalog/categories`).set(as(admin)).send({ module: 'grocery', name: 'Flours' }).expect(201)).body.data;
    await api().put(`${A}/sellers/config`).set(as(admin)).send({ payoutHoldDays: 0 }).expect(200);
});

describe('orders and suspension', () => {
    it('lets a suspended seller finish orders it already has, but not sell', async () => {
        const seller = await approvedSeller();
        const product = await addProduct(seller);
        const customer = await customerWithAddress();
        const order = await placed(customer, product, seller.id);

        await api().post(`${A}/sellers/${seller.id}/suspend`).set(as(admin)).send({ reason: 'Late deliveries' }).expect(200);
        await api().post(`${S}/orders/${order._id}/status`).set(as(seller.token)).send({ status: 'accepted' }).expect(200);
        await api().get(`${S}/earnings`).set(as(seller.token)).expect(200);
        expect((await api().get(`${S}/products`).set(as(seller.token))).status).toBe(403);
    });

    it('alerts staff once when a seller sits on an order', async () => {
        const seller = await approvedSeller();
        const product = await addProduct(seller);
        const order = await placed(await customerWithAddress(), product, seller.id);

        expect(await alertLateSellerOrders(new Date())).toBe(0); // too early
        const later = new Date(Date.now() + 11 * 60_000);
        expect(await alertLateSellerOrders(later)).toBe(1);
        expect(await alertLateSellerOrders(later)).toBe(0); // only once
        expect(await Notification.countDocuments({ type: 'staff.order.seller_late' })).toBeGreaterThan(0);
        expect(await Notification.countDocuments({ ownerKind: 'seller', type: 'seller.order.reminder' })).toBe(1);
        expect((await Order.findById(order._id).lean()).status).toBe('placed'); // nothing cancelled
    });
});

describe('checkout across stores', () => {
    it('charges delivery once per trip and waives the minimum for the second store', async () => {
        const seller = await approvedSeller();
        // ₹100: below the ₹200 minimum, so it only goes through as part of the same trip.
        const theirs = await addProduct(seller, { variants: [{ label: '500 g', pricePaise: 10000, stockQty: 9 }] });
        const own = (await api().post(`${A}/catalog/products`).set(as(admin)).send({ module: 'grocery', category: flours._id, name: 'House Rice', variants: [{ label: '1 kg', pricePaise: 25000, stockQty: 9 }] }).expect(201)).body.data;
        const customer = await customerWithAddress();

        const first = await placed(customer, own, null);
        expect(first.pricing.deliveryFeePaise).toBe(3000);
        const second = await buy(customer, theirs, seller.id, 1);
        expect(second.status, JSON.stringify(second.body)).toBe(201);
        expect(second.body.data.order.pricing.deliveryFeePaise).toBe(0);
    });

    it('hides a store outside the customer’s zone and refuses closed stores', async () => {
        const seller = await approvedSeller();
        const product = await addProduct(seller);
        const elsewhere = await Zone.create({ name: 'Baner', modules: ['grocery'], pincodes: ['411045'] });
        await api().patch(`${A}/sellers/${seller.id}`).set(as(admin)).send({ zones: [String(elsewhere._id)] }).expect(200);

        const here = await api().get(`/api/v1/catalog/products?module=grocery&zone=${zone._id}`).expect(200);
        expect(here.body.data.items.find((p) => p.id === product._id)).toBeUndefined();
        const there = await api().get(`/api/v1/catalog/products?module=grocery&zone=${elsewhere._id}`).expect(200);
        expect(there.body.data.items.find((p) => p.id === product._id)).toBeTruthy();

        // The address tells the app which zone to ask for.
        const customer = await customerWithAddress('9876500002');
        const addresses = await api().get('/api/v1/me/addresses').set(as(customer.token)).expect(200);
        expect(addresses.body.data[0].zones.grocery).toBe(String(zone._id));

        // Closed all day today: hidden and can't be checked out.
        await api().patch(`${A}/sellers/${seller.id}`).set(as(admin)).send({ zones: [] }).expect(200);
        const today = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
        await api().put(`${S}/store/hours`).set(as(seller.token)).send({ holidays: [today] }).expect(200);
        expect((await Product.findById(product._id).lean()).sellerHidden).toBe(true);
        await Seller.updateOne({ _id: seller.id }, { $set: { holidays: [] } });
        expect(await refreshSchedules()).toBe(1);
        expect((await Product.findById(product._id).lean()).sellerHidden).toBe(false);
    });
});

describe('money', () => {
    it('uses per-shop commission, takes seller-funded coupons and adjustments, and snapshots the bank', async () => {
        const seller = await approvedSeller({ percent: 10 });
        await api().patch(`${A}/sellers/${seller.id}`).set(as(admin)).send({ commission: { byModule: { grocery: { percent: 5 } } } }).expect(200);
        const product = await addProduct(seller);
        await api()
            .post(`${A}/coupons`)
            .set(as(admin))
            .send({ code: 'SHOP50', type: 'flat', value: 5000, seller: seller.id, fundedBy: 'seller', perUserLimit: 5 })
            .expect(201);
        const customer = await customerWithAddress();
        const order = await placed(customer, product, seller.id, 1, { couponCode: 'SHOP50' });
        expect(order.seller.commissionPercent).toBe(5);
        await deliver(order._id);

        // ₹300 gross − 5% (₹15) − ₹50 seller-funded coupon = ₹235; then a ₹20 debit.
        await api().post(`${A}/sellers/${seller.id}/adjustments`).set(as(admin)).send({ amountPaise: -2000, reason: 'Damaged pack refunded', orderId: order._id }).expect(201);
        const balance = (await api().get(`${S}/earnings`).set(as(seller.token)).expect(200)).body.data.balance;
        expect(balance.payablePaise).toBe(23500 - 2000);

        const payout = (await api().post(`${A}/payouts`).set(as(admin)).send({ sellerId: seller.id }).expect(201)).body.data;
        expect(payout).toMatchObject({ netPaise: 21500, sellerDiscountPaise: 5000, adjustmentsPaise: -2000, bank: { accountNumber: '1234567890' } });
        // A later bank change doesn't touch the payout.
        await Seller.updateOne({ _id: seller.id }, { $set: { 'bank.accountNumber': '9999999999' } });
        const statement = (await api().get(`${A}/payouts/${payout._id}`).set(as(admin)).expect(200)).body.data;
        expect(statement.bank.accountNumber).toBe('1234567890');
        expect(statement.adjustments).toHaveLength(1);
        const theirs = (await api().get(`${S}/payouts/${payout._id}`).set(as(seller.token)).expect(200)).body.data;
        expect(theirs.bank.accountNumber).toBe('••••7890');

        const report = (await api().get(`${A}/payouts/report`).set(as(admin)).expect(200)).body.data;
        expect(report.sellers[0]).toMatchObject({ sellerId: seller.id, grossPaise: 30000, commissionPaise: 1500, sellerDiscountPaise: 5000 });

        // The seller's own coupon doesn't work on Nearmart's stock.
        const own = (await api().post(`${A}/catalog/products`).set(as(admin)).send({ module: 'grocery', category: flours._id, name: 'House Dal', variants: [{ label: '1 kg', pricePaise: 25000, stockQty: 9 }] }).expect(201)).body.data;
        const refused = await buy(await customerWithAddress('9876500003'), own, null, 1, { couponCode: 'SHOP50' });
        expect(refused.status).toBe(400);
        expect(refused.body.message).toMatch(/another store/);
    });

    it('carries a debit larger than the earnings into the next payout', async () => {
        const seller = await approvedSeller();
        await api().post(`${A}/sellers/${seller.id}/adjustments`).set(as(admin)).send({ amountPaise: -5000, reason: 'Penalty' }).expect(201);
        const res = await api().post(`${A}/payouts`).set(as(admin)).send({ sellerId: seller.id });
        expect(res.status).toBe(400);
        expect(res.body.message).toMatch(/owes/);
    });
});

describe('quality controls', () => {
    it('holds new products for review when reviews are on', async () => {
        await api().put(`${A}/sellers/config`).set(as(admin)).send({ reviewNewProducts: true }).expect(200);
        const seller = await approvedSeller();
        const product = await addProduct(seller);
        expect(product.review.status).toBe('pending');
        const listed = await api().get('/api/v1/catalog/products?module=grocery').expect(200);
        expect(listed.body.data.items.find((p) => p.id === product._id)).toBeUndefined();

        const queue = (await api().get(`${A}/sellers/products/review`).set(as(admin)).expect(200)).body.data;
        expect(queue.items.map((p) => p._id)).toContain(product._id);
        await api().post(`${A}/sellers/products/${product._id}/review`).set(as(admin)).send({ decision: 'approved' }).expect(200);
        const after = await api().get('/api/v1/catalog/products?module=grocery').expect(200);
        expect(after.body.data.items.find((p) => p.id === product._id)).toBeTruthy();
    });

    it('rejects malformed PAN, GSTIN and IFSC', async () => {
        n += 1;
        const phone = `97${String(Date.now()).slice(-8)}`;
        const otpRes = await api().post('/api/v1/auth/seller/signup/request-otp').send({ phone }).expect(200);
        const verified = await api().post('/api/v1/auth/seller/signup/verify-otp').send({ phone, otp: otpRes.body.data.devOtp }).expect(200);
        const token = (await api().post('/api/v1/auth/seller/signup').send({ signupToken: verified.body.data.signupToken, businessName: 'KYC Test', ownerName: 'Owner', email: `${phone}@kyc.test`, password: 'shop-pass-12345' }).expect(200)).body.data.accessToken;
        const bad = await api().patch(`${S}/application`).set(as(token)).send({ legal: { pan: 'ABC123', gstin: '27AAPFU0939F1ZX' } });
        expect(bad.status).toBe(400);
        expect(bad.body.details.map((d) => d.path)).toEqual(expect.arrayContaining(['legal.pan', 'legal.gstin']));
        const mismatch = await api().patch(`${S}/application`).set(as(token)).send({ legal: { pan: 'ABCDE1234F', gstin: '27AAPFU0939F1ZV' } });
        expect(mismatch.body.message).toMatch(/doesn't match the PAN/);
        await api().patch(`${S}/application`).set(as(token)).send({ legal: { pan: 'aapfu0939f', gstin: '27aapfu0939f1zv' } }).expect(200);
    });
});
