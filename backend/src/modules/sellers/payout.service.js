import crypto from 'node:crypto';
import mongoose from 'mongoose';
import { ConflictError, NotFoundError, ValidationError } from '../../lib/errors.js';
import { istDate } from '../../lib/istTime.js';
import { logger } from '../../lib/logger.js';
import { notify } from '../notifications/notification.service.js';
import { Order } from '../orders/order.model.js';
import { Payout, Seller, SellerAdjustment } from './seller.model.js';
import { getConfig } from './seller.service.js';

/**
 * Money owed to marketplace sellers. A seller earns on delivered orders: the
 * value of the items they supplied, less Nearmart's commission and fixed fee
 * (both fixed when the order was placed). Delivery fees and coupon discounts
 * are Nearmart's. An order becomes payable `payoutHoldDays` after delivery,
 * and a payout claims the payable orders so none is paid twice.
 */

const toId = (v) => new mongoose.Types.ObjectId(String(v));

/**
 * Settlement figures for one order, in paise. A seller-funded coupon's
 * discount comes out of the seller's share; a Nearmart-funded one doesn't.
 */
export const settlementOf = (order) => {
    const grossPaise = order.items.filter((l) => l.status === 'ok').reduce((sum, l) => sum + l.lineTotalPaise, 0);
    const commissionPaise = Math.round((grossPaise * (order.seller?.commissionPercent ?? 0)) / 100);
    const feePaise = Math.min(order.seller?.fixedFeePaise ?? 0, grossPaise - commissionPaise);
    const sellerDiscountPaise = order.coupon?.fundedBy === 'seller' ? Math.min(order.coupon.discountPaise ?? 0, grossPaise - commissionPaise - feePaise) : 0;
    return { grossPaise, commissionPaise, feePaise, sellerDiscountPaise, netPaise: grossPaise - commissionPaise - feePaise - sellerDiscountPaise };
};

const addUp = (orders) =>
    orders.reduce(
        (t, o) => {
            const s = settlementOf(o);
            t.orders += 1;
            t.grossPaise += s.grossPaise;
            t.commissionPaise += s.commissionPaise;
            t.feePaise += s.feePaise;
            t.sellerDiscountPaise += s.sellerDiscountPaise;
            t.netPaise += s.netPaise;
            return t;
        },
        { orders: 0, grossPaise: 0, commissionPaise: 0, feePaise: 0, sellerDiscountPaise: 0, netPaise: 0 }
    );

const SETTLEMENT_FIELDS = 'orderNumber module status seller coupon items.lineTotalPaise items.status deliveredAt createdAt payout pricing.totalPaise payment.method';

const unsettledAdjustments = (sellerId) => SellerAdjustment.find({ seller: toId(sellerId), payout: null }).sort({ createdAt: 1 }).lean();
const sumAdjustments = (rows) => rows.reduce((s, a) => s + a.amountPaise, 0);

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
    const adjustments = await unsettledAdjustments(sellerId);
    return {
        payablePaise: addUp(payable).netPaise + sumAdjustments(adjustments),
        adjustmentsPaise: sumAdjustments(adjustments),
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
        ...settlementOf({ items: lines, seller, coupon: o.coupon })
    }));
    return { totals: addUp(all), balance, items, page, limit, total: all.length, pages: Math.ceil(all.length / limit) };
};

// ─── Payouts ───

const newPayoutNumber = () => `PO${istDate().slice(2).replaceAll('-', '')}${crypto.randomBytes(3).toString('hex').toUpperCase()}`;

