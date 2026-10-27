import mongoose from 'mongoose';
import { BUSINESS_MODULES } from '../staff/permissions.js';

export const OFFER_CARD_LINK_TYPES = Object.freeze(['none', 'category', 'product', 'search', 'url']);

/**
 * A promotional offer tile / card shown on the shop home screen under the main banner.
 * Managed per business module.
 */
const offerCardSchema = new mongoose.Schema(
    {
        module: { type: String, enum: BUSINESS_MODULES, required: true },
        title: { type: String, required: true, trim: true, maxlength: 100 },
        label: { type: String, trim: true, default: 'UP TO', maxlength: 50 },
        discountText: { type: String, required: true, trim: true, maxlength: 50 },
        image: { type: String, required: true, trim: true },
        backgroundColor: { type: String, trim: true, default: '#F3F4F6', maxlength: 30 },
        link: {
            type: { type: String, enum: OFFER_CARD_LINK_TYPES, default: 'none' },
            value: { type: String, trim: true, default: '' }
        },
        sortOrder: { type: Number, default: 0 },
        isActive: { type: Boolean, default: true },
        startsAt: { type: Date, default: null },
        endsAt: { type: Date, default: null }
    },
    { collection: 'offer_cards', timestamps: true }
);

offerCardSchema.index({ module: 1, isActive: 1, sortOrder: 1 });

offerCardSchema.pre('validate', function check() {
    const { type, value } = this.link ?? {};
    if (type === 'url' && value && !/^https?:\/\/\S+$/i.test(value)) {
        this.invalidate('link.value', 'Link must be a valid URL');
    }
    if ((type === 'category' || type === 'product') && value && !mongoose.isValidObjectId(value)) {
        this.invalidate('link.value', `Choose a valid ${type}`);
    }
    if (this.startsAt && this.endsAt && this.startsAt >= this.endsAt) {
        this.invalidate('endsAt', 'End must be after start');
    }
});

export const OfferCard = mongoose.model('OfferCard', offerCardSchema);
