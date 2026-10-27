import { beforeEach, describe, expect, it } from 'vitest';
import { api, createStaff, loginCustomer, loginStaff } from './helpers.js';
import { Order } from '../src/modules/orders/order.model.js';
import { Rider } from '../src/modules/riders/rider.model.js';
import { DeliveryTask } from '../src/modules/riders/task.model.js';
import { Zone } from '../src/modules/zones/zone.model.js';

const A = '/api/v1/admin';
const as = (token) => ({ Authorization: `Bearer ${token}` });
const RIDER_PHONE = '9123456780';

let admin;
let customer;
let orderId;

const loginRider = async (phone = RIDER_PHONE) => {
    const otp = await api().post('/api/v1/auth/rider/request-otp').send({ phone });
    expect(otp.status, JSON.stringify(otp.body)).toBe(200);
    const res = await api().post('/api/v1/auth/rider/verify-otp').send({ phone, otp: otp.body.data.devOtp });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return res.body.data;
};

/** A cash order for ₹130 + ₹30 delivery, packed and ready for pickup. */
const readyCodOrder = async () => {
    const res = await api().post('/api/v1/checkout').set(as(customer)).send({ module: 'grocery', addressId: customer.addressId, paymentMethod: 'cod' });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const id = res.body.data.order._id;
    for (const status of ['accepted', 'packing', 'ready']) {
        await api().post(`${A}/orders/${id}/status`).set(as(admin)).send({ status }).expect(200);
    }
    return id;
};

beforeEach(async () => {
    admin = (await loginStaff(await createStaff())).token;
    await Zone.create({ name: 'Kothrud', modules: ['grocery'], pincodes: ['411038'], deliveryFeePaise: 3000 });
    const flours = (await api().post(`${A}/catalog/categories`).set(as(admin)).send({ module: 'grocery', name: 'Flours' })).body.data;
    const atta = (await api().post(`${A}/catalog/products`).set(as(admin)).send({
        module: 'grocery', category: flours._id, name: 'Atta', variants: [{ label: '1 kg', pricePaise: 6500, stockQty: 20 }]
    })).body.data;

    const session = await loginCustomer();
    customer = session.accessToken;
    const address = await api().post('/api/v1/me/addresses').set(as(customer))
        .send({ line1: '12 Paud Road', city: 'Pune', state: 'Maharashtra', pincode: '411038', name: 'Asha', lat: 18.507, lng: 73.807 });
    customer = Object.assign(new String(customer), { addressId: address.body.data._id });
    await api().put('/api/v1/cart/items').set(as(customer)).send({ productId: atta._id, variantId: atta.variants[0]._id, qty: 2 }).expect(200);

    await api().post(`${A}/riders`).set(as(admin)).send({ name: 'Suresh', phone: RIDER_PHONE, vehicle: 'bike', modules: ['grocery'], payoutPerTaskPaise: 3500 }).expect(201);
    orderId = await readyCodOrder();
});

