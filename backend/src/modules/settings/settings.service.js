import { ValidationError } from '../../lib/errors.js';
import { formatRupees } from '../../lib/money.js';
import { gatewayConfig } from '../payments/gateway.config.js';
import { Settings } from './settings.model.js';

/** The settings document, created with defaults on first read. */
export const getSettings = async () => {
    const existing = await Settings.findOne({ key: 'platform' }).lean();
    if (existing) return existing;
    try {
        return await Settings.findOneAndUpdate({ key: 'platform' }, { $setOnInsert: { key: 'platform' } }, { upsert: true, new: true }).lean();
    } catch (err) {
        // Two first reads raced to create it; the other one won.
        if (err?.code === 11000) return Settings.findOne({ key: 'platform' }).lean();
        throw err;
    }
};

/** Merges a partial update one section at a time, so saving "contact" never clears "policies". */
export const updateSettings = async (patch) => {
    const set = {};
    for (const [section, values] of Object.entries(patch)) {
        for (const [field, value] of Object.entries(values ?? {})) set[`${section}.${field}`] = value;
    }
    return Settings.findOneAndUpdate({ key: 'platform' }, { $set: set }, { upsert: true, new: true, runValidators: true }).lean();
};

/** What the app needs: contact, policies and which payment options to show. */
export const publicSettings = async () => {
    const s = await getSettings();
    // Online payment shows only when it's switched on and a gateway is configured.
    const online = s.orders.onlinePaymentEnabled && (await gatewayConfig()).enabled;
    return {
        contact: s.contact,
        policies: s.policies,
        payments: { cod: s.orders.codEnabled, online, codMaxOrderPaise: s.orders.codMaxOrderPaise },
        acceptingOrders: s.operations.acceptingOrders,
        pausedMessage: s.operations.acceptingOrders ? '' : s.operations.pausedMessage || 'We are not taking orders right now.'
    };
};

/**
 * Checks the operational switches before an order or booking is created.
 * @param {{ paymentMethod: 'cod'|'online', totalPaise: number }} checkout
 */
export const assertCheckoutAllowed = async ({ paymentMethod, totalPaise }) => {
    const s = await getSettings();
    if (!s.operations.acceptingOrders) {
        throw new ValidationError(s.operations.pausedMessage || 'We are not taking orders right now. Please try again later.');
    }
    if (paymentMethod === 'cod' && !s.orders.codEnabled) throw new ValidationError('Cash on delivery is not available right now');
    if (paymentMethod === 'online' && !s.orders.onlinePaymentEnabled) throw new ValidationError('Online payment is not available right now');
    if (paymentMethod === 'cod' && s.orders.codMaxOrderPaise != null && totalPaise > s.orders.codMaxOrderPaise) {
        throw new ValidationError(`Cash on delivery is available up to ${formatRupees(s.orders.codMaxOrderPaise)}. Please pay online.`);
    }
};
