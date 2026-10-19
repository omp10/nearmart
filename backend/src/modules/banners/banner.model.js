import mongoose from 'mongoose';
import { BUSINESS_MODULES } from '../staff/permissions.js';

export const BANNER_PLACEMENTS = Object.freeze(['home', ...BUSINESS_MODULES]);
export const BANNER_LINK_TYPES = Object.freeze(['none', 'module', 'category', 'product', 'url']);

/**
 * A promotional banner (scope §2 home screen, §7 "basic promotional controls").
 * `link` tells the app what to open on tap.
 */
const bannerSchema = new mongoose.Schema(
    {
        title: { type: String, required: true, trim: true, maxlength: 100 },
        image: { type: String, required: true },
        placement: { type: String, enum: BANNER_PLACEMENTS, default: 'home' },
        link: {
            type: { type: String, enum: BANNER_LINK_TYPES, default: 'none' },
            /** Module key, category/product id, or https URL, depending on type. */
            value: { type: String, trim: true, default: '' }
        },
        sortOrder: { type: Number, default: 0 },
        isActive: { type: Boolean, default: true },
        startsAt: { type: Date, default: null },
        endsAt: { type: Date, default: null }
    },
    { collection: 'banners', timestamps: true }
);

bannerSchema.index({ placement: 1, isActive: 1, sortOrder: 1 });

bannerSchema.pre('validate', function check() {
    const { type, value } = this.link ?? {};
    if (type === 'url' && !/^https:\/\/\S+$/i.test(value)) this.invalidate('link.value', 'Link must be an https:// URL');
    if (type === 'module' && !BUSINESS_MODULES.includes(value)) this.invalidate('link.value', 'Choose a module');
    if ((type === 'category' || type === 'product') && !mongoose.isValidObjectId(value)) this.invalidate('link.value', `Choose a ${type}`);
    if (this.startsAt && this.endsAt && this.startsAt >= this.endsAt) this.invalidate('endsAt', 'End must be after start');
});

export const Banner = mongoose.model('Banner', bannerSchema);
