import { Router } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { NotFoundError } from '../../lib/errors.js';
import { escapeRegex, pageQuery } from '../../lib/pagination.js';
import { ok } from '../../lib/response.js';
import { validate } from '../../lib/validate.js';
import { authenticate, requireAdmin, requirePermission } from '../../middleware/auth.js';
import { revokeAllForSubject } from '../auth/token.service.js';
import { LaundryBooking } from '../laundry/booking.model.js';
import { Order } from '../orders/order.model.js';
import { User } from '../users/user.model.js';

/**
 * Customer profiles and history (scope §7). Customers span every module, so
 * this is for admins, not module-scoped ops users.
 */
const router = Router();
router.use(authenticate, requireAdmin);

/** Order count and value per customer, excluding cancelled orders. */
const orderStats = async (userIds) => {
    const rows = await Order.aggregate([
        { $match: { user: { $in: userIds }, status: { $ne: 'cancelled' } } },
        { $group: { _id: '$user', orders: { $sum: 1 }, spentPaise: { $sum: '$pricing.totalPaise' }, lastOrderAt: { $max: '$createdAt' } } }
    ]);
    return new Map(rows.map((r) => [String(r._id), r]));
};

router.get(
    '/',
    requirePermission('customers', 'view'),
    validate(z.object({ ...pageQuery, q: z.string().trim().max(60).optional(), status: z.enum(['active', 'inactive']).optional() }), 'query'),
    async (req, res) => {
        const { q, status, page, limit } = req.validatedQuery;
        const filter = {};
        if (status) filter.isActive = status === 'active';
        if (q) {
            const rx = new RegExp(escapeRegex(q), 'i');
            filter.$or = [{ phone: rx }, { name: rx }, { email: rx }];
        }
        const [users, total] = await Promise.all([
            User.find(filter).select('phone name email isActive createdAt lastLoginAt').sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
            User.countDocuments(filter)
        ]);
        const stats = await orderStats(users.map((u) => u._id));
        const items = users.map((u) => {
            const s = stats.get(String(u._id));
            return { ...u, orders: s?.orders ?? 0, spentPaise: s?.spentPaise ?? 0, lastOrderAt: s?.lastOrderAt ?? null };
        });
        ok(res, { items, page, limit, total, pages: Math.ceil(total / limit) });
    }
);

router.get('/:id', requirePermission('customers', 'view'), async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.id)) throw new NotFoundError('Customer not found');
    const user = await User.findById(req.params.id).select('-tokenVersion -__v').lean();
    if (!user) throw new NotFoundError('Customer not found');
    const [orders, bookings, stats] = await Promise.all([
        Order.find({ user: user._id }).select('orderNumber module status pricing.totalPaise payment.method createdAt').sort({ createdAt: -1 }).limit(50).lean(),
        LaundryBooking.find({ user: user._id }).select('bookingNumber status pricing.totalPaise createdAt').sort({ createdAt: -1 }).limit(50).lean(),
        orderStats([user._id])
    ]);
    const s = stats.get(String(user._id));
    ok(res, { ...user, orders, bookings, stats: { orders: s?.orders ?? 0, spentPaise: s?.spentPaise ?? 0 } });
});

/** Activate or deactivate. Deactivating signs the customer out everywhere at once. */
router.patch('/:id', requirePermission('customers', 'update'), validate(z.object({ isActive: z.boolean() })), async (req, res) => {
    const update = req.body.isActive ? { $set: { isActive: true } } : { $set: { isActive: false }, $inc: { tokenVersion: 1 } };
    const user = await User.findByIdAndUpdate(req.params.id, update, { new: true }).select('phone name isActive').lean();
    if (!user) throw new NotFoundError('Customer not found');
    if (!user.isActive) await revokeAllForSubject(user._id, 'user');
    ok(res, user, user.isActive ? 'Customer activated' : 'Customer deactivated');
});

export default router;