describe('delivery partner sign-in', () => {
    it('only lets registered, active partners sign in', async () => {
        const stranger = await api().post('/api/v1/auth/rider/request-otp').send({ phone: '9000000001' });
        expect(stranger.status).toBe(403);
        expect(stranger.body.message).toMatch(/isn't registered/);

        const session = await loginRider();
        expect(session.rider).toMatchObject({ name: 'Suresh', phone: RIDER_PHONE, vehicle: 'bike' });
        expect(session.refreshToken).toBeTruthy();

        const me = await api().get('/api/v1/rider/me').set(as(session.accessToken));
        expect(me.body.data.today).toEqual({ deliveries: 0, earningsPaise: 0, cashInHandPaise: 0 });

        // Customers can't use the rider app and riders can't use the admin.
        expect((await api().get('/api/v1/rider/me').set(as(customer))).status).toBe(403);
        expect((await api().get(`${A}/orders`).set(as(session.accessToken))).status).toBe(403);

        // Switching the partner off ends their session at once.
        const rider = await Rider.findOne({ phone: RIDER_PHONE });
        await api().patch(`${A}/riders/${rider._id}`).set(as(admin)).send({ isActive: false }).expect(200);
        expect((await api().get('/api/v1/rider/me').set(as(session.accessToken))).status).toBe(401);
        expect((await api().post('/api/v1/auth/rider/request-otp').send({ phone: RIDER_PHONE })).status).toBe(403);
    });

    it('refreshes a partner session', async () => {
        const session = await loginRider();
        const res = await api().post('/api/v1/auth/refresh').send({ refreshToken: session.refreshToken });
        expect(res.status).toBe(200);
        expect((await api().get('/api/v1/rider/me').set(as(res.body.data.accessToken))).status).toBe(200);
    });
});

describe('a cash delivery, end to end', () => {
    it('assigns, accepts, picks up, checks the code and cash, and settles the deposit', async () => {
        const rider = await Rider.findOne({ phone: RIDER_PHONE }).lean();
        const { accessToken: r } = await loginRider();
        await api().post('/api/v1/rider/shift').set(as(r)).send({ online: true }).expect(200);

        const assigned = await api().post(`${A}/riders/tasks`).set(as(admin)).send({ kind: 'order_delivery', refId: orderId, riderId: rider._id });
        expect(assigned.status, JSON.stringify(assigned.body)).toBe(201);
        expect(assigned.body.data).toMatchObject({ status: 'offered', payoutPaise: 3500, payment: { method: 'cod', collectPaise: 16000 } });
        expect(assigned.body.data.otp).toBeUndefined();

        // A second assignment for the same order is refused.
        const twice = await api().post(`${A}/riders/tasks`).set(as(admin)).send({ kind: 'order_delivery', refId: orderId, riderId: rider._id });
        expect(twice.status).toBe(409);

        const offers = await api().get('/api/v1/rider/tasks').set(as(r));
        expect(offers.body.data.items).toHaveLength(1);
        const task = offers.body.data.items[0];
        expect(task).toMatchObject({ kind: 'order_delivery', requiresOtp: true, drop: { name: 'Asha', lat: 18.507, lng: 73.807 } });

        // The customer sees nothing until the partner accepts, then the partner and the code.
        expect((await api().get(`/api/v1/orders/${orderId}`).set(as(customer))).body.data.delivery).toBeNull();
        await api().post(`/api/v1/rider/tasks/${task._id}/accept`).set(as(r)).expect(200);
        const seen = (await api().get(`/api/v1/orders/${orderId}`).set(as(customer))).body.data.delivery;
        expect(seen).toMatchObject({ status: 'accepted', rider: { name: 'Suresh' } });
        expect(seen.otp).toMatch(/^\d{4}$/);

        // Can't go offline mid-task.
        expect((await api().post('/api/v1/rider/shift').set(as(r)).send({ online: false })).status).toBe(409);

        await api().post(`/api/v1/rider/tasks/${task._id}/picked-up`).set(as(r)).send({}).expect(200);
        expect((await Order.findById(orderId).lean()).status).toBe('dispatched');

        // Too far from the customer to say "arrived".
        const far = await api().post(`/api/v1/rider/tasks/${task._id}/arrived`).set(as(r)).send({ lat: 18.6, lng: 73.9 });
        expect(far.status).toBe(400);
        await api().post(`/api/v1/rider/tasks/${task._id}/arrived`).set(as(r)).send({ lat: 18.5071, lng: 73.8071 }).expect(200);

        const wrongCode = await api().post(`/api/v1/rider/tasks/${task._id}/complete`).set(as(r)).send({ otp: '0000', collectedPaise: 16000 });
        expect(wrongCode.status).toBe(400);
        const shortCash = await api().post(`/api/v1/rider/tasks/${task._id}/complete`).set(as(r)).send({ otp: seen.otp, collectedPaise: 10000 });
        expect(shortCash.status).toBe(400);
        expect(shortCash.body.message).toMatch(/Collect ₹160/);

        const done = await api().post(`/api/v1/rider/tasks/${task._id}/complete`).set(as(r)).send({ otp: seen.otp, collectedPaise: 16000, collectionMode: 'cash' });
        expect(done.status, JSON.stringify(done.body)).toBe(200);
        expect(done.body.data).toMatchObject({ status: 'completed', collected: { paise: 16000, mode: 'cash' } });
        const order = await Order.findById(orderId).lean();
        expect(order.status).toBe('delivered');
        expect(order.payment.status).toBe('paid');
        expect(order.statusHistory.at(-1).by.kind).toBe('rider');

        const today = new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
        const earnings = await api().get(`/api/v1/rider/earnings?from=${today}&to=${today}`).set(as(r));
        expect(earnings.body.data).toMatchObject({ totalPaise: 3500, deliveries: 1 });

        // Cash: deposit, admin confirms, hand balance clears.
        expect((await api().get('/api/v1/rider/cash').set(as(r))).body.data.inHandPaise).toBe(16000);
        const tooMuch = await api().post('/api/v1/rider/cash/deposit').set(as(r)).send({ amountPaise: 20000, mode: 'upi' });
        expect(tooMuch.status).toBe(400);
        const deposit = await api().post('/api/v1/rider/cash/deposit').set(as(r)).send({ amountPaise: 16000, mode: 'upi', reference: 'UPI123' });
        expect(deposit.status).toBe(201);
        const pending = await api().get(`${A}/riders/deposits?status=pending`).set(as(admin));
        expect(pending.body.data.items[0]).toMatchObject({ amountPaise: 16000, rider: { name: 'Suresh' } });
        await api().post(`${A}/riders/deposits/${deposit.body.data._id}/confirm`).set(as(admin)).expect(200);
        expect((await api().get('/api/v1/rider/cash').set(as(r))).body.data.inHandPaise).toBe(0);

        const list = await api().get(`${A}/riders`).set(as(admin));
        expect(list.body.data.items[0]).toMatchObject({ name: 'Suresh', isOnline: true, activeTasks: 0, cashInHandPaise: 0 });
    });

    it("won't let the partner pick up before the store has packed", async () => {
        const rider = await Rider.findOne({ phone: RIDER_PHONE }).lean();
        const { accessToken: r } = await loginRider();
        // A fresh order, only accepted.
        await api().put('/api/v1/cart/items').set(as(customer)).send({
            productId: (await Order.findById(orderId).lean()).items[0].product, variantId: (await Order.findById(orderId).lean()).items[0].variant, qty: 1
        }).expect(200);
        const res = await api().post('/api/v1/checkout').set(as(customer)).send({ module: 'grocery', addressId: customer.addressId, paymentMethod: 'cod' });
        const early = res.body.data.order._id;
        await api().post(`${A}/orders/${early}/status`).set(as(admin)).send({ status: 'accepted' }).expect(200);

        const task = (await api().post(`${A}/riders/tasks`).set(as(admin)).send({ kind: 'order_delivery', refId: early, riderId: rider._id })).body.data;
        await api().post(`/api/v1/rider/tasks/${task._id}/accept`).set(as(r)).expect(200);
        const pick = await api().post(`/api/v1/rider/tasks/${task._id}/picked-up`).set(as(r)).send({});
        expect(pick.status).toBe(409);
        expect(pick.body.message).toMatch(/hasn't packed/);
    });
});

describe('offers and cancellations', () => {
    it('lets the partner decline, expires stale offers, and stands down when the order is cancelled', async () => {
        const rider = await Rider.findOne({ phone: RIDER_PHONE }).lean();
        const { accessToken: r } = await loginRider();
        const assign = () => api().post(`${A}/riders/tasks`).set(as(admin)).send({ kind: 'order_delivery', refId: orderId, riderId: rider._id });

        const first = (await assign()).body.data;
        await api().post(`/api/v1/rider/tasks/${first._id}/reject`).set(as(r)).send({ reason: 'Bike punctured' }).expect(200);

        const second = (await assign()).body.data;
        await DeliveryTask.updateOne({ _id: second._id }, { offerExpiresAt: new Date(Date.now() - 1000) });
        const late = await api().post(`/api/v1/rider/tasks/${second._id}/accept`).set(as(r));
        expect(late.status).toBe(409);
        expect((await DeliveryTask.findById(second._id).lean()).status).toBe('expired');

        const third = (await assign()).body.data;
        await api().post(`/api/v1/rider/tasks/${third._id}/accept`).set(as(r)).expect(200);
        await api().post(`${A}/orders/${orderId}/cancel`).set(as(admin)).send({ reason: 'Customer asked to cancel' }).expect(200);
        await expect.poll(async () => (await DeliveryTask.findById(third._id).lean()).status).toBe('cancelled');

        const history = await api().get(`${A}/riders/tasks?refId=${orderId}&status=all`).set(as(admin));
        expect(history.body.data.items.map((t) => t.status).sort()).toEqual(['cancelled', 'expired', 'rejected']);
    });

    it('keeps assignments within the shops a partner and an ops user handle', async () => {
        await Rider.updateOne({ phone: RIDER_PHONE }, { modules: ['laundry'] });
        const rider = await Rider.findOne({ phone: RIDER_PHONE }).lean();
        const res = await api().post(`${A}/riders/tasks`).set(as(admin)).send({ kind: 'order_delivery', refId: orderId, riderId: rider._id });
        expect(res.status).toBe(409);
        expect(res.body.message).toMatch(/doesn't deliver for this shop/);

        const ops = (await loginStaff(await createStaff({ role: 'ops', isSuperAdmin: false, modules: ['electronics'], permissions: { orders: ['view', 'update'] } }))).token;
        await Rider.updateOne({ phone: RIDER_PHONE }, { modules: [] });
        const blocked = await api().post(`${A}/riders/tasks`).set(as(ops)).send({ kind: 'order_delivery', refId: orderId, riderId: rider._id });
        expect(blocked.status).toBe(403);
    });
});
