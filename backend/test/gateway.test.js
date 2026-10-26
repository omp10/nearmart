import crypto from 'node:crypto';
import mongoose from 'mongoose';
import { describe, expect, it } from 'vitest';
import { api, createStaff, loginStaff } from './helpers.js';
import { PaymentGateway } from '../src/modules/payments/gateway.config.js';
import { Payment } from '../src/modules/payments/payment.model.js';

const as = (t) => ({ Authorization: `Bearer ${t}` });
const superAdmin = async () => (await loginStaff(await createStaff())).token;
const PANEL = { keyId: 'rzp_live_Panel123', keySecret: 'panel-key-secret-9876', webhookSecret: 'panel-webhook-secret-5432' };

const webhook = (secret, orderId) => {
    const raw = JSON.stringify({ event: 'payment.captured', payload: { payment: { entity: { id: 'pay_1', order_id: orderId, amount: 10000, status: 'captured' } } } });
    return api()
        .post('/api/v1/payments/webhook/razorpay')
        .set('Content-Type', 'application/json')
        .set('x-razorpay-signature', crypto.createHmac('sha256', secret).update(raw).digest('hex'))
        .set('x-razorpay-event-id', crypto.randomUUID())
        .send(raw);
};

const seedPayment = () =>
    Payment.create({
        userId: new mongoose.Types.ObjectId(),
        refType: 'order',
        refId: new mongoose.Types.ObjectId(),
        amountPaise: 10000,
        gatewayOrderId: `order_${crypto.randomBytes(6).toString('hex')}`
    });

describe('payment gateway settings', () => {
    it('starts on the environment keys and shows only hints of the secrets', async () => {
        const res = await api().get('/api/v1/admin/settings/payment-gateway').set(as(await superAdmin())).expect(200);
        expect(res.body.data).toMatchObject({
            source: 'environment',
            enabled: true,
            mode: 'test',
            keyId: 'rzp_test_dummy',
            keySecret: { set: true, last4: 'cret' },
            canSave: true
        });
        expect(JSON.stringify(res.body)).not.toContain(process.env.RAZORPAY_KEY_SECRET);
    });

    it('saves panel keys encrypted, uses them, and never returns them', async () => {
        const token = await superAdmin();
        const saved = await api().put('/api/v1/admin/settings/payment-gateway').set(as(token)).send(PANEL).expect(200);
        expect(saved.body.data).toMatchObject({
            source: 'panel',
            mode: 'live',
            keyId: PANEL.keyId,
            keySecret: { set: true, last4: '9876' },
            webhookSecret: { set: true, last4: '5432' }
        });
        expect(JSON.stringify(saved.body)).not.toContain(PANEL.keySecret);
        expect(JSON.stringify(saved.body)).not.toContain(PANEL.webhookSecret);

        // Encrypted at rest.
        const raw = await PaymentGateway.findOne().lean();
        expect(raw.keySecret).toMatch(/^v1:/);
        expect(raw.keySecret).not.toContain(PANEL.keySecret);
        expect(raw.webhookSecret).not.toContain(PANEL.webhookSecret);

        // Webhooks are now verified with the panel's secret, not the environment's.
        const payment = await seedPayment();
        await webhook(process.env.RAZORPAY_WEBHOOK_SECRET, payment.gatewayOrderId).expect(400);
        await webhook(PANEL.webhookSecret, payment.gatewayOrderId).expect(200);
        expect((await Payment.findById(payment._id)).status).toBe('paid');
    });

    it('keeps a saved secret when it is left blank, and can fall back to the environment', async () => {
        const token = await superAdmin();
        await api().put('/api/v1/admin/settings/payment-gateway').set(as(token)).send(PANEL).expect(200);
        const rotated = await api()
            .put('/api/v1/admin/settings/payment-gateway')
            .set(as(token))
            .send({ keyId: 'rzp_live_Other456', keySecret: '', webhookSecret: 'rotated-webhook-0001' })
            .expect(200);
        expect(rotated.body.data).toMatchObject({ keyId: 'rzp_live_Other456', keySecret: { last4: '9876' }, webhookSecret: { last4: '0001' } });

        const cleared = await api().delete('/api/v1/admin/settings/payment-gateway').set(as(token)).expect(200);
        expect(cleared.body.data).toMatchObject({ source: 'environment', keyId: 'rzp_test_dummy' });
    });

    it('validates input and needs both secrets the first time', async () => {
        const token = await superAdmin();
        const put = (body) => api().put('/api/v1/admin/settings/payment-gateway').set(as(token)).send(body);
        expect((await put({ ...PANEL, keyId: 'pk_live_stripe' })).status).toBe(400);
        expect((await put({ keyId: PANEL.keyId, keySecret: PANEL.keySecret })).body.message).toMatch(/webhook secret/);
        expect((await put({ keyId: PANEL.keyId, webhookSecret: PANEL.webhookSecret })).body.message).toMatch(/key secret/);
    });

    it('is for the super admin only', async () => {
        const admin = (await loginStaff(await createStaff({ isSuperAdmin: false, permissions: { settings: ['view', 'update'] } }))).token;
        const ops = (await loginStaff(await createStaff({ role: 'ops', isSuperAdmin: false, modules: ['grocery'], permissions: { settings: ['view', 'update'] } }))).token;
        for (const token of [admin, ops]) {
            expect((await api().get('/api/v1/admin/settings/payment-gateway').set(as(token))).status).toBe(403);
            expect((await api().put('/api/v1/admin/settings/payment-gateway').set(as(token)).send(PANEL)).status).toBe(403);
        }
        expect((await api().get('/api/v1/admin/settings/payment-gateway')).status).toBe(401);
    });
});
