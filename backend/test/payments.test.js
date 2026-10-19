import crypto from 'node:crypto';
import mongoose from 'mongoose';
import { describe, expect, it, vi } from 'vitest';
import { api, loginCustomer } from './helpers.js';
import { Payment } from '../src/modules/payments/payment.model.js';
import { paymentEvents } from '../src/modules/payments/payment.service.js';

const WEBHOOK_SECRET = process.env.RAZORPAY_WEBHOOK_SECRET;

const sendWebhook = (body, { secret = WEBHOOK_SECRET, eventId = crypto.randomUUID() } = {}) => {
    const raw = JSON.stringify(body);
    const signature = crypto.createHmac('sha256', secret).update(raw).digest('hex');
    return api()
        .post('/api/v1/payments/webhook/razorpay')
        .set('Content-Type', 'application/json')
        .set('x-razorpay-signature', signature)
        .set('x-razorpay-event-id', eventId)
        .send(raw);
};

const capturedEvent = (orderId, amount) => ({
    event: 'payment.captured',
    payload: { payment: { entity: { id: 'pay_123', order_id: orderId, amount, status: 'captured' } } }
});

const seedPayment = (amountPaise = 49900) =>
    Payment.create({
        userId: new mongoose.Types.ObjectId(),
        refType: 'order',
        refId: new mongoose.Types.ObjectId(),
        amountPaise,
        gatewayOrderId: `order_${crypto.randomBytes(6).toString('hex')}`
    });

describe('Razorpay webhook', () => {
    it('rejects a bad signature', async () => {
        const payment = await seedPayment();
        const res = await sendWebhook(capturedEvent(payment.gatewayOrderId, 49900), { secret: 'wrong' });
        expect(res.status).toBe(400);
        expect((await Payment.findById(payment._id)).status).toBe('created');
    });

    it('marks the payment paid and emits `paid` exactly once across retries', async () => {
        const payment = await seedPayment();
        const listener = vi.fn();
        paymentEvents.on('paid', listener);

        const eventId = 'evt_same';
        await sendWebhook(capturedEvent(payment.gatewayOrderId, 49900), { eventId }).expect(200);
        await sendWebhook(capturedEvent(payment.gatewayOrderId, 49900), { eventId }).expect(200);
        // A different event for the same payment (e.g. order.paid) must not double-fire either.
        await sendWebhook({ ...capturedEvent(payment.gatewayOrderId, 49900), event: 'order.paid' }).expect(200);

        paymentEvents.off('paid', listener);
        const stored = await Payment.findById(payment._id);
        expect(stored.status).toBe('paid');
        expect(stored.gatewayPaymentId).toBe('pay_123');
        expect(listener).toHaveBeenCalledTimes(1);
    });

    it('does not mark paid when the captured amount differs', async () => {
        const payment = await seedPayment(49900);
        await sendWebhook(capturedEvent(payment.gatewayOrderId, 100)).expect(200);
        expect((await Payment.findById(payment._id)).status).toBe('created');
    });

    it('records partial and full refunds', async () => {
        const payment = await seedPayment(50000);
        await sendWebhook(capturedEvent(payment.gatewayOrderId, 50000)).expect(200);

        const refund = (amount) => ({
            event: 'refund.processed',
            payload: { refund: { entity: { id: `rfnd_${amount}`, payment_id: 'pay_123', amount } } }
        });
        await sendWebhook(refund(20000)).expect(200);
        expect((await Payment.findById(payment._id)).status).toBe('partially_refunded');
        await sendWebhook(refund(30000)).expect(200);
        const stored = await Payment.findById(payment._id);
        expect(stored.status).toBe('refunded');
        expect(stored.refundedPaise).toBe(50000);
    });
});

describe('client payment verify', () => {
    it('rejects a forged signature before calling Razorpay', async () => {
        const session = await loginCustomer();
        const res = await api()
            .post('/api/v1/payments/razorpay/verify')
            .set('Authorization', `Bearer ${session.accessToken}`)
            .send({ razorpay_order_id: 'order_x', razorpay_payment_id: 'pay_x', razorpay_signature: 'a'.repeat(64) });
        expect(res.status).toBe(400);
        expect(res.body.message).toMatch(/signature/i);
    });
});
