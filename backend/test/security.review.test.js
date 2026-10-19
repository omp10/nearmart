/** Regression tests for the Phase 6 security review findings. */
import crypto from 'node:crypto';
import mongoose from 'mongoose';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, createStaff, loginCustomer, loginStaff } from './helpers.js';
import { Coupon, CouponUsage } from '../src/modules/coupons/coupon.model.js';
import { Order } from '../src/modules/orders/order.model.js';
import { Payment } from '../src/modules/payments/payment.model.js';
import { gateway, handleWebhookEvent, initiateRefund, verifyClientPayment } from '../src/modules/payments/payment.service.js';
import { Zone } from '../src/modules/zones/zone.model.js';

const realGateway = { ...gateway };
afterEach(() => Object.assign(gateway, realGateway));

const auth = (t) => ({ Authorization: `Bearer ${t}` });

describe('staff escalation', () => {
    it('a sub-admin cannot reset or disable a colleague with more access', async () => {
        const sub = await createStaff({ isSuperAdmin: false, permissions: { staff: ['view', 'create', 'update'] } });
        const stronger = await createStaff({ isSuperAdmin: false, permissions: { staff: ['view', 'update'], orders: ['view', 'update'], reports: ['view'] } });
        const { token } = await loginStaff(sub);
        expect((await api().post(`/api/v1/admin/staff/${stronger._id}/reset-password`).set(auth(token)).send({ password: 'taken-over-1234' })).status).toBe(403);
        expect((await api().patch(`/api/v1/admin/staff/${stronger._id}`).set(auth(token)).send({ isActive: false })).status).toBe(403);
    });

    it('an ops user cannot create admins, staff for other modules, or promote anyone', async () => {
        const ops = await createStaff({ isSuperAdmin: false, role: 'ops', modules: ['grocery'], permissions: { staff: ['view', 'create', 'update'], orders: ['view'] } });
        const { token } = await loginStaff(ops);
        const base = { name: 'X', password: 'x-password-123', permissions: { orders: ['view'] } };
        expect((await api().post('/api/v1/admin/staff').set(auth(token)).send({ ...base, email: 'a@nearmart.test', role: 'admin' })).status).toBe(403);
        expect((await api().post('/api/v1/admin/staff').set(auth(token)).send({ ...base, email: 'b@nearmart.test', role: 'ops', modules: ['electronics'] })).status).toBe(403);
        const peer = await api().post('/api/v1/admin/staff').set(auth(token)).send({ ...base, email: 'c@nearmart.test', role: 'ops', modules: ['grocery'] });
        expect(peer.status).toBe(201);
        expect((await api().patch(`/api/v1/admin/staff/${peer.body.data.id}`).set(auth(token)).send({ role: 'admin' })).status).toBe(403);
    });
});

describe('payments', () => {
    const fakePayment = (overrides = {}) =>
        Payment.create({
            userId: new mongoose.Types.ObjectId(),
            refType: 'order',
            refId: new mongoose.Types.ObjectId(),
            amountPaise: 10000,
            gatewayOrderId: `order_${crypto.randomBytes(4).toString('hex')}`,
            gatewayPaymentId: `pay_${crypto.randomBytes(4).toString('hex')}`,
            status: 'paid',
            ...overrides
        });

    it('concurrent refund requests never exceed the captured amount', async () => {
        gateway.refund = vi.fn(async (_id, { amount }) => {
            await new Promise((r) => setTimeout(r, 20));
            return { id: `rfnd_${crypto.randomBytes(3).toString('hex')}`, amount };
        });
        const p = await fakePayment();
        await Promise.allSettled([initiateRefund(p._id, 10000), initiateRefund(p._id, 10000), initiateRefund(p._id, 10000)]);
        const total = gateway.refund.mock.calls.reduce((s, [, { amount }]) => s + amount, 0);
        expect(total).toBe(10000);
        expect((await Payment.findById(p._id).lean()).refundRequestedPaise).toBe(10000);
    });

    it('a failed gateway call releases its refund reservation', async () => {
        gateway.refund = vi.fn(async () => {
            throw new Error('gateway down');
        });
        const p = await fakePayment();
        await expect(initiateRefund(p._id, 4000)).rejects.toThrow('gateway down');
        const stored = await Payment.findById(p._id).lean();
        expect(stored.refundRequestedPaise).toBe(0);
        expect(stored.refundRequests).toEqual([]);
    });

    it('a refund.processed replayed under other event ids is counted once', async () => {
        const p = await fakePayment();
        const body = { event: 'refund.processed', payload: { refund: { entity: { id: 'rfnd_1', payment_id: p.gatewayPaymentId, amount: 3000 } } } };
        await handleWebhookEvent('evt_a', body);
        await handleWebhookEvent('evt_b', body);
        await handleWebhookEvent(undefined, body);
        expect((await Payment.findById(p._id).lean()).refundedPaise).toBe(3000);
    });

    it('client verify does not mark an only-authorized payment as paid', async () => {
        const p = await fakePayment({ status: 'created', gatewayPaymentId: null });
        gateway.fetchPayment = vi.fn(async () => ({ order_id: p.gatewayOrderId, amount: 10000, status: 'authorized' }));
        const signature = crypto.createHmac('sha256', process.env.RAZORPAY_KEY_SECRET).update(`${p.gatewayOrderId}|pay_x`).digest('hex');
        const result = await verifyClientPayment({ userId: p.userId, gatewayOrderId: p.gatewayOrderId, gatewayPaymentId: 'pay_x', signature });
        expect(result.status).toBe('created');
    });
});

