import express, { Router } from 'express';
import { z } from 'zod';
import { logger } from '../../lib/logger.js';
import { ok } from '../../lib/response.js';
import { validate } from '../../lib/validate.js';
import { authenticate, requireCustomer } from '../../middleware/auth.js';
import { handleWebhookEvent, verifyClientPayment, verifyWebhookSignature } from './payment.service.js';

/**
 * Mounted before the global JSON parser: the signature is computed over the
 * exact bytes Razorpay sent, so this route needs the raw body.
 */
export const webhookRouter = Router();

webhookRouter.post('/razorpay', express.raw({ type: '*/*', limit: '1mb' }), async (req, res) => {
    const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    if (!(await verifyWebhookSignature(rawBody, req.get('x-razorpay-signature')))) {
        logger.warn('Razorpay webhook rejected: bad signature');
        return res.status(400).json({ success: false, message: 'Invalid signature' });
    }

    let body;
    try {
        body = JSON.parse(rawBody.toString('utf8'));
    } catch {
        return res.status(400).json({ success: false, message: 'Malformed body' });
    }

    await handleWebhookEvent(req.get('x-razorpay-event-id'), body);
    return res.json({ success: true });
});

const router = Router();

router.post(
    '/razorpay/verify',
    authenticate,
    requireCustomer,
    validate(
        z.object({
            razorpay_order_id: z.string().min(1),
            razorpay_payment_id: z.string().min(1),
            razorpay_signature: z.string().regex(/^[a-f0-9]{64}$/i, 'Invalid signature')
        })
    ),
    async (req, res) => {
        const payment = await verifyClientPayment({
            userId: req.auth.id,
            gatewayOrderId: req.body.razorpay_order_id,
            gatewayPaymentId: req.body.razorpay_payment_id,
            signature: req.body.razorpay_signature
        });
        ok(res, { paymentId: String(payment._id), status: payment.status }, 'Payment verified');
    }
);

export default router;
