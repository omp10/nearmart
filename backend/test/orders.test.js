import crypto from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, createStaff, loginCustomer, loginStaff } from './helpers.js';
import { Cart } from '../src/modules/cart/cart.model.js';
import { Product } from '../src/modules/catalog/product.model.js';
import { StockMovement } from '../src/modules/catalog/stockMovement.model.js';
import { Coupon } from '../src/modules/coupons/coupon.model.js';
import { Order } from '../src/modules/orders/order.model.js';
import { expireUnpaidOrders } from '../src/modules/orders/order.service.js';
import { Payment } from '../src/modules/payments/payment.model.js';
import { gateway } from '../src/modules/payments/payment.service.js';
import { SlotReservation, SlotRule } from '../src/modules/slots/slot.model.js';
import { Zone } from '../src/modules/zones/zone.model.js';

const realGateway = { ...gateway };
let admin;
let customer;
let addressId;
let atta;
let rice;
let tv;

const A = '/api/v1/admin';
const as = (auth) => ({ Authorization: `Bearer ${auth}` });

/** Payment handlers run after the webhook responds; wait for their effect. */
const eventually = async (check, ms = 3000) => {
    const start = Date.now();
    for (;;) {
        try {
            return await check();
        } catch (err) {
            if (Date.now() - start > ms) throw err;
            await new Promise((r) => setTimeout(r, 25));
        }
    }
};

const webhook = (body) => {
    const raw = JSON.stringify(body);
    return api()
        .post('/api/v1/payments/webhook/razorpay')
        .set('Content-Type', 'application/json')
        .set('x-razorpay-signature', crypto.createHmac('sha256', process.env.RAZORPAY_WEBHOOK_SECRET).update(raw).digest('hex'))
        .set('x-razorpay-event-id', crypto.randomUUID())
        .send(raw)
        .expect(200);
};
const captured = (gatewayOrderId, amount) => ({
    event: 'payment.captured',
    payload: { payment: { entity: { id: `pay_${gatewayOrderId}`, order_id: gatewayOrderId, amount } } }
});

const setCart = (items) => Promise.all(items.map(([product, variantIndex, qty]) =>
    api().put('/api/v1/cart/items').set(as(customer)).send({ productId: product._id, variantId: product.variants[variantIndex]._id, qty }).expect(200)));

const checkout = (body = {}) =>
    api().post('/api/v1/checkout').set(as(customer)).send({ module: 'grocery', addressId, paymentMethod: 'cod', ...body });

const stockOf = async (product, i = 0) => (await Product.findById(product._id).lean()).variants[i].stockQty;

beforeEach(async () => {
    Object.assign(gateway, {
        createOrder: vi.fn(async ({ amount }) => ({ id: `order_${crypto.randomBytes(4).toString('hex')}`, amount })),
        fetchPayment: vi.fn(),
        refund: vi.fn(async (_id, { amount }) => ({ id: `rfnd_${amount}` }))
    });

    admin = (await loginStaff(await createStaff())).token;
    await Zone.create({ name: 'Kothrud', modules: ['grocery', 'electronics'], pincodes: ['411038'], deliveryFeePaise: 3000, freeDeliveryAbovePaise: 50000 });

    const post = async (path, body) => {
        const res = await api().post(`${A}${path}`).set(as(admin)).send(body);
        if (res.status !== 201) throw new Error(JSON.stringify(res.body));
        return res.body.data;
    };
    const flours = await post('/catalog/categories', { module: 'grocery', name: 'Flours' });
    const tvs = await post('/catalog/categories', { module: 'electronics', name: 'TVs' });
    atta = await post('/catalog/products', {
        module: 'grocery', category: flours._id, name: 'Atta', gstRate: 5,
        variants: [{ label: '1 kg', pricePaise: 6500, offerPricePaise: 6000, stockQty: 10, maxPerOrder: 5 }, { label: '5 kg', pricePaise: 29000, stockQty: 3 }]
    });
    rice = await post('/catalog/products', { module: 'grocery', category: flours._id, name: 'Rice', variants: [{ label: '1 kg', pricePaise: 12000, stockQty: 4 }] });
    tv = await post('/catalog/products', { module: 'electronics', category: tvs._id, name: 'TV', gstRate: 18, variants: [{ label: '43"', pricePaise: 2500000, stockQty: 2 }] });

    const session = await loginCustomer();
    customer = session.accessToken;
    const address = await api().post('/api/v1/me/addresses').set(as(customer))
        .send({ line1: '12 Paud Road', city: 'Pune', state: 'Maharashtra', pincode: '411038', name: 'Asha' });
    addressId = address.body.data._id;
});

