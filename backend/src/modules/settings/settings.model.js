import mongoose from 'mongoose';

const text = (max) => ({ type: String, trim: true, default: '', maxlength: max });

/**
 * Platform settings (scope §7: "contact details, policy text, order
 * settings, and operational parameters"). A single document, key "platform".
 */
const settingsSchema = new mongoose.Schema(
    {
        key: { type: String, default: 'platform', unique: true },
        contact: {
            phone: text(20),
            whatsapp: text(20),
            email: text(120),
            address: text(300),
            supportHours: text(100)
        },
        policies: {
            terms: text(20000),
            privacy: text(20000),
            refund: text(20000),
            cancellation: text(20000),
            delivery: text(20000)
        },
        orders: {
            codEnabled: { type: Boolean, default: true },
            onlinePaymentEnabled: { type: Boolean, default: true },
            /** Cash orders above this need online payment; null = no limit. */
            codMaxOrderPaise: { type: Number, min: 0, default: null }
        },
        maps: {
            /**
             * Google Maps Platform key the apps use for place search, geocoding
             * and map previews. A client-side key: protect it with API and app
             * restrictions in Google Cloud, not by secrecy.
             */
            googleApiKey: text(200)
        },
        operations: {
            /** Pause all new orders and bookings (stock-take, holiday, outage). */
            acceptingOrders: { type: Boolean, default: true },
            pausedMessage: text(200)
        }
    },
    { collection: 'settings', timestamps: true, minimize: false }
);

export const Settings = mongoose.model('Settings', settingsSchema);
