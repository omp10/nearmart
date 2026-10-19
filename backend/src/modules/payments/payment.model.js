import mongoose from 'mongoose';

/**
 * One online payment attempt. It points at whatever is being paid for
 * (`refType`/`refId`: an order, or a laundry booking) instead of embedding
 * gateway fields in those documents, so the gateway code serves every module.
 *
 * Amounts are integer paise, the unit Razorpay uses, so no float rounding
 * sits between what we charge and what the gateway reports.
 */
const paymentSchema = new mongoose.Schema(
    {
        userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
        refType: { type: String, enum: ['order', 'booking'], required: true },
        refId: { type: mongoose.Schema.Types.ObjectId, required: true },
        amountPaise: { type: Number, required: true, min: 100, validate: Number.isInteger },
        currency: { type: String, default: 'INR' },
        gateway: { type: String, enum: ['razorpay'], default: 'razorpay' },
        gatewayOrderId: { type: String, required: true, unique: true },
        gatewayPaymentId: { type: String, default: null },
        status: {
            type: String,
            enum: ['created', 'paid', 'failed', 'refunded', 'partially_refunded'],
            default: 'created',
            index: true
        },
        refundedPaise: { type: Number, default: 0 },
        failureReason: { type: String, default: '' },
        paidAt: { type: Date, default: null }
    },
    { collection: 'payments', timestamps: true }
);

paymentSchema.index({ refType: 1, refId: 1, createdAt: -1 });
paymentSchema.index({ gatewayPaymentId: 1 }, { sparse: true });

export const Payment = mongoose.model('Payment', paymentSchema);

/** Razorpay retries webhooks; each event id is processed once. */
const webhookEventSchema = new mongoose.Schema(
    {
        eventId: { type: String, required: true, unique: true },
        event: { type: String, required: true }
    },
    { collection: 'webhook_events', timestamps: true }
);
webhookEventSchema.index({ createdAt: 1 }, { expireAfterSeconds: 30 * 24 * 60 * 60 });

export const WebhookEvent = mongoose.model('WebhookEvent', webhookEventSchema);
