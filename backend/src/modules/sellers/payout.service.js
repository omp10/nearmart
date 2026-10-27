import crypto from 'node:crypto';
import mongoose from 'mongoose';
import { ConflictError, NotFoundError, ValidationError } from '../../lib/errors.js';
import { istDate } from '../../lib/istTime.js';
import { logger } from '../../lib/logger.js';
import { notify } from '../notifications/notification.service.js';
import { Order } from '../orders/order.model.js';
import { Payout, Seller } from './seller.model.js';
import { getConfig } from './seller.service.js';

/**
 * Money owed to marketplace sellers. A seller earns on delivered orders: the
 * value of the items they supplied, less Nearmart's commission and fixed fee
 * (both fixed when the order was placed). Delivery fees and coupon discounts
 * are Nearmart's. An order becomes payable `payoutHoldDays` after delivery,
 * and a payout claims the payable orders so none is paid twice.
 */

const toId = (v) => new mongoose.Types.ObjectId(String(v));

/** Settlement figures for one order, as stored fields → paise. */
export const settlementOf = (order) => {
    const grossPaise = order.items.filter((l) => l.status === 'ok').reduce((sum, l) => sum + l.lineTotalPaise, 0);
    const commissionPaise = Math.round((grossPaise * (order.seller?.commissionPercent ?? 0)) / 100);
    const feePaise = Math.min(order.seller?.fixedFeePaise ?? 0, grossPaise - commissionPaise);
    return { grossPaise, commissionPaise, feePaise, netPaise: grossPaise - commissionPaise - feePaise };
};

const addUp = (orders) =>
    orders.reduce(
        (t, o) => {
            const s = settlementOf(o);
            t.orders += 1;
            t.grossPaise += s.grossPaise;
            t.commissionPaise += s.commissionPaise;
            t.feePaise += s.feePaise;
            t.netPaise += s.netPaise;
            return t;
        },
        { orders: 0, grossPaise: 0, commissionPaise: 0, feePaise: 0, netPaise: 0 }
    );

const SETTLEMENT_FIELDS = 'orderNumber module status seller items.lineTotalPaise items.status deliveredAt createdAt payout pricing.totalPaise payment.method';

const holdCutoff = async () => new Date(Date.now() - (await getConfig()).payoutHoldDays * 86_400_000);

/** Where a seller's money stands right now. */
export const balanceFor = async (sellerId) => {
    const cutoff = await holdCutoff();
    const unsettled = await Order.find({ 'seller.id': toId(sellerId), status: 'delivered', payout: null }).select(SETTLEMENT_FIELDS).lean();
    const payable = unsettled.filter((o) => (o.deliveredAt ?? o.createdAt) <= cutoff);
    const onHold = unsettled.filter((o) => (o.deliveredAt ?? o.createdAt) > cutoff);
    const payouts = await Payout.aggregate([
        { $match: { seller: toId(sellerId), status: { $in: ['pending', 'paid'] } } },
        { $group: { _id: '$status', net: { $sum: '$netPaise' } } }
    ]);
    const byStatus = Object.fromEntries(payouts.map((p) => [p._id, p.net]));
    return {
        payablePaise: addUp(payable).netPaise,
        payableOrders: payable.length,
        onHoldPaise: addUp(onHold).netPaise,
        inPayoutPaise: byStatus.pending ?? 0,
        paidPaise: byStatus.paid ?? 0
    };
};

/** Delivered orders in a date range with what the seller earned on each. */
export const sellerEarnings = async (sellerId, { from, to, page = 1, limit = 20 }) => {
    const filter = { 'seller.id': toId(sellerId), status: 'delivered' };
    if (from || to) filter.deliveredAt = { ...(from ? { $gte: from } : {}), ...(to ? { $lte: to } : {}) };
    const [all, balance] = await Promise.all([Order.find(filter).select(SETTLEMENT_FIELDS).sort({ deliveredAt: -1 }).lean(), balanceFor(sellerId)]);
    const items = all.slice((page - 1) * limit, page * limit).map(({ items: lines, seller, ...o }) => ({
        ...o,
        commissionPercent: seller?.commissionPercent ?? 0,
        ...settlementOf({ items: lines, seller })
    }));
    return { totals: addUp(all), balance, items, page, limit, total: all.length, pages: Math.ceil(all.length / limit) };
};

// ─── Payouts ───

const newPayoutNumber = () => `PO${istDate().slice(2).replaceAll('-', '')}${crypto.randomBytes(3).toString('hex').toUpperCase()}`;

