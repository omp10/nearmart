import mongoose from 'mongoose';
import { BUSINESS_MODULES } from '../staff/permissions.js';

const wholePaise = { validator: (v) => v == null || Number.isInteger(v), message: '{PATH} must be whole paise' };

/**
 * A discount code (scope §2, §7: "approved discount/coupon fields"). One
 * coupon per order; no stacking.
 */
const couponSchema = new mongoose.Schema(
    {
        code: { type: String, required: true, unique: true, uppercase: true, trim: true, match: /^[A-Z0-9_-]{3,20}$/ },
        description: { type: String, trim: true, default: '', maxlength: 200 },
        type: { type: String, enum: ['percent', 'flat'], required: true },
        /** Percent (1–100) or flat paise. */
        value: { type: Number, required: true, min: 1 },
        /** Cap on a percent discount. */
        maxDiscountPaise: { type: Number, min: 0, default: null, validate: wholePaise },
        minOrderPaise: { type: Number, min: 0, default: 0, validate: wholePaise },
        /** Empty = every product module. */
        modules: { type: [String], enum: BUSINESS_MODULES, default: [] },
        validFrom: { type: Date, default: null },
        validTo: { type: Date, default: null },
        /** Total redemptions allowed; null = unlimited. */
        usageLimit: { type: Number, min: 1, default: null },
        perUserLimit: { type: Number, min: 1, default: 1 },
        /** Only for a customer's first order. */
        firstOrderOnly: { type: Boolean, default: false },
        usedCount: { type: Number, default: 0, min: 0 },
        isActive: { type: Boolean, default: true }
    },
    { collection: 'coupons', timestamps: true }
);

couponSchema.pre('validate', function check() {
    if (this.type === 'percent' && this.value > 100) this.invalidate('value', 'A percentage cannot exceed 100');
    if (this.type === 'flat' && !Number.isInteger(this.value)) this.invalidate('value', 'A flat discount is whole paise');
    if (this.validFrom && this.validTo && this.validFrom >= this.validTo) this.invalidate('validTo', 'End must be after start');
});

export const Coupon = mongoose.model('Coupon', couponSchema);

/** One row per order that used a coupon; per-customer limits count these. */
const redemptionSchema = new mongoose.Schema(
    {
        coupon: { type: mongoose.Schema.Types.ObjectId, ref: 'Coupon', required: true },
        user: { type: mongoose.Schema.Types.ObjectId, required: true },
        order: { type: mongoose.Schema.Types.ObjectId, required: true, unique: true },
        discountPaise: { type: Number, required: true }
    },
    { collection: 'coupon_redemptions', timestamps: true }
);
redemptionSchema.index({ coupon: 1, user: 1 });

export const CouponRedemption = mongoose.model('CouponRedemption', redemptionSchema);

/**
 * Uses per (coupon, customer). The per-customer limit is enforced by a
 * conditional increment on this row, so parallel checkouts can't each pass a
 * read-then-write check.
 */
const usageSchema = new mongoose.Schema(
    {
        coupon: { type: mongoose.Schema.Types.ObjectId, required: true },
        user: { type: mongoose.Schema.Types.ObjectId, required: true },
        count: { type: Number, default: 0, min: 0 }
    },
    { collection: 'coupon_usage' }
);
usageSchema.index({ coupon: 1, user: 1 }, { unique: true });

export const CouponUsage = mongoose.model('CouponUsage', usageSchema);