/** Bundles every payable order of a seller into a pending payout for the admin to pay. */
export const createPayout = async (sellerId, { by }) => {
    const seller = await Seller.findById(sellerId).select('businessName bank').lean();
    if (!seller) throw new NotFoundError('Seller not found');
    const cutoff = await holdCutoff();
    const candidates = await Order.find({ 'seller.id': toId(sellerId), status: 'delivered', payout: null, deliveredAt: { $lte: cutoff } }).select('_id').lean();
    const pendingAdjustments = await unsettledAdjustments(sellerId);
    if (!candidates.length && !pendingAdjustments.length) throw new ValidationError('Nothing is payable to this seller yet');

    // The bank details are copied now, so a later change can't redirect this money.
    const { accountName = '', accountNumber = '', ifsc = '', upiId = '' } = seller.bank ?? {};
    const payout = new Payout({ seller: seller._id, number: newPayoutNumber(), periodTo: cutoff, createdBy: by, bank: { accountName, accountNumber, ifsc, upiId } });
    await payout.save();
    // Claim the orders and adjustments; one claimed meanwhile by another payout simply isn't included.
    await Order.updateMany({ _id: { $in: candidates.map((o) => o._id) }, payout: null }, { $set: { payout: payout._id } });
    await SellerAdjustment.updateMany({ _id: { $in: pendingAdjustments.map((a) => a._id) }, payout: null }, { $set: { payout: payout._id } });
    const claimed = await Order.find({ payout: payout._id }).select(SETTLEMENT_FIELDS).lean();
    const adjustments = await SellerAdjustment.find({ payout: payout._id }).lean();
    if (!claimed.length && !adjustments.length) {
        await payout.deleteOne();
        throw new ConflictError('These orders were just included in another payout');
    }
    const totals = addUp(claimed);
    const adjustmentsPaise = sumAdjustments(adjustments);
    if (totals.netPaise + adjustmentsPaise <= 0) {
        // Debits outweigh earnings: nothing to send yet; leave everything for the next payout.
        await Order.updateMany({ payout: payout._id }, { $set: { payout: null } });
        await SellerAdjustment.updateMany({ payout: payout._id }, { $set: { payout: null } });
        await payout.deleteOne();
        throw new ValidationError(`This seller owes ₹${(-(totals.netPaise + adjustmentsPaise)) / 100} after adjustments; it carries into their next payout`);
    }
    Object.assign(payout, {
        orders: claimed.map((o) => o._id),
        orderCount: totals.orders,
        grossPaise: totals.grossPaise,
        commissionPaise: totals.commissionPaise,
        feePaise: totals.feePaise,
        sellerDiscountPaise: totals.sellerDiscountPaise,
        adjustments: adjustments.map((a) => a._id),
        adjustmentsPaise,
        netPaise: totals.netPaise + adjustmentsPaise
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
    await SellerAdjustment.updateMany({ payout: payout._id }, { $set: { payout: null } });
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
    const payout = await Payout.findById(payoutId).populate('seller', 'businessName').lean();
    if (!payout || (sellerId && String(payout.seller?._id) !== String(sellerId))) throw new NotFoundError('Payout not found');
    const [orders, adjustments] = await Promise.all([
        Order.find({ _id: { $in: payout.orders } }).select(SETTLEMENT_FIELDS).sort({ deliveredAt: 1 }).lean(),
        SellerAdjustment.find({ _id: { $in: payout.adjustments ?? [] } }).select('amountPaise reason order createdAt').populate('order', 'orderNumber').lean()
    ]);
    const { orders: _ids, adjustments: _adj, ...rest } = payout;
    // The bank details are for the admin paying it; the seller sees only the last digits.
    if (sellerId) rest.bank = { accountNumber: rest.bank?.accountNumber ? `••••${rest.bank.accountNumber.slice(-4)}` : '', upiId: rest.bank?.upiId ?? '' };
    return {
        ...rest,
        adjustments,
        orders: orders.map(({ items, seller, coupon, ...o }) => ({ ...o, commissionPercent: seller?.commissionPercent ?? 0, ...settlementOf({ items, seller, coupon }) }))
    };
};

// ─── Adjustments ───

export const addAdjustment = async (sellerId, { amountPaise, reason, orderId }, by) => {
    const seller = await Seller.findById(sellerId).select('_id').lean();
    if (!seller) throw new NotFoundError('Seller not found');
    if (orderId && !(await Order.exists({ _id: orderId, 'seller.id': seller._id }))) throw new ValidationError("That order isn't this seller's");
    const row = await SellerAdjustment.create({ seller: seller._id, amountPaise, reason, order: orderId || null, createdBy: by });
    notify(
        { ownerKind: 'seller', ownerId: seller._id },
        { title: amountPaise > 0 ? `₹${amountPaise / 100} credited to your balance` : `₹${-amountPaise / 100} deducted from your balance`, body: reason, type: 'seller.adjustment', data: { adjustmentId: String(row._id) } }
    ).catch(() => {});
    return row.toObject();
};

/** Only an adjustment not yet in a payout can be removed. */
export const removeAdjustment = async (sellerId, adjustmentId) => {
    const res = await SellerAdjustment.deleteOne({ _id: adjustmentId, seller: toId(sellerId), payout: null });
    if (!res.deletedCount) throw new ConflictError('This adjustment is already part of a payout');
};

export const listAdjustments = async (sellerId, { page = 1, limit = 50 } = {}) => {
    const filter = { seller: toId(sellerId) };
    const [items, total] = await Promise.all([
        SellerAdjustment.find(filter).populate('order', 'orderNumber').sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
        SellerAdjustment.countDocuments(filter)
    ]);
    return { items, page, limit, total, pages: Math.ceil(total / limit) };
};

// ─── Commission report ───

/**
 * Delivered orders in a range, per seller: sales, Nearmart's commission and
 * fees, seller-funded discounts, and what the sellers earn. Nearmart's own
 * stock is reported as one row of sales without commission.
 */
export const commissionReport = async ({ from, to }) => {
    const filter = { status: 'delivered' };
    if (from || to) filter.deliveredAt = { ...(from ? { $gte: from } : {}), ...(to ? { $lte: to } : {}) };
    const orders = await Order.find(filter).select(`${SETTLEMENT_FIELDS} pricing.deliveryFeePaise`).lean();
    const rows = new Map();
    let ownSales = 0;
    let ownOrders = 0;
    let deliveryFees = 0;
    for (const o of orders) {
        deliveryFees += o.pricing?.deliveryFeePaise ?? 0;
        if (!o.seller?.id) {
            ownOrders += 1;
            ownSales += o.items.filter((l) => l.status === 'ok').reduce((s, l) => s + l.lineTotalPaise, 0);
            continue;
        }
        const key = String(o.seller.id);
        if (!rows.has(key)) rows.set(key, { sellerId: key, name: o.seller.name, byModule: {}, orders: [] });
        const r = rows.get(key);
        r.orders.push(o);
        r.byModule[o.module] = (r.byModule[o.module] ?? 0) + 1;
    }
    const sellers = [...rows.values()].map(({ orders: list, ...r }) => ({ ...r, ...addUp(list) })).sort((a, b) => b.commissionPaise - a.commissionPaise);
    const totals = sellers.reduce(
        (t, r) => ({ orders: t.orders + r.orders, grossPaise: t.grossPaise + r.grossPaise, commissionPaise: t.commissionPaise + r.commissionPaise, feePaise: t.feePaise + r.feePaise, sellerDiscountPaise: t.sellerDiscountPaise + r.sellerDiscountPaise, netPaise: t.netPaise + r.netPaise }),
        { orders: 0, grossPaise: 0, commissionPaise: 0, feePaise: 0, sellerDiscountPaise: 0, netPaise: 0 }
    );
    return { sellers, totals, nearmart: { orders: ownOrders, salesPaise: ownSales }, deliveryFeesPaise: deliveryFees };
};

/** Every seller with money owed, for the admin payouts page. */
export const sellerBalances = async () => {
    const sellers = await Seller.find({ status: { $in: ['approved', 'suspended'] } }).select('businessName status bank').lean();
    const rows = await Promise.all(sellers.map(async (s) => ({ seller: { _id: s._id, businessName: s.businessName, status: s.status, hasBank: Boolean(s.bank?.accountNumber || s.bank?.upiId) }, ...(await balanceFor(s._id)) })));
    return rows.sort((a, b) => b.payablePaise - a.payablePaise);
};
