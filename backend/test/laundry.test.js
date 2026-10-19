import crypto from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, createStaff, loginCustomer, loginStaff } from './helpers.js';
import { LaundryBooking } from '../src/modules/laundry/booking.model.js';
import { gateway } from '../src/modules/payments/payment.service.js';
import { SlotReservation, SlotRule } from '../src/modules/slots/slot.model.js';
import { Zone } from '../src/modules/zones/zone.model.js';

const realGateway = { ...gateway };
const A = '/api/v1/admin/laundry';
const C = '/api/v1/laundry';
const as = (t) => ({ Authorization: `Bearer ${t}` });

let admin;
let customer;
let addressId;
let washFold;
let dryClean;

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

const payViaWebhook = (gatewayOrderId, amount) => {
    const raw = JSON.stringify({ event: 'payment.captured', payload: { payment: { entity: { id: `pay_${gatewayOrderId}`, order_id: gatewayOrderId, amount } } } });
    return api()
        .post('/api/v1/payments/webhook/razorpay')
        .set('Content-Type', 'application/json')
        .set('x-razorpay-signature', crypto.createHmac('sha256', process.env.RAZORPAY_WEBHOOK_SECRET).update(raw).digest('hex'))
        .set('x-razorpay-event-id', crypto.randomUUID())
        .send(raw)
        .expect(200);
};

const firstSlot = async (kind) => {
    const res = await api().get(`/api/v1/slots?module=laundry&kind=${kind}&pincode=411038&days=3`);
    return res.body.data.days.flatMap((d) => d.slots).find((s) => s.available).id;
};

const book = async (items, extra = {}) =>
    api().post(`${C}/bookings`).set(as(customer)).send({ addressId, items, pickupSlotId: await firstSlot('pickup'), paymentMethod: 'cod', ...extra });

const move = (id, status) => api().post(`${A}/bookings/${id}/status`).set(as(admin)).send({ status });
const weigh = (booking, qtys) =>
    api().post(`${A}/bookings/${booking._id}/weigh`).set(as(admin)).send({ lines: booking.items.map((l, i) => ({ lineId: l._id, finalQty: qtys[i] })) });

beforeEach(async () => {
    Object.assign(gateway, {
        createOrder: vi.fn(async () => ({ id: `order_${crypto.randomBytes(4).toString('hex')}` })),
        fetchPayment: vi.fn(),
        refund: vi.fn(async (_id, { amount }) => ({ id: `rfnd_${amount}` }))
    });
    admin = (await loginStaff(await createStaff())).token;
    await Zone.create({ name: 'Kothrud', modules: ['laundry'], pincodes: ['411038'], deliveryFeePaise: 4000, freeDeliveryAbovePaise: 50000 });
    const everyDay = [0, 1, 2, 3, 4, 5, 6];
    await SlotRule.create({ module: 'laundry', kind: 'pickup', daysOfWeek: everyDay, start: '23:00', end: '23:59', capacity: 5, cutoffMinutes: 0 });
    await SlotRule.create({ module: 'laundry', kind: 'return', daysOfWeek: everyDay, start: '23:00', end: '23:59', capacity: 5, cutoffMinutes: 0 });

    const svc = async (body) => (await api().post(`${A}/services`).set(as(admin)).send(body).expect(201)).body.data;
    washFold = await svc({ name: 'Wash & Fold', pricingUnit: 'kg', ratePaise: 8000, minQty: 3, turnaroundHours: 48 });
    dryClean = await svc({ name: 'Dry Cleaning', pricingUnit: 'piece', ratePaise: 15000, minQty: 1, turnaroundHours: 72 });

    customer = (await loginCustomer()).accessToken;
    const address = await api().post('/api/v1/me/addresses').set(as(customer))
        .send({ line1: '12 Paud Road', city: 'Pune', state: 'Maharashtra', pincode: '411038' });
    addressId = address.body.data._id;
});

afterEach(() => Object.assign(gateway, realGateway));

