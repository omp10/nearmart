import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import Razorpay from 'razorpay';
import { env } from '../../config/env.js';
import { logger } from '../../lib/logger.js';
import { AppError, NotFoundError, ValidationError } from '../../lib/errors.js';
import { Payment, WebhookEvent } from './payment.model.js';

/**
 * Emits `paid`, `failed` and `refunded` with the Payment document. The order
 * and booking modules subscribe to these to move their own status, so this
 * module never needs to know their schemas.
 */
export const paymentEvents = new EventEmitter();

let client = null;
const razorpay = () => {
    if (!env.razorpayEnabled) throw new AppError('Online payments are not configured', 503);
    client ??= new Razorpay({ key_id: env.RAZORPAY_KEY_ID, key_secret: env.RAZORPAY_KEY_SECRET });
    return client;
};

/** Constant-time comparison of two hex HMACs. */
const safeEqualHex = (a, b) => {
    const left = Buffer.from(String(a), 'hex');
    const right = Buffer.from(String(b), 'hex');
    return left.length > 0 && left.length === right.length && crypto.timingSafeEqual(left, right);
};

const hmacHex = (secret, payload) => crypto.createHmac('sha256', secret).update(payload).digest('hex');

/**
 * Opens a gateway order for something the server has already priced.
 * Callers pass the server-computed amount, never a client-supplied one.
 *
 * @returns what the app passes to Razorpay Checkout
 */
export const createGatewayPayment = async ({ userId, refType, refId, amountPaise }) => {
    if (!Number.isInteger(amountPaise) || amountPaise < 100) {
        throw new ValidationError('Amount must be at least ₹1');
    }
    const order = await razorpay().orders.create({
        amount: amountPaise,
        currency: 'INR',
        receipt: `${refType}_${refId}`.slice(0, 40),
        notes: { refType, refId: String(refId) }
    });
    const payment = await Payment.create({ userId, refType, refId, amountPaise, gatewayOrderId: order.id });
    return {
        paymentId: String(payment._id),
        keyId: env.RAZORPAY_KEY_ID,
        gatewayOrderId: order.id,
        amountPaise,
        currency: 'INR'
    };
};

/**
 * Atomically moves a payment to `paid`. Returns null when it was already paid
 * (or isn't payable), so the `paid` event fires exactly once however many of
 * webhook, client verify and retries arrive.
 */
const markPaid = async (filter, gatewayPaymentId) => {
    const payment = await Payment.findOneAndUpdate(
        { ...filter, status: { $in: ['created', 'failed'] } },
        { $set: { status: 'paid', gatewayPaymentId, paidAt: new Date(), failureReason: '' } },
        { new: true }
    );
    if (payment) paymentEvents.emit('paid', payment);
    return payment;
};

/**
 * Called by the app after Razorpay Checkout succeeds. The signature proves
 * the ids came from Razorpay; the payment is then fetched to confirm the
 * amount, because the signature says nothing about how much was paid.
 */
export const verifyClientPayment = async ({ userId, gatewayOrderId, gatewayPaymentId, signature }) => {
    const expected = hmacHex(env.RAZORPAY_KEY_SECRET || '', `${gatewayOrderId}|${gatewayPaymentId}`);
    if (!safeEqualHex(expected, signature)) throw new ValidationError('Payment signature is invalid');

    const payment = await Payment.findOne({ gatewayOrderId, userId });
    if (!payment) throw new NotFoundError('Payment not found');
    if (payment.status === 'paid') return payment;

    const remote = await razorpay().payments.fetch(gatewayPaymentId);
    if (remote.order_id !== gatewayOrderId || Number(remote.amount) !== payment.amountPaise) {
        logger.error({ gatewayOrderId, gatewayPaymentId, paid: remote.amount }, 'Payment amount/order mismatch');
        throw new ValidationError('Payment does not match this order');
    }
    if (!['captured', 'authorized'].includes(remote.status)) {
        throw new ValidationError(`Payment is ${remote.status}`);
    }

    return (await markPaid({ _id: payment._id }, gatewayPaymentId)) || Payment.findById(payment._id);
};

export const verifyWebhookSignature = (rawBody, signature) => {
    if (!env.RAZORPAY_WEBHOOK_SECRET || !rawBody || !signature) return false;
    return safeEqualHex(hmacHex(env.RAZORPAY_WEBHOOK_SECRET, rawBody), signature);
};

/**
 * Applies one verified Razorpay webhook. Unknown events are acknowledged and
 * ignored so Razorpay stops retrying them.
 */
export const handleWebhookEvent = async (eventId, body) => {
    if (eventId) {
        try {
            await WebhookEvent.create({ eventId, event: body.event });
        } catch (err) {
            if (err?.code === 11000) return { duplicate: true };
            throw err;
        }
    }

    try {
        await applyWebhookEvent(body);
    } catch (err) {
        // Release the id so Razorpay's retry is processed rather than skipped as a duplicate.
        if (eventId) await WebhookEvent.deleteOne({ eventId });
        throw err;
    }
    return { duplicate: false };
};

const applyWebhookEvent = async (body) => {
    const entity = body.payload?.payment?.entity;

    switch (body.event) {
        case 'payment.captured':
        case 'order.paid': {
            const payment = await Payment.findOne({ gatewayOrderId: entity?.order_id }).lean();
            if (!payment) {
                logger.warn({ orderId: entity?.order_id }, 'Webhook for unknown gateway order');
                break;
            }
            if (Number(entity.amount) !== payment.amountPaise) {
                logger.error(
                    { orderId: entity.order_id, paid: entity.amount, expected: payment.amountPaise },
                    'Webhook amount mismatch; payment not marked paid'
                );
                break;
            }
            await markPaid({ _id: payment._id }, entity.id);
            break;
        }
        case 'payment.failed': {
            const payment = await Payment.findOneAndUpdate(
                { gatewayOrderId: entity?.order_id, status: 'created' },
                { $set: { status: 'failed', gatewayPaymentId: entity?.id, failureReason: entity?.error_description || '' } },
                { new: true }
            );
            if (payment) paymentEvents.emit('failed', payment);
            break;
        }
        case 'refund.processed': {
            const refund = body.payload?.refund?.entity;
            const payment = await Payment.findOne({ gatewayPaymentId: refund?.payment_id });
            if (!payment) break;
            payment.refundedPaise = Math.min(payment.amountPaise, payment.refundedPaise + Number(refund.amount || 0));
            payment.status = payment.refundedPaise >= payment.amountPaise ? 'refunded' : 'partially_refunded';
            await payment.save();
            paymentEvents.emit('refunded', payment);
            break;
        }
        default:
            break;
    }
};