afterEach(() => {
    Object.assign(gateway, realGateway);
});

describe('cart', () => {
    it('groups by module, prices from the catalogue and enforces limits', async () => {
        await setCart([[atta, 0, 2], [tv, 0, 1]]);
        const res = await api().get('/api/v1/cart').set(as(customer));
        const grocery = res.body.data.groups.find((g) => g.module === 'grocery');
        expect(grocery).toMatchObject({ subtotalPaise: 12000, itemCount: 2, hasIssues: false });
        expect(res.body.data.groups.map((g) => g.module).sort()).toEqual(['electronics', 'grocery']);

        const tooMany = await api().put('/api/v1/cart/items').set(as(customer)).send({ productId: atta._id, variantId: atta.variants[0]._id, qty: 6 });
        expect(tooMany.status).toBe(400);
        expect(tooMany.body.message).toMatch(/at most 5/);

        await Product.updateOne({ _id: rice._id }, { isActive: false });
        await Cart.updateOne({}, { $push: { items: { product: rice._id, variant: rice.variants[0]._id, qty: 1 } } });
        const after = await api().get('/api/v1/cart').set(as(customer));
        const line = after.body.data.groups.find((g) => g.module === 'grocery').lines.find((l) => l.productId === rice._id);
        expect(line.issue).toBe('unavailable');
    });
});

describe('checkout pricing', () => {
    it('adds the zone delivery fee below the free threshold and reports included GST', async () => {
        await setCart([[atta, 0, 2]]);
        const res = await api().post('/api/v1/checkout/quote').set(as(customer)).send({ module: 'grocery', addressId });
        expect(res.body.data.pricing).toEqual({
            subtotalPaise: 12000, discountPaise: 0, deliveryFeePaise: 3000, taxPaise: 571, totalPaise: 15000, savingsPaise: 1000
        });

        await setCart([[atta, 1, 2]]);
        const free = await api().post('/api/v1/checkout/quote').set(as(customer)).send({ module: 'grocery', addressId });
        expect(free.body.data.pricing.deliveryFeePaise).toBe(0);
    });

    it('applies a capped percentage coupon and explains rejections', async () => {
        await Coupon.create({ code: 'SAVE10', type: 'percent', value: 10, maxDiscountPaise: 1500, minOrderPaise: 10000 });
        await setCart([[atta, 0, 1]]);
        const low = await api().post('/api/v1/checkout/quote').set(as(customer)).send({ module: 'grocery', addressId, couponCode: 'save10' });
        expect(low.status).toBe(400);
        expect(low.body.message).toMatch(/more to use this coupon/);

        await setCart([[atta, 1, 1]]);
        const ok = await api().post('/api/v1/checkout/quote').set(as(customer)).send({ module: 'grocery', addressId, couponCode: 'save10' });
        expect(ok.body.data.pricing).toMatchObject({ subtotalPaise: 35000, discountPaise: 1500, deliveryFeePaise: 3000, totalPaise: 36500 });
    });

    it('refuses addresses outside the zone and carts with problems', async () => {
        const far = await api().post('/api/v1/me/addresses').set(as(customer)).send({ line1: '1 MG Road', city: 'Mumbai', state: 'MH', pincode: '400001' });
        await setCart([[atta, 0, 1]]);
        const outside = await api().post('/api/v1/checkout/quote').set(as(customer)).send({ module: 'grocery', addressId: far.body.data._id });
        expect(outside.status).toBe(400);

        await Product.updateOne({ _id: atta._id, 'variants._id': atta.variants[0]._id }, { $set: { 'variants.$.stockQty': 0 } });
        const short = await api().post('/api/v1/checkout/quote').set(as(customer)).send({ module: 'grocery', addressId });
        expect(short.status).toBe(409);
        expect(short.body.details[0]).toMatchObject({ name: 'Atta', issue: 'out_of_stock' });
    });
});

