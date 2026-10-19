import { ConflictError, NotFoundError, ValidationError } from '../../lib/errors.js';
import { formatRupees } from '../../lib/money.js';
import { Coupon, CouponRedemption } from './coupon.model.js';

/** Discount a coupon gives on a subtotal (never more than the subtotal). */
export const discountFor = (coupon, subtotalPaise) => {
    const raw = coupon.type === 'percent' ? Math.floor((subtotalPaise * coupon.value) / 100) : coupon.value;
    const capped = coupon.maxDiscountPaise != null ? Math.min(raw, coupon.maxDiscountPaise) : raw;
    return Math.max(0, Math.min(capped, subtotalPaise));
};

/**
 * Checks a code for this customer, module and subtotal and returns the
 * coupon with its discount. Every rejection says why, for the app to show.
 */
export const evaluateCoupon = async (code, { userId, module, subtotalPaise, hasPreviousOrders, now = new Date() }) => {
    const coupon = await Coupon.findOne({ code: String(code).trim().toUpperCase() }).lean();
    if (!coupon || !coupon.isActive) throw new ValidationError('This coupon code is not valid');
    if (coupon.validFrom && now < coupon.validFrom) throw new ValidationError('This coupon is not active yet');
    if (coupon.validTo && now > coupon.validTo) throw new ValidationError('This coupon has expired');
    if (coupon.modules.length && !coupon.modules.includes(module)) throw new ValidationError('This coupon does not apply to these items');
    if (coupon.usageLimit != null && coupon.usedCount >= coupon.usageLimit) throw new ValidationError('This coupon has been fully used');
    if (coupon.firstOrderOnly && hasPreviousOrders) throw new ValidationError('This coupon is for your first order only');
    if (subtotalPaise < coupon.minOrderPaise) {
        throw new ValidationError(`Add items worth ${formatRupees(coupon.minOrderPaise - subtotalPaise)} more to use this coupon`);
    }
    const used = await CouponRedemption.countDocuments({ coupon: coupon._id, user: userId });
    if (used >= coupon.perUserLimit) throw new ValidationError('You have already used this coupon');

    return { coupon, discountPaise: discountFor(coupon, subtotalPaise) };
};

/**
 * Records the use against the total limit atomically, so a limited coupon
 * can't be over-redeemed by simultaneous orders.
 */
export const redeemCoupon = async ({ coupon, userId, orderId, discountPaise }) => {
    const limit = coupon.usageLimit != null ? { usedCount: { $lt: coupon.usageLimit } } : {};
    const res = await Coupon.updateOne({ _id: coupon._id, isActive: true, ...limit }, { $inc: { usedCount: 1 } });
    if (res.modifiedCount === 0) throw new ConflictError('This coupon has just been fully used');
    try {
        await CouponRedemption.create({ coupon: coupon._id, user: userId, order: orderId, discountPaise });
    } catch (err) {
        await Coupon.updateOne({ _id: coupon._id }, { $inc: { usedCount: -1 } });
        throw err;
    }
};

/** Gives the use back when the order is cancelled. */
export const releaseCoupon = async (orderId) => {
    const redemption = await CouponRedemption.findOneAndDelete({ order: orderId });
    if (redemption) await Coupon.updateOne({ _id: redemption.coupon, usedCount: { $gt: 0 } }, { $inc: { usedCount: -1 } });
};

// ─── Admin ───

export const listCoupons = () => Coupon.find().sort({ createdAt: -1 }).lean();

export const getCoupon = async (id) => {
    const coupon = await Coupon.findById(id);
    if (!coupon) throw new NotFoundError('Coupon not found');
    return coupon;
};

export const createCoupon = (input) => Coupon.create(input);

export const updateCoupon = async (id, input) => {
    const coupon = await getCoupon(id);
    Object.assign(coupon, input);
    return coupon.save();
};

export const deleteCoupon = async (id) => {
    const coupon = await getCoupon(id);
    if (coupon.usedCount > 0) throw new ConflictError('This coupon has been used; deactivate it instead');
    await coupon.deleteOne();
};