describe('service catalogue', () => {
    it('lists active services publicly and validates edits', async () => {
        await api().patch(`${A}/services/${dryClean._id}`).set(as(admin)).send({ isActive: false }).expect(200);
        const list = await api().get(`${C}/services`);
        expect(list.body.data.map((s) => [s.name, s.pricingUnit, s.ratePaise, s.minQty])).toEqual([['Wash & Fold', 'kg', 8000, 3]]);
        expect((await api().post(`${A}/services`).set(as(admin)).send({ name: 'X', pricingUnit: 'kg', ratePaise: 99.5 })).status).toBe(400);
    });
});

describe('quotes', () => {
    it('bills at least the minimum and waives the fee above the threshold', async () => {
        const small = await api().post(`${C}/bookings/quote`).set(as(customer))
            .send({ addressId, items: [{ serviceId: washFold._id, estimatedQty: 2 }] });
        expect(small.body.data.pricing).toMatchObject({ estimatePaise: 24000, deliveryFeePaise: 4000, totalPaise: 28000 });

        const big = await api().post(`${C}/bookings/quote`).set(as(customer))
            .send({ addressId, items: [{ serviceId: washFold._id, estimatedQty: 2 }, { serviceId: dryClean._id, estimatedQty: 2 }] });
        expect(big.body.data.pricing).toMatchObject({ estimatePaise: 54000, deliveryFeePaise: 0, totalPaise: 54000 });

        const dup = await api().post(`${C}/bookings/quote`).set(as(customer))
            .send({ addressId, items: [{ serviceId: washFold._id, estimatedQty: 2 }, { serviceId: washFold._id, estimatedQty: 1 }] });
        expect(dup.status).toBe(400);
    });
});

describe('booking lifecycle (cash)', () => {
    it('books a pickup, weighs, returns and collects the final amount', async () => {
        const res = await book([{ serviceId: washFold._id, estimatedQty: 4 }], { instructions: 'No bleach', pickupNotes: 'Gate 2' });
        expect(res.status, JSON.stringify(res.body)).toBe(201);
        const booking = res.body.data.booking;
        expect(booking).toMatchObject({ status: 'placed', pricing: { estimatePaise: 32000, deliveryFeePaise: 4000, totalPaise: 36000 } });
        expect(booking.bookingNumber).toMatch(/^NL\d{6}[0-9A-F]{6}$/);
        expect((await SlotReservation.findOne().lean()).count).toBe(1);

        expect((await move(booking._id, 'processing')).status).toBe(409);
        await move(booking._id, 'pickup_scheduled').expect(200);
        expect((await weigh(booking, [5])).status).toBe(409); // not picked up yet
        await move(booking._id, 'picked_up').expect(200);
        expect((await move(booking._id, 'weighed')).status).toBe(400);

        const missing = await api().post(`${A}/bookings/${booking._id}/weigh`).set(as(admin)).send({ lines: [] });
        expect(missing.status).toBe(400);

        const weighed = await weigh(booking, [5.5]);
        expect(weighed.status, JSON.stringify(weighed.body)).toBe(200);
        expect(weighed.body.data).toMatchObject({
            status: 'weighed',
            items: [{ finalQty: 5.5, finalPaise: 44000 }],
            pricing: { finalPaise: 48000, totalPaise: 48000 },
            payment: { balanceDuePaise: 48000 }
        });

        // Customer picks the return slot.
        const slotId = await firstSlot('return');
        const ret = await api().post(`${C}/bookings/${booking._id}/return-slot`).set(as(customer)).send({ slotId });
        expect(ret.body.data.returnSlot.id).toBe(slotId);

        for (const s of ['processing', 'ready', 'out_for_return']) await move(booking._id, s).expect(200);
        const done = await move(booking._id, 'completed');
        expect(done.body.data).toMatchObject({ status: 'completed', payment: { status: 'paid', balanceDuePaise: 0 } });
        expect(done.body.data.statusHistory.at(-1).note).toMatch(/Collected ₹480/);
    });

    it('requires a valid pickup slot and lets the customer cancel before pickup', async () => {
        const noSlot = await api().post(`${C}/bookings`).set(as(customer)).send({ addressId, items: [{ serviceId: washFold._id, estimatedQty: 3 }], paymentMethod: 'cod' });
        expect(noSlot.status).toBe(400);
        const wrongKind = await api().post(`${C}/bookings`).set(as(customer))
            .send({ addressId, items: [{ serviceId: washFold._id, estimatedQty: 3 }], pickupSlotId: await firstSlot('return'), paymentMethod: 'cod' });
        expect(wrongKind.status).toBe(400);

        const { booking } = (await book([{ serviceId: washFold._id, estimatedQty: 3 }])).body.data;
        await api().post(`${C}/bookings/${booking._id}/cancel`).set(as(customer)).send({}).expect(200);
        expect((await SlotReservation.findOne().lean()).count).toBe(0);

        const second = (await book([{ serviceId: washFold._id, estimatedQty: 3 }])).body.data.booking;
        await move(second._id, 'pickup_scheduled');
        await move(second._id, 'picked_up');
        expect((await api().post(`${C}/bookings/${second._id}/cancel`).set(as(customer)).send({})).status).toBe(409);
    });
});

