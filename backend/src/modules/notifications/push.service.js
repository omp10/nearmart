import { readFileSync } from 'node:fs';
import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getMessaging } from 'firebase-admin/messaging';
import { env } from '../../config/env.js';
import { logger } from '../../lib/logger.js';
import { DeviceToken } from './deviceToken.model.js';

/**
 * Android ignores an unknown channel id and falls back to a silent default
 * channel, so this must match the channel the customer app creates.
 */
const ANDROID_CHANNEL_ID = 'high_importance_channel';

/** FCM errors that mean the token will never work again and should be dropped. */
const DEAD_TOKEN_CODES = new Set([
    'messaging/registration-token-not-registered',
    'messaging/invalid-registration-token',
    'messaging/invalid-argument'
]);

let messaging = null;

const loadServiceAccount = () => {
    const raw = env.FIREBASE_SERVICE_ACCOUNT || readFileSync(env.FIREBASE_SERVICE_ACCOUNT_PATH, 'utf8');
    const account = JSON.parse(raw);
    // Keys pasted into a .env usually arrive with literal "\n".
    if (account.private_key) account.private_key = account.private_key.replace(/\\n/g, '\n');
    return account;
};

const getClient = () => {
    if (!env.pushEnabled) return null;
    if (messaging) return messaging;
    try {
        const app = getApps()[0] || initializeApp({ credential: cert(loadServiceAccount()) });
        messaging = getMessaging(app);
        return messaging;
    } catch (err) {
        logger.error({ err: err.message }, 'Firebase init failed; push notifications are disabled');
        return null;
    }
};

/** FCM data values must be strings. */
const stringifyData = (data = {}) =>
    Object.fromEntries(
        Object.entries(data)
            .filter(([, v]) => v !== undefined && v !== null)
            .map(([k, v]) => [k, typeof v === 'string' ? v : JSON.stringify(v)])
    );

/**
 * Sends one notification to raw tokens and prunes the ones FCM reports dead.
 * @returns {Promise<{ successCount: number, failureCount: number }>}
 */
export const sendToTokens = async (tokens, { title, body, data, imageUrl }) => {
    const client = getClient();
    const unique = [...new Set(tokens.filter(Boolean))];
    if (!client || unique.length === 0) return { successCount: 0, failureCount: 0 };

    const response = await client.sendEachForMulticast({
        tokens: unique,
        notification: { title, body, ...(imageUrl ? { imageUrl } : {}) },
        data: stringifyData(data),
        android: { priority: 'high', notification: { channelId: ANDROID_CHANNEL_ID, sound: 'default' } },
        apns: { payload: { aps: { sound: 'default' } } }
    });

    const dead = response.responses
        .map((r, i) => (!r.success && DEAD_TOKEN_CODES.has(r.error?.code) ? unique[i] : null))
        .filter(Boolean);
    if (dead.length) await DeviceToken.deleteMany({ token: { $in: dead } });

    return { successCount: response.successCount, failureCount: response.failureCount };
};

export const sendToOwner = async ({ ownerKind, ownerId }, message) => {
    const rows = await DeviceToken.find({ ownerKind, ownerId }).select('token').lean();
    return sendToTokens(rows.map((r) => r.token), message);
};