/** Bundles every payable order of a seller into a pending payout for the admin to pay. */
export const createPayout = async (sellerId, { by }) => {
    const seller = await Seller.findById(sellerId).select('businessName').lean();
    if (!seller) throw new NotFoundError('Seller not found');
    const cutoff = await holdCutoff();
    const candidates = await Order.find({ 'seller.id': toId(sellerId), status: 'delivered', payout: null, deliveredAt: { $lte: cutoff } }).select('_id').lean();
    if (!candidates.length) throw new ValidationError('Nothing is payable to this seller yet');

    const payout = new Payout({ seller: seller._id, number: newPayoutNumber(), periodTo: cutoff, createdBy: by });
    await payout.save();
    // Claim the orders; one claimed meanwhile by another payout simply isn't included.
    await Order.updateMany({ _id: { $in: candidates.map((o) => o._id) }, payout: null }, { $set: { payout: payout._id } });
    const claimed = await Order.find({ payout: payout._id }).select(SETTLEMENT_FIELDS).lean();
    if (!claimed.length) {
        await payout.deleteOne();
        throw new ConflictError('These orders were just included in another payout');
    }
    const totals = addUp(claimed);
    Object.assign(payout, {
        orders: claimed.map((o) => o._id),
        orderCount: totals.orders,
        grossPaise: totals.grossPaise,
        commissionPaise: totals.commissionPaise,
        feePaise: totals.feePaise,
        netPaise: totals.netPaise
    });
    await payout.save();
    return payout.toObject();
};

export const markPayoutPaid = async (payoutId, { mode, reference = '', note = '' }) => {
    const payout = await Payout.findOneAndUpdate(
        { _id: payoutId, status: 'pending' },
        { $set: { status: 'paid', mode, reference, note, paidAt: new Date() } },
        { new: true }
    ).lean();
    if (!payout) throw new ConflictError('Only a pending payout can be marked paid');
    notify(
        { ownerKind: 'seller', ownerId: payout.seller },
        { title: `Payout ${payout.number} sent`, body: `₹${payout.netPaise / 100} for ${payout.orderCount} orders${reference ? ` · ref ${reference}` : ''}`, type: 'seller.payout.paid', data: { payoutId: String(payout._id) } }
    ).catch((err) => logger.warn({ err: err.message }, 'Payout notification failed'));
    return payout;
};

/** Cancels a payout not yet paid, releasing its orders for the next one. */
export const cancelPayout = async (payoutId) => {
    const payout = await Payout.findOneAndUpdate({ _id: payoutId, status: 'pending' }, { $set: { status: 'cancelled' } }, { new: true }).lean();
    if (!payout) throw new ConflictError('Only a pending payout can be cancelled');
    await Order.updateMany({ payout: payout._id }, { $set: { payout: null } });
    return payout;
};

export const listPayouts = async ({ sellerId, status, page = 1, limit = 20 }) => {
    const filter = {};
    if (sellerId) filter.seller = toId(sellerId);
    if (status) filter.status = status;
    const [items, total] = await Promise.all([
        Payout.find(filter).select('-orders').populate('seller', 'businessName').sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
        Payout.countDocuments(filter)
    ]);
    return { items, page, limit, total, pages: Math.ceil(total / limit) };
};

/** One payout with its orders (a statement). `sellerId` limits it to that seller's own. */
export const getPayout = async (payoutId, { sellerId } = {}) => {
    if (!mongoose.isValidObjectId(payoutId)) throw new NotFoundError('Payout not found');
    const payout = await Payout.findById(payoutId).populate('seller', 'businessName bank').lean();
    if (!payout || (sellerId && String(payout.seller?._id) !== String(sellerId))) throw new NotFoundError('Payout not found');
    const orders = await Order.find({ _id: { $in: payout.orders } }).select(SETTLEMENT_FIELDS).sort({ deliveredAt: 1 }).lean();
    const { orders: _ids, ...rest } = payout;
    // Bank details are for the admin paying it; the seller already knows their own.
    if (sellerId && rest.seller) delete rest.seller.bank;
    return { ...rest, orders: orders.map(({ items, seller, ...o }) => ({ ...o, commissionPercent: seller?.commissionPercent ?? 0, ...settlementOf({ items, seller }) })) };
};

/** Every seller with money owed, for the admin payouts page. */
export const sellerBalances = async () => {
    const sellers = await Seller.find({ status: { $in: ['approved', 'suspended'] } }).select('businessName status bank').lean();
    const rows = await Promise.all(sellers.map(async (s) => ({ seller: { _id: s._id, businessName: s.businessName, status: s.status, hasBank: Boolean(s.bank?.accountNumber || s.bank?.upiId) }, ...(await balanceFor(s._id)) })));
    return rows.sort((a, b) => b.payablePaise - a.payablePaise);
};