describe('prepaid bookings', () => {
    const prepaid = async (estimatedQty) => {
        const { booking, payment } = (await book([{ serviceId: washFold._id, estimatedQty }], { paymentMethod: 'online' })).body.data;
        expect(booking.status).toBe('pending_payment');
        await payViaWebhook(payment.gatewayOrderId, payment.amountPaise);
        await eventually(async () => expect((await LaundryBooking.findById(booking._id).lean()).status).toBe('placed'));
        await move(booking._id, 'pickup_scheduled');
        await move(booking._id, 'picked_up');
        return { booking, payment };
    };

    it('refunds the difference when the weight is below the estimate', async () => {
        const { booking, payment } = await prepaid(5); // 40000 + 4000 fee
        const res = await weigh(booking, [3.2]); // 25600 + 4000
        expect(res.body.data.pricing.finalPaise).toBe(29600);
        expect(gateway.refund).toHaveBeenCalledWith(`pay_${payment.gatewayOrderId}`, expect.objectContaining({ amount: 14400 }));
        expect(res.body.data.payment).toMatchObject({ balanceDuePaise: 0, refundPendingPaise: 14400, status: 'refund_pending' });
    });

    it('collects the balance at return when the weight is above the estimate', async () => {
        const { booking } = await prepaid(3); // 24000 + 4000
        const res = await weigh(booking, [4]); // 32000 + 4000
        expect(res.body.data.payment).toMatchObject({ paidPaise: 28000, balanceDuePaise: 8000 });
        expect(gateway.refund).not.toHaveBeenCalled();
    });

    it('refunds everything when cancelled before pickup', async () => {
        const { booking, payment } = (await book([{ serviceId: washFold._id, estimatedQty: 3 }], { paymentMethod: 'online' })).body.data;
        await payViaWebhook(payment.gatewayOrderId, payment.amountPaise);
        await eventually(async () => expect((await LaundryBooking.findById(booking._id).lean()).status).toBe('placed'));
        await api().post(`${A}/bookings/${booking._id}/cancel`).set(as(admin)).send({ reason: 'No riders' }).expect(200);
        expect(gateway.refund).toHaveBeenCalledWith(`pay_${payment.gatewayOrderId}`, expect.objectContaining({ amount: 28000 }));
    });
});

describe('access', () => {
    it('keeps bookings away from ops users without laundry', async () => {
        const ops = await createStaff({ role: 'ops', isSuperAdmin: false, modules: ['grocery'], permissions: { bookings: ['view'], catalog: ['view'] } });
        const token = (await loginStaff(ops)).token;
        expect((await api().get(`${A}/bookings`).set(as(token))).status).toBe(403);
        expect((await api().get(`${A}/services`).set(as(token))).status).toBe(403);
    });

    it('hides other customers’ bookings', async () => {
        const { booking } = (await book([{ serviceId: washFold._id, estimatedQty: 3 }])).body.data;
        const other = (await loginCustomer('9123456780')).accessToken;
        expect((await api().get(`${C}/bookings/${booking._id}`).set(as(other))).status).toBe(404);
    });
});