describe('placing orders', () => {
    it('places a cash order: stock taken, ledger written, only that module leaves the cart', async () => {
        await setCart([[atta, 0, 2], [rice, 0, 1], [tv, 0, 1]]);
        const res = await checkout({ notes: 'Ring the bell' });
        expect(res.status, JSON.stringify(res.body)).toBe(201);
        const order = res.body.data.order;
        expect(order).toMatchObject({ status: 'placed', module: 'grocery', payment: { method: 'cod', status: 'pending' } });
        expect(order.orderNumber).toMatch(/^NM\d{6}[0-9A-F]{6}$/);
        expect(order.items).toHaveLength(2);
        expect(order.pricing.totalPaise).toBe(12000 + 12000 + 3000);

        expect(await stockOf(atta)).toBe(8);
        expect(await StockMovement.countDocuments({ reason: 'order', refId: order._id })).toBe(2);
        const cart = await api().get('/api/v1/cart').set(as(customer));
        expect(cart.body.data.groups.map((g) => g.module)).toEqual(['electronics']);
    });

    it('requires and books a slot when the module has slot rules', async () => {
        const rule = await SlotRule.create({ module: 'grocery', kind: 'delivery', daysOfWeek: [0, 1, 2, 3, 4, 5, 6], start: '23:00', end: '23:59', capacity: 1, cutoffMinutes: 0 });
        await setCart([[atta, 0, 1]]);
        expect((await checkout()).body.message).toMatch(/choose a delivery slot/);

        const slots = await api().get('/api/v1/slots?module=grocery&pincode=411038&days=2');
        const slotId = slots.body.data.days.flatMap((d) => d.slots).find((s) => s.available).id;
        const res = await checkout({ slotId });
        expect(res.status, JSON.stringify(res.body)).toBe(201);
        expect(res.body.data.order.slot.id).toBe(slotId);
        expect((await SlotReservation.findOne({ rule: rule._id }).lean()).count).toBe(1);

        await setCart([[rice, 0, 1]]);
        expect((await checkout({ slotId })).status).toBe(400); // capacity 1, now full
    });

    it('undoes stock, slot and coupon if the payment gateway fails', async () => {
        await SlotRule.create({ module: 'grocery', kind: 'delivery', daysOfWeek: [0, 1, 2, 3, 4, 5, 6], start: '23:00', end: '23:59', capacity: 5, cutoffMinutes: 0 });
        await Coupon.create({ code: 'FLAT20', type: 'flat', value: 2000, usageLimit: 10 });
        gateway.createOrder = vi.fn(async () => { throw new Error('gateway down'); });
        await setCart([[atta, 0, 2], [rice, 0, 1]]);
        const slots = await api().get('/api/v1/slots?module=grocery&pincode=411038&days=2');
        const slotId = slots.body.data.days.flatMap((d) => d.slots).find((s) => s.available).id;

        const res = await checkout({ paymentMethod: 'online', slotId, couponCode: 'FLAT20' });
        expect(res.status).toBe(500);
        expect(await stockOf(atta)).toBe(10);
        expect(await stockOf(rice)).toBe(4);
        expect(await Order.countDocuments()).toBe(0);
        expect((await SlotReservation.findOne().lean()).count).toBe(0);
        expect((await Coupon.findOne({ code: 'FLAT20' }).lean()).usedCount).toBe(0);
        expect((await api().get('/api/v1/cart').set(as(customer))).body.data.itemCount).toBe(3);
    });

    it('online: pending until paid, then placed; a cancel refunds in full', async () => {
        await setCart([[atta, 0, 1]]);
        const res = await checkout({ paymentMethod: 'online' });
        expect(res.status, JSON.stringify(res.body)).toBe(201);
        const { order, payment } = res.body.data;
        expect(order.status).toBe('pending_payment');
        expect(payment).toMatchObject({ amountPaise: 9000, currency: 'INR' });

        await webhook(captured(payment.gatewayOrderId, 9000));
        await eventually(async () => expect((await Order.findById(order._id).lean()).status).toBe('placed'));
        expect((await Order.findById(order._id).lean()).payment.status).toBe('paid');

        const cancel = await api().post(`${A}/orders/${order._id}/cancel`).set(as(admin)).send({ reason: 'Customer called' });
        expect(cancel.status).toBe(200);
        expect(gateway.refund).toHaveBeenCalledWith(`pay_${payment.gatewayOrderId}`, expect.objectContaining({ amount: 9000 }));
        expect(cancel.body.data.payment).toMatchObject({ status: 'refund_pending', refundPendingPaise: 9000 });
        expect(await stockOf(atta)).toBe(10);

        await webhook({ event: 'refund.processed', payload: { refund: { entity: { id: 'rfnd_9000', payment_id: `pay_${payment.gatewayOrderId}`, amount: 9000 } } } });
        await eventually(async () => expect((await Order.findById(order._id).lean()).payment).toMatchObject({ status: 'refunded', refundPendingPaise: 0 }));
    });

    it('refunds just the difference when an item on a paid order is unavailable', async () => {
        await setCart([[atta, 0, 2], [rice, 0, 1]]);
        const { order, payment } = (await checkout({ paymentMethod: 'online' })).body.data;
        await webhook(captured(payment.gatewayOrderId, 27000));
        await eventually(async () => expect((await Order.findById(order._id).lean()).status).toBe('placed'));

        const riceLine = order.items.find((l) => l.name === 'Rice');
        const res = await api().post(`${A}/orders/${order._id}/items/${riceLine._id}/unavailable`).set(as(admin)).send({});
        expect(res.body.data.pricing.totalPaise).toBe(15000);
        expect(gateway.refund).toHaveBeenCalledWith(`pay_${payment.gatewayOrderId}`, expect.objectContaining({ amount: 12000 }));
        expect(res.body.data.payment).toMatchObject({ status: 'refund_pending', refundPendingPaise: 12000 });

        // Cancelling afterwards refunds only what is left.
        await api().post(`${A}/orders/${order._id}/cancel`).set(as(admin)).send({ reason: 'Customer called' }).expect(200);
        expect(gateway.refund).toHaveBeenLastCalledWith(`pay_${payment.gatewayOrderId}`, expect.objectContaining({ amount: 15000 }));
    });

    it('expires unpaid orders and refunds a payment that arrives afterwards', async () => {
        await setCart([[atta, 0, 3]]);
        const { order, payment } = (await checkout({ paymentMethod: 'online' })).body.data;
        expect(await stockOf(atta)).toBe(7);

        expect(await expireUnpaidOrders(new Date(Date.now() + 16 * 60_000))).toBe(1);
        expect((await Order.findById(order._id).lean()).status).toBe('cancelled');
        expect(await stockOf(atta)).toBe(10);

        await webhook(captured(payment.gatewayOrderId, payment.amountPaise));
        await eventually(() => expect(gateway.refund).toHaveBeenCalledWith(`pay_${payment.gatewayOrderId}`, expect.objectContaining({ amount: payment.amountPaise })));
    });
});