describe('OTP requests', () => {
    it('parallel requests cannot exceed the per-window limit', async () => {
        const results = await Promise.all(Array.from({ length: 6 }, () => api().post('/api/v1/auth/customer/request-otp').send({ phone: '9000000001' })));
        expect(results.filter((r) => r.status === 200)).toHaveLength(3);
        expect(results.filter((r) => r.status === 429)).toHaveLength(3);
    });
});

describe('checkout limits', () => {
    const setup = async () => {
        const { token } = await loginStaff(await createStaff());
        const post = async (p, body) => (await api().post(`/api/v1/admin${p}`).set(auth(token)).send(body).expect(201)).body.data;
        await Zone.create({ name: 'Z', modules: ['grocery'], pincodes: ['411038'] });
        const cat = await post('/catalog/categories', { module: 'grocery', name: 'C' });
        const product = await post('/catalog/products', { module: 'grocery', category: cat._id, name: 'P', variants: [{ label: '1', pricePaise: 10000, stockQty: 100 }] });
        const customer = (await loginCustomer('9000000002')).accessToken;
        const address = await api().post('/api/v1/me/addresses').set(auth(customer)).send({ line1: '12 Road', city: 'Pune', state: 'MH', pincode: '411038' });
        const addToCart = () => api().put('/api/v1/cart/items').set(auth(customer)).send({ productId: product._id, variantId: product.variants[0]._id, qty: 1 }).expect(200);
        const checkout = (body) => api().post('/api/v1/checkout').set(auth(customer)).send({ module: 'grocery', addressId: address.body.data._id, ...body });
        return { addToCart, checkout };
    };

    it('parallel checkouts cannot use a once-per-customer coupon twice', async () => {
        const { addToCart, checkout } = await setup();
        await Coupon.create({ code: 'ONCE', type: 'flat', value: 1000, perUserLimit: 1 });
        await addToCart();
        await Promise.all(Array.from({ length: 4 }, () => checkout({ paymentMethod: 'cod', couponCode: 'ONCE' })));
        expect(await Order.countDocuments({ 'coupon.code': 'ONCE' })).toBe(1);
        expect((await CouponUsage.findOne().lean()).count).toBe(1);
        expect((await Coupon.findOne({ code: 'ONCE' }).lean()).usedCount).toBe(1);
    });

    it('caps unpaid online orders per customer', async () => {
        gateway.createOrder = vi.fn(async () => ({ id: `order_${crypto.randomBytes(4).toString('hex')}` }));
        const { addToCart, checkout } = await setup();
        const statuses = [];
        for (let i = 0; i < 4; i += 1) {
            await addToCart();
            statuses.push((await checkout({ paymentMethod: 'online' })).status);
        }
        expect(statuses).toEqual([201, 201, 201, 429]);
    });
});

describe('request ids', () => {
    it('reuses a well-formed X-Request-Id and replaces anything else', async () => {
        const good = await api().get('/api/v1/health').set('X-Request-Id', 'abc-123');
        expect(good.headers['x-request-id']).toBe('abc-123');
        const bad = await api().get('/api/v1/health').set('X-Request-Id', `${'x'.repeat(200)}<script>`);
        expect(bad.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    });
});
