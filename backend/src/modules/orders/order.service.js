import crypto from 'node:crypto';
import mongoose from 'mongoose';
import { env } from '../../config/env.js';
import { AppError, ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../../lib/errors.js';
import { istDate } from '../../lib/istTime.js';
import { logger } from '../../lib/logger.js';
import { escapeRegex } from '../../lib/pagination.js';
import { cartItemsForModule, removeLines, setItem } from '../cart/cart.service.js';
import { adjustStock } from '../catalog/stock.service.js';
import { Coupon } from '../coupons/coupon.model.js';
import { discountFor, evaluateCoupon, redeemCoupon, releaseCoupon } from '../coupons/coupon.service.js';
import { getAddress } from '../customers/customer.service.js';
import { notify } from '../notifications/notification.service.js';
import { Payment } from '../payments/payment.model.js';
import { createGatewayPayment, initiateRefund, paymentEvents } from '../payments/payment.service.js';
import { assertCheckoutAllowed } from '../settings/settings.service.js';
import { SlotRule } from '../slots/slot.model.js';
import { releaseSlot, reserveSlot } from '../slots/slot.service.js';
import { User } from '../users/user.model.js';
import { zoneForAddress } from '../zones/zone.service.js';
import { CANCELLABLE_BY_CUSTOMER, CANCELLABLE_BY_STAFF, CUSTOMER_MESSAGES, ITEM_EDITABLE, STATUS_LABELS, canMove } from './order.flow.js';
import { Order } from './order.model.js';
import { priceLines } from './pricing.service.js';

/** How long an online order waits for payment before it is cancelled and its stock released. */
export const PAYMENT_WINDOW_MINUTES = 15;

const SYSTEM = { kind: 'system', id: null };

const newOrderNumber = () =>
    `NM${istDate().slice(2).replaceAll('-', '')}${crypto.randomBytes(3).toString('hex').toUpperCase()}`;

const notifyCustomer = (order, status, extra = '') =>
    notify(
        { ownerKind: 'user', ownerId: order.user },
        {
            title: `${STATUS_LABELS[status]} · #${order.orderNumber}`,
            body: `${CUSTOMER_MESSAGES[status] ?? ''}${extra ? ` ${extra}` : ''}`.trim(),
            type: `order.${status}`,
            data: { orderId: String(order._id) }
        }
    ).catch((err) => logger.warn({ err: err.message }, 'Order notification failed'));

/** Runs compensation steps newest-first, logging (not throwing) any that fail. */
const rollback = async (undo) => {
    for (const step of undo.reverse()) {
        try {
            await step();
        } catch (err) {
            logger.error({ err: err.message }, 'Order rollback step failed');
        }
    }
};

/**
 * Works out a checkout for one module's part of the cart without changing
 * anything. Used for the checkout screen and repeated inside placeOrder.
 */
export const quote = async (userId, { module, addressId, couponCode }) => {
    const address = await getAddress(userId, addressId);
    const zone = await zoneForAddress(address, module);
    if (!zone) throw new ValidationError('We do not deliver this section to that address yet');

    const lines = await cartItemsForModule(userId, module);
    if (!lines.length) throw new ValidationError('Your cart has no items from this section');
    const problems = lines.filter((l) => l.issue);
    if (problems.length) {
        throw new AppError('Some items in your cart need attention', 409, problems.map((l) => ({
            productId: l.productId, variantId: l.variantId, name: l.name, issue: l.issue, maxQty: l.maxQty ?? 0
        })));
    }

    const subtotalPaise = lines.reduce((sum, l) => sum + l.lineTotalPaise, 0);
    if (zone.minOrderPaise && subtotalPaise < zone.minOrderPaise) {
        throw new ValidationError(`The minimum order here is ₹${zone.minOrderPaise / 100}`);
    }

    let coupon = null;
    if (couponCode) {
        const hasPreviousOrders = Boolean(await Order.exists({ user: userId, status: { $ne: 'cancelled' } }));
        ({ coupon } = await evaluateCoupon(couponCode, { userId, module, subtotalPaise, hasPreviousOrders }));
    }

    const slotRequired = Boolean(
        await SlotRule.exists({ module, kind: 'delivery', isActive: true, zone: { $in: [null, zone._id] } })
    );
    return { address, zone, lines, coupon, slotRequired, pricing: priceLines(lines, { zone, coupon }) };
};

/**
 * Places an order for one module's cart lines (scope §2, §3: items for
 * different modules become separate orders).
 *
 * No multi-document transaction (the database may be a standalone server),
 * so each side effect registers how to undo itself, and any failure unwinds
 * the ones already done: slot, stock per line, coupon, order.
 */
export const placeOrder = async (userId, { module, addressId, slotId, couponCode, paymentMethod, notes = '' }) => {
    if (paymentMethod === 'online' && !env.razorpayEnabled) throw new ValidationError('Online payment is not available right now');

    const { address, zone, lines, coupon, slotRequired, pricing } = await quote(userId, { module, addressId, couponCode });
    await assertCheckoutAllowed({ paymentMethod, totalPaise: pricing.totalPaise });
    if (slotRequired && !slotId) throw new ValidationError('Please choose a delivery slot');
    if (paymentMethod === 'online' && pricing.totalPaise < 100) throw new ValidationError('Online payment needs a total of at least ₹1');

    const user = await User.findById(userId).select('phone').lean();
    const orderId = new mongoose.Types.ObjectId();
    const actor = { kind: 'user', id: userId };
    const undo = [];

    try {
        let slot = null;
        if (slotId) {
            slot = await reserveSlot(slotId, { module, kind: 'delivery', zoneId: zone._id });
            undo.push(() => releaseSlot(slotId));
        }

        for (const line of lines) {
            try {
                await adjustStock({ productId: line.productId, variantId: line.variantId, delta: -line.qty, reason: 'order', refId: orderId, actor });
            } catch (err) {
                if (err instanceof ValidationError) throw new ConflictError(`${line.name} (${line.variantLabel}) just ran short of stock. Please update your cart.`);
                throw err;
            }
            undo.push(() => adjustStock({ productId: line.productId, variantId: line.variantId, delta: line.qty, reason: 'order_cancelled', refId: orderId, actor: SYSTEM }));
        }

        if (coupon) {
            await redeemCoupon({ coupon, userId, orderId, discountPaise: pricing.discountPaise });
            undo.push(() => releaseCoupon(orderId));
        }

        const online = paymentMethod === 'online';
        const status = online ? 'pending_payment' : 'placed';
        const { location, ...addressFields } = address;
        const order = new Order({
            _id: orderId,
            orderNumber: newOrderNumber(),
            user: userId,
            module,
            items: lines.map((l) => ({
                product: l.productId,
                variant: l.variantId,
                name: l.name,
                variantLabel: l.variantLabel,
                sku: l.sku,
                image: l.image,
                unit: l.unit,
                unitQty: l.unitQty,
                mrpPaise: l.mrpPaise,
                unitPricePaise: l.unitPricePaise,
                qty: l.qty,
                lineTotalPaise: l.lineTotalPaise,
                gstRate: l.gstRate,
                taxPaise: Math.round((l.lineTotalPaise * l.gstRate) / (100 + l.gstRate))
            })),
            address: { ...addressFields, ...(location?.coordinates ? { location } : {}) },
            customerPhone: address.phone || user.phone,
            zone: zone._id,
            slot: slot ? { id: slot.id, date: slot.date, start: slot.start, end: slot.end, label: slot.label } : undefined,
            pricing,
            originalTotalPaise: pricing.totalPaise,
            coupon: coupon ? { code: coupon.code, discountPaise: pricing.discountPaise, coupon: coupon._id } : undefined,
            payment: { method: paymentMethod, status: 'pending' },
            status,
            statusHistory: [{ status, by: actor }],
            notes,
            paymentDueBy: online ? new Date(Date.now() + PAYMENT_WINDOW_MINUTES * 60_000) : null
        });
        for (let attempt = 0; ; attempt += 1) {
            try {
                await order.save();
                break;
            } catch (err) {
                if (err?.code === 11000 && err.keyPattern?.orderNumber && attempt < 3) {
                    order.orderNumber = newOrderNumber();
                    continue;
                }
                throw err;
            }
        }
        undo.push(() => Order.deleteOne({ _id: orderId }));

        let gatewayPayment = null;
        if (online) {
            gatewayPayment = await createGatewayPayment({ userId, refType: 'order', refId: orderId, amountPaise: pricing.totalPaise });
            await Order.updateOne({ _id: orderId }, { $set: { 'payment.paymentId': gatewayPayment.paymentId } });
            order.payment.paymentId = gatewayPayment.paymentId;
        }

        await removeLines(userId, lines);
        if (!online) notifyCustomer(order, 'placed');
        return { order: order.toObject(), payment: gatewayPayment };
    } catch (err) {
        await rollback(undo);
        throw err;
    }
};

const loadOrder = async (orderId, { userId, allowedModules } = {}) => {
    if (!mongoose.isValidObjectId(orderId)) throw new NotFoundError('Order not found');
    const order = await Order.findById(orderId);
    if (!order || (userId && String(order.user) !== String(userId))) throw new NotFoundError('Order not found');
    if (allowedModules && !allowedModules.includes(order.module)) throw new ForbiddenError(`No access to the ${order.module} module`);
    return order;
};

/** Money was captured online for this order (whether or not part of it has gone back since). */
const paidOnline = (order) =>
    order.payment.method === 'online' && ['paid', 'refund_pending', 'partially_refunded'].includes(order.payment.status);

/** Asks the gateway for a refund; a gateway failure leaves it flagged for staff to retry instead of failing the action. */
const requestRefund = async (order, amountPaise, reason) => {
    if (amountPaise <= 0 || !order.payment.paymentId) return;
    await Order.updateOne({ _id: order._id }, { $inc: { 'payment.refundPendingPaise': amountPaise }, $set: { 'payment.status': 'refund_pending' } });
    try {
        await initiateRefund(order.payment.paymentId, amountPaise, reason);
    } catch (err) {
        logger.error({ err: err.message, order: order.orderNumber }, 'Refund request failed; retry from the order page');
    }
};

/**
 * Cancels an order still in one of `allowed` statuses and gives back what it
 * held: stock (except lines found unavailable), slot, coupon use, and money
 * if it was paid online.
 */
export const cancelOrder = async (orderId, { by, reason = '', allowed = CANCELLABLE_BY_STAFF, userId, allowedModules } = {}) => {
    const current = await loadOrder(orderId, { userId, allowedModules });
    const order = await Order.findOneAndUpdate(
        { _id: current._id, status: { $in: allowed } },
        {
            $set: { status: 'cancelled', cancelReason: reason, paymentDueBy: null },
            $push: { statusHistory: { status: 'cancelled', by, note: reason } }
        },
        { new: true }
    );
    if (!order) throw new ConflictError(`This order can't be cancelled now (it is ${STATUS_LABELS[current.status].toLowerCase()})`);

    const undo = [];
    for (const line of order.items.filter((l) => l.status === 'ok')) {
        undo.push(() => adjustStock({ productId: line.product, variantId: line.variant, delta: line.qty, reason: 'order_cancelled', refId: order._id, actor: by }));
    }
    if (order.slot?.id) undo.push(() => releaseSlot(order.slot.id));
    if (order.coupon?.code) undo.push(() => releaseCoupon(order._id));
    await rollback(undo); // "rollback" here simply runs each give-back step, tolerating failures

    // Earlier partial refunds (unavailable items) already took their share out of pricing.totalPaise.
    if (paidOnline(order)) {
        await requestRefund(order, order.pricing.totalPaise, `Order ${order.orderNumber} cancelled`);
    }
    notifyCustomer(order, 'cancelled', paidOnline(order) ? 'Your refund has been started.' : '');
    return Order.findById(order._id).lean();
};

/** Moves an order one step along its flow. Cancelling goes through cancelOrder. */
export const advanceStatus = async (orderId, { to, by, note = '', allowedModules }) => {
    const current = await loadOrder(orderId, { allowedModules });
    if (to === 'cancelled') return cancelOrder(orderId, { by, reason: note, allowedModules });
    if (!canMove(current.status, to)) {
        throw new ConflictError(`An order that is "${STATUS_LABELS[current.status]}" can't move to "${STATUS_LABELS[to]}"`);
    }
    const set = { status: to };
    // Cash on delivery is collected at the door.
    if (to === 'delivered' && current.payment.method === 'cod') set['payment.status'] = 'paid';

    const order = await Order.findOneAndUpdate(
        { _id: current._id, status: current.status },
        { $set: set, $push: { statusHistory: { status: to, by, note } } },
        { new: true }
    ).lean();
    if (!order) throw new ConflictError('This order was updated by someone else. Reload and try again.');
    notifyCustomer(order, to);
    return order;
};

/**
 * Marks a line the store can't supply (scope §3, §4). The order is re-priced
 * without it, keeping the original delivery fee and never increasing the
 * coupon discount; an online payment gets the difference refunded. If
 * nothing is left the order is cancelled.
 */
export const markItemUnavailable = async (orderId, lineId, { by, note = '', allowedModules }) => {
    const order = await loadOrder(orderId, { allowedModules });
    if (!ITEM_EDITABLE.includes(order.status)) throw new ConflictError('Items can only be changed before the order is packed');
    const line = order.items.id(lineId);
    if (!line) throw new NotFoundError('Item not found on this order');
    if (line.status === 'unavailable') return order.toObject();

    line.status = 'unavailable';
    if (order.items.every((l) => l.status === 'unavailable')) {
        await order.save();
        return cancelOrder(order._id, { by, reason: 'None of the items were available', allowedModules });
    }

    const previousTotal = order.pricing.totalPaise;
    let fixedDiscountPaise = 0;
    if (order.coupon?.coupon) {
        // Recomputed on the smaller subtotal, never above what checkout gave,
        // and the coupon's minimum order isn't re-applied: the shortfall is ours.
        const coupon = await Coupon.findById(order.coupon.coupon).lean();
        const subtotal = order.items.filter((l) => l.status === 'ok').reduce((s, l) => s + l.unitPricePaise * l.qty, 0);
        fixedDiscountPaise = Math.min(order.coupon.discountPaise, coupon ? discountFor(coupon, subtotal) : order.coupon.discountPaise);
        order.coupon.discountPaise = fixedDiscountPaise;
    }
    const pricing = priceLines(order.items, { fixedDeliveryFeePaise: order.pricing.deliveryFeePaise, fixedDiscountPaise });
    order.pricing = pricing;
    order.statusHistory.push({ status: order.status, by, note: `${line.name} (${line.variantLabel}) unavailable${note ? `: ${note}` : ''}` });
    await order.save();

    const difference = previousTotal - pricing.totalPaise;
    if (paidOnline(order)) {
        await requestRefund(order, difference, `${line.name} unavailable on ${order.orderNumber}`);
    }
    notify(
        { ownerKind: 'user', ownerId: order.user },
        {
            title: `Item unavailable · #${order.orderNumber}`,
            body: `Sorry, ${line.name} (${line.variantLabel}) is not available. Your new total is ₹${pricing.totalPaise / 100}.`,
            type: 'order.item_unavailable',
            data: { orderId: String(order._id) }
        }
    ).catch(() => {});
    return Order.findById(order._id).lean();
};

/** Re-sends a refund that the gateway didn't accept the first time. */
export const retryRefund = async (orderId, { allowedModules }) => {
    const order = await loadOrder(orderId, { allowedModules });
    const payment = order.payment.paymentId ? await Payment.findById(order.payment.paymentId).lean() : null;
    if (!payment) throw new ValidationError('This order has no online payment');
    const requested = payment.refundRequests.reduce((sum, r) => sum + r.amountPaise, 0);
    const owed = order.originalTotalPaise - order.pricing.totalPaise + (order.status === 'cancelled' ? order.pricing.totalPaise : 0);
    const missing = owed - requested;
    if (missing <= 0) throw new ValidationError('Every refund for this order has already been requested');
    await initiateRefund(payment._id, missing, `Retry for ${order.orderNumber}`);
    return Order.findById(order._id).lean();
};

/** Cancels online orders whose payment never arrived, releasing their stock and slot. */
export const expireUnpaidOrders = async (now = new Date()) => {
    const due = await Order.find({ status: 'pending_payment', paymentDueBy: { $lte: now } }).select('_id').lean();
    for (const { _id } of due) {
        try {
            await cancelOrder(_id, { by: SYSTEM, reason: 'Payment was not completed in time', allowed: ['pending_payment'] });
        } catch (err) {
            if (!(err instanceof ConflictError)) logger.error({ err: err.message, orderId: String(_id) }, 'Expiring unpaid order failed');
        }
    }
    return due.length;
};

/** The gateway details for paying (or retrying payment on) a pending order. */
export const paymentDetails = async (userId, orderId) => {
    const order = await loadOrder(orderId, { userId });
    if (order.status !== 'pending_payment') throw new ConflictError('This order is not awaiting payment');
    const payment = await Payment.findById(order.payment.paymentId).lean();
    if (!payment) throw new NotFoundError('Payment not found');
    return { paymentId: String(payment._id), keyId: env.RAZORPAY_KEY_ID, gatewayOrderId: payment.gatewayOrderId, amountPaise: payment.amountPaise, currency: 'INR', payBy: order.paymentDueBy };
};

/** Puts what is still available from a past order back in the cart. */
export const reorder = async (userId, orderId) => {
    const order = await loadOrder(orderId, { userId });
    const skipped = [];
    for (const line of order.items) {
        try {
            await setItem(userId, { productId: line.product, variantId: line.variant, qty: line.qty });
        } catch {
            try {
                // Fall back to whatever quantity can still be bought.
                await setItem(userId, { productId: line.product, variantId: line.variant, qty: 1 });
                skipped.push({ name: line.name, variantLabel: line.variantLabel, reason: 'quantity_reduced' });
            } catch {
                skipped.push({ name: line.name, variantLabel: line.variantLabel, reason: 'unavailable' });
            }
        }
    }
    return { skipped };
};

// ─── Reads ───

export const getCustomerOrder = (userId, orderId) => loadOrder(orderId, { userId }).then((o) => o.toObject());

export const listCustomerOrders = async (userId, { status, page, limit }) => {
    const filter = { user: userId, ...(status === 'open' ? { status: { $nin: ['delivered', 'cancelled'] } } : status === 'past' ? { status: { $in: ['delivered', 'cancelled'] } } : {}) };
    const [items, total] = await Promise.all([
        Order.find(filter)
            .select('orderNumber module status pricing.totalPaise payment.method payment.status slot createdAt items.name items.image items.qty')
            .sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
        Order.countDocuments(filter)
    ]);
    return { items, page, limit, total, pages: Math.ceil(total / limit) };
};

export const getAdminOrder = async (orderId, { allowedModules }) => {
    const order = await loadOrder(orderId, { allowedModules });
    await order.populate([{ path: 'zone', select: 'name' }, { path: 'user', select: 'name phone' }]);
    const payment = order.payment.paymentId ? await Payment.findById(order.payment.paymentId).select('-__v').lean() : null;
    return { ...order.toObject(), paymentRecord: payment };
};

export const listAdminOrders = async ({ module, status, from, to, q, slotDate, page, limit }, { allowedModules }) => {
    const filter = {};
    if (module) {
        if (allowedModules && !allowedModules.includes(module)) throw new ForbiddenError(`No access to the ${module} module`);
        filter.module = module;
    } else if (allowedModules) {
        filter.module = { $in: allowedModules };
    }
    if (status === 'open') filter.status = { $in: ['placed', 'accepted', 'packing', 'ready', 'dispatched'] };
    else if (status) filter.status = status;
    if (from || to) filter.createdAt = { ...(from ? { $gte: from } : {}), ...(to ? { $lte: to } : {}) };
    if (slotDate) filter['slot.date'] = slotDate;
    if (q) {
        const rx = new RegExp(escapeRegex(q.trim()), 'i');
        filter.$or = [{ orderNumber: rx }, { customerPhone: rx }, { 'address.name': rx }];
    }
    const [items, total, counts] = await Promise.all([
        Order.find(filter)
            .select('orderNumber module status pricing.totalPaise payment customerPhone address.name address.pincode slot createdAt items.qty items.status')
            .sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
        Order.countDocuments(filter),
        Order.aggregate([
            { $match: { ...(filter.module ? { module: filter.module } : {}) } },
            { $group: { _id: '$status', n: { $sum: 1 } } }
        ])
    ]);
    return { items, page, limit, total, pages: Math.ceil(total / limit), statusCounts: Object.fromEntries(counts.map((c) => [c._id, c.n])) };
};

// ─── Payment events ───

let handlersRegistered = false;

/** Connects payment outcomes to orders. Called once at startup. */
export const registerOrderPaymentHandlers = () => {
    if (handlersRegistered) return;
    handlersRegistered = true;

    paymentEvents.on('paid', async (payment) => {
        if (payment.refType !== 'order') return;
        try {
            const order = await Order.findOneAndUpdate(
                { _id: payment.refId, status: 'pending_payment' },
                {
                    $set: { status: 'placed', 'payment.status': 'paid', paymentDueBy: null },
                    $push: { statusHistory: { status: 'placed', by: SYSTEM, note: 'Payment received' } }
                },
                { new: true }
            );
            if (order) return notifyCustomer(order, 'placed');

            // Paid after we had already cancelled it (e.g. payment window expired): give the money back.
            const late = await Order.findById(payment.refId);
            if (late?.status === 'cancelled') {
                await Order.updateOne({ _id: late._id }, { $set: { 'payment.status': 'paid' } });
                late.payment.status = 'paid';
                await requestRefund(late, payment.amountPaise, `Payment for cancelled order ${late.orderNumber}`);
            }
        } catch (err) {
            logger.error({ err: err.message, paymentId: String(payment._id) }, 'Applying payment to order failed');
        }
    });

    paymentEvents.on('refunded', async (payment) => {
        if (payment.refType !== 'order') return;
        try {
            const requested = payment.refundRequests.reduce((sum, r) => sum + r.amountPaise, 0);
            await Order.updateOne(
                { _id: payment.refId },
                {
                    $set: {
                        'payment.status': payment.status === 'refunded' ? 'refunded' : requested > payment.refundedPaise ? 'refund_pending' : 'partially_refunded',
                        'payment.refundPendingPaise': Math.max(0, requested - payment.refundedPaise)
                    }
                }
            );
        } catch (err) {
            logger.error({ err: err.message }, 'Applying refund to order failed');
        }
    });
};