describe('fulfilment', () => {
    let order;
    beforeEach(async () => {
        await setCart([[atta, 0, 2], [rice, 0, 1]]);
        order = (await checkout()).body.data.order;
    });
    const move = (status, auth = admin) => api().post(`${A}/orders/${order._id}/status`).set(as(auth)).send({ status });

    it('moves step by step, refuses skipping, and marks cash paid on delivery', async () => {
        expect((await move('delivered')).status).toBe(409);
        for (const s of ['accepted', 'packing', 'ready', 'dispatched']) expect((await move(s)).status).toBe(200);
        expect((await api().post(`${A}/orders/${order._id}/cancel`).set(as(admin)).send({ reason: 'too late' })).status).toBe(409);
        const done = await move('delivered');
        expect(done.body.data).toMatchObject({ status: 'delivered', payment: { status: 'paid' } });
        expect(done.body.data.statusHistory.map((h) => h.status)).toEqual(['placed', 'accepted', 'packing', 'ready', 'dispatched', 'delivered']);
    });

    it('lets customers cancel only before packing', async () => {
        await move('accepted');
        await move('packing');
        const res = await api().post(`/api/v1/orders/${order._id}/cancel`).set(as(customer)).send({});
        expect(res.status).toBe(409);
    });

    it('re-prices when an item is unavailable, and cancels when none are left', async () => {
        const riceLine = order.items.find((l) => l.name === 'Rice');
        const res = await api().post(`${A}/orders/${order._id}/items/${riceLine._id}/unavailable`).set(as(admin)).send({ note: 'damaged' });
        expect(res.status).toBe(200);
        expect(res.body.data.pricing).toMatchObject({ subtotalPaise: 12000, deliveryFeePaise: 3000, totalPaise: 15000 });
        expect(res.body.data.originalTotalPaise).toBe(27000);
        expect(await stockOf(rice)).toBe(3); // not restocked: it was found unavailable

        const attaLine = order.items.find((l) => l.name === 'Atta');
        const last = await api().post(`${A}/orders/${order._id}/items/${attaLine._id}/unavailable`).set(as(admin)).send({});
        expect(last.body.data.status).toBe('cancelled');
        expect(last.body.data.cancelReason).toMatch(/None of the items/);
        expect(await stockOf(atta)).toBe(8); // found unavailable, so not put back either
    });

    it('limits ops users to their modules', async () => {
        const ops = await createStaff({ role: 'ops', isSuperAdmin: false, modules: ['electronics'], permissions: { orders: ['view', 'update'] } });
        const token = (await loginStaff(ops)).token;
        expect((await move('accepted', token)).status).toBe(403);
        const list = await api().get(`${A}/orders`).set(as(token));
        expect(list.body.data.total).toBe(0);
    });
});

