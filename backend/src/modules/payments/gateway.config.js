import mongoose from 'mongoose';
import { env } from '../../config/env.js';
import { ValidationError } from '../../lib/errors.js';
import { decryptSecret, encryptSecret, secretsKeyConfigured } from '../../lib/secretBox.js';

/**
 * Razorpay credentials. Admins can set them from the panel (Global →
 * Settings); until they do, the RAZORPAY_* environment variables apply.
 * Secrets are stored encrypted and never leave the server: the panel only
 * sees whether each is set and its last four characters.
 */
const gatewaySchema = new mongoose.Schema(
    {
        key: { type: String, default: 'razorpay', unique: true },
        keyId: { type: String, trim: true, default: '' },
        keySecret: { type: String, default: '' },
        webhookSecret: { type: String, default: '' },
        updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Staff', default: null }
    },
    { collection: 'payment_gateway', timestamps: true }
);

export const PaymentGateway = mongoose.model('PaymentGateway', gatewaySchema);

let cached = null;

/**
 * The credentials in effect: the panel's when it has a key pair, else the
 * environment's. Cached in memory and refreshed whenever an admin saves; the
 * API runs as a single process (see deploy/DEPLOY.md).
 */
export const gatewayConfig = async () => {
    if (cached) return cached;
    const saved = await PaymentGateway.findOne({ key: 'razorpay' }).lean();
    if (saved?.keyId && saved.keySecret) {
        cached = {
            source: 'panel',
            keyId: saved.keyId,
            keySecret: decryptSecret(saved.keySecret),
            webhookSecret: saved.webhookSecret ? decryptSecret(saved.webhookSecret) : '',
            updatedAt: saved.updatedAt
        };
    } else {
        cached = {
            source: env.RAZORPAY_KEY_ID ? 'environment' : 'none',
            keyId: env.RAZORPAY_KEY_ID ?? '',
            keySecret: env.RAZORPAY_KEY_SECRET ?? '',
            webhookSecret: env.RAZORPAY_WEBHOOK_SECRET ?? ''
        };
    }
    cached.enabled = Boolean(cached.keyId && cached.keySecret);
    return cached;
};

const hint = (secret) => (secret ? { set: true, last4: secret.slice(-4) } : { set: false, last4: '' });

/** What the panel may see: never the secrets themselves. */
export const describeGateway = async () => {
    const c = await gatewayConfig();
    return {
        source: c.source,
        enabled: c.enabled,
        mode: c.keyId.startsWith('rzp_live_') ? 'live' : c.keyId ? 'test' : null,
        keyId: c.keyId,
        keySecret: hint(c.keySecret),
        webhookSecret: hint(c.webhookSecret),
        canSave: secretsKeyConfigured(),
        updatedAt: c.updatedAt ?? null
    };
};

/**
 * Saves panel credentials. Leaving a secret out keeps the saved one, so the
 * admin can change the key id or rotate one secret without retyping the other.
 */
export const saveGateway = async ({ keyId, keySecret, webhookSecret }, staffId) => {
    if (!secretsKeyConfigured()) {
        throw new ValidationError('The server needs SECRETS_KEY set before payment keys can be saved from the panel');
    }
    const saved = await PaymentGateway.findOne({ key: 'razorpay' }).lean();
    if (!keySecret && !saved?.keySecret) throw new ValidationError('Enter the key secret');
    if (!webhookSecret && !saved?.webhookSecret) throw new ValidationError('Enter the webhook secret; without it no payment is ever confirmed');

    const set = { keyId, updatedBy: staffId };
    if (keySecret) set.keySecret = encryptSecret(keySecret);
    if (webhookSecret) set.webhookSecret = encryptSecret(webhookSecret);
    await PaymentGateway.updateOne({ key: 'razorpay' }, { $set: set }, { upsert: true });
    cached = null;
    return describeGateway();
};

/** Forgets the panel credentials; the environment's apply again. */
export const clearGateway = async () => {
    await PaymentGateway.deleteOne({ key: 'razorpay' });
    cached = null;
    return describeGateway();
};

/** Tests reset the database between cases; they call this so the cache follows. */
export const resetGatewayCache = () => {
    cached = null;
};