describe('coupons', () => {
    it('enforces per-customer and total limits, and frees a use on cancel', async () => {
        await Coupon.create({ code: 'ONCE', type: 'flat', value: 1000, perUserLimit: 1, usageLimit: 5 });
        await setCart([[atta, 0, 1]]);
        const first = await checkout({ couponCode: 'ONCE' });
        expect(first.body.data.order.pricing.discountPaise).toBe(1000);

        await setCart([[atta, 0, 1]]);
        expect((await checkout({ couponCode: 'ONCE' })).body.message).toMatch(/already used/);

        await api().post(`/api/v1/orders/${first.body.data.order._id}/cancel`).set(as(customer)).send({}).expect(200);
        expect((await Coupon.findOne({ code: 'ONCE' }).lean()).usedCount).toBe(0);
        expect((await checkout({ couponCode: 'ONCE' })).status).toBe(201);
    });

    it('is managed by admins with validation', async () => {
        const bad = await api().post(`${A}/coupons`).set(as(admin)).send({ code: 'BIG', type: 'percent', value: 150 });
        expect(bad.status).toBe(400);
        const ok = await api().post(`${A}/coupons`).set(as(admin)).send({ code: 'diwali25', type: 'percent', value: 25, maxDiscountPaise: 20000 });
        expect(ok.body.data.code).toBe('DIWALI25');
    });
});

describe('customer order history', () => {
    it('lists, shows, and re-orders', async () => {
        await setCart([[atta, 0, 2]]);
        const { order } = (await checkout()).body.data;
        const list = await api().get('/api/v1/orders?status=open').set(as(customer));
        expect(list.body.data.items.map((o) => o.orderNumber)).toEqual([order.orderNumber]);

        const re = await api().post(`/api/v1/orders/${order._id}/reorder`).set(as(customer));
        expect(re.body.data.skipped).toEqual([]);
        expect((await api().get('/api/v1/cart').set(as(customer))).body.data.itemCount).toBe(2);

        const other = await loginCustomer('9123456780');
        expect((await api().get(`/api/v1/orders/${order._id}`).set(as(other.accessToken))).status).toBe(404);
    });
});

describe('payment record shape', () => {
    it('stores refund requests on the payment', async () => {
        await setCart([[atta, 0, 1]]);
        const { order, payment } = (await checkout({ paymentMethod: 'online' })).body.data;
        await webhook(captured(payment.gatewayOrderId, payment.amountPaise));
        await eventually(async () => expect((await Order.findById(order._id).lean()).status).toBe('placed'));
        await api().post(`/api/v1/orders/${order._id}/cancel`).set(as(customer)).send({}).expect(200);
        const stored = await Payment.findById(payment.paymentId).lean();
        expect(stored.refundRequests).toHaveLength(1);
        expect(stored.refundRequests[0]).toMatchObject({ amountPaise: payment.amountPaise });
    });
});
