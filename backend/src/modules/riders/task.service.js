import { randomInt } from 'node:crypto';
import mongoose from 'mongoose';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../../lib/errors.js';
import { paginate } from '../../lib/pagination.js';
import { logger } from '../../lib/logger.js';
import { notify, notifyStaff } from '../notifications/notification.service.js';
import { Order } from '../orders/order.model.js';
import { advanceStatus } from '../orders/order.service.js';
import { LaundryBooking } from '../laundry/booking.model.js';
import { advanceBooking } from '../laundry/booking.service.js';
import { getSettings } from '../settings/settings.service.js';
import { Rider } from './rider.model.js';
import { ACTIVE_TASK_STATUSES, CashDeposit, DeliveryTask } from './task.model.js';
import { sellerPlace } from '../sellers/seller.service.js';

/** How long a partner has to accept an offer before it lapses and the store reassigns. */
export const OFFER_MINUTES = 10;
/** How close (metres) the partner must be to mark "arrived", when both positions are known. */
export const ARRIVAL_RADIUS_M = 1000;

const ORDER_ASSIGNABLE = ['accepted', 'packing', 'ready', 'dispatched'];
const PICKUP_ASSIGNABLE = ['placed', 'pickup_scheduled'];
const RETURN_ASSIGNABLE = ['weighed', 'processing', 'ready'];

const KIND_LABEL = { order_delivery: 'Delivery', laundry_pickup: 'Laundry pickup', laundry_return: 'Laundry return' };
const sectionFor = (kind) => (kind === 'order_delivery' ? 'orders' : 'bookings');
const rupees = (paise) => `₹${(paise / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

const riderRef = (id) => ({ kind: 'rider', id });

// ─── Helpers ───

const fromAddress = (a = {}) => {
    const [lng, lat] = a.location?.coordinates ?? [];
    return {
        name: a.name ?? '',
        phone: a.phone ?? '',
        address: [a.line1, a.line2, a.city, a.pincode].filter(Boolean).join(', '),
        landmark: a.landmark ?? '',
        lat: Number.isFinite(lat) ? lat : null,
        lng: Number.isFinite(lng) ? lng : null
    };
};

/** The store (or laundry) end of a trip, from the platform's contact settings. */
const storePlace = async (module) => {
    const s = await getSettings();
    const label = { grocery: 'Grocery', produce: 'Fresh Produce', laundry: 'Laundry', electronics: 'Electricals' }[module];
    return { name: `Nearmart ${label}`, phone: s.contact?.phone ?? '', address: s.contact?.address ?? '', landmark: '', lat: null, lng: null };
};

const metresBetween = (a, b) => {
    const toRad = (d) => (d * Math.PI) / 180;
    const dLat = toRad(b.lat - a.lat);
    const dLng = toRad(b.lng - a.lng);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
    return 2 * 6371000 * Math.asin(Math.sqrt(h));
};

const newOtp = () => String(randomInt(1000, 10000));

/** What leaves the server about a task (never the handover code). */
export const publicTask = (t) => {
    const rider = t.rider && typeof t.rider === 'object' && t.rider._id ? { _id: t.rider._id, name: t.rider.name, phone: t.rider.phone } : t.rider;
    const { otp, ...rest } = t;
    return { ...rest, rider, requiresOtp: Boolean(otp) || t.kind !== 'laundry_pickup' };
};

/** Offers nobody accepted in time lapse; the store is told so it can reassign. */
export const expireOffers = async (now = new Date()) => {
    const stale = await DeliveryTask.find({ status: 'offered', offerExpiresAt: { $lte: now } }).select('_id kind module ref').lean();
    for (const t of stale) {
        const done = await DeliveryTask.updateOne(
            { _id: t._id, status: 'offered' },
            { $set: { status: 'expired' }, $push: { timeline: { status: 'expired', note: 'Offer not accepted in time' } } }
        );
        if (done.modifiedCount) {
            notifyStaff(
                { module: t.module, section: sectionFor(t.kind) },
                { title: `${KIND_LABEL[t.kind]} #${t.ref.number} not accepted`, body: 'The delivery partner did not respond. Please assign someone else.', type: 'staff.task.expired', data: { [t.ref.type === 'order' ? 'orderId' : 'bookingId']: String(t.ref.id), taskId: String(t._id) } }
            );
        }
    }
};

const loadRiderTask = async (riderId, taskId) => {
    await expireOffers();
    const task = await DeliveryTask.findOne({ _id: taskId, rider: riderId }).select('+otp');
    if (!task) throw new NotFoundError('Task not found');
    return task;
};

const move = async (task, from, to, set = {}, note = '') => {
    const updated = await DeliveryTask.findOneAndUpdate(
        { _id: task._id, status: { $in: from } },
        { $set: { status: to, ...set }, $push: { timeline: { status: to, note } } },
        { new: true }
    )
        .populate('rider', 'name phone')
        .lean();
    if (!updated) throw new ConflictError('This task was updated elsewhere. Pull to refresh.');
    return publicTask(updated);
};

// ─── Staff: assign / cancel ───

export const createTask = async ({ kind, refId, riderId, payoutPaise }, { by, allowedModules }) => {
    const rider = await Rider.findById(riderId).lean();
    if (!rider) throw new NotFoundError('Delivery partner not found');
    if (!rider.isActive) throw new ConflictError(`${rider.name} is switched off`);

    let module;
    let ref;
    let pickup;
    let drop;
    let items = [];
    let slot = {};
    let notes = '';
    let payment = { method: 'online', collectPaise: 0 };

    if (kind === 'order_delivery') {
        const order = await Order.findById(refId).lean();
        if (!order) throw new NotFoundError('Order not found');
        if (!ORDER_ASSIGNABLE.includes(order.status)) throw new ConflictError('Only confirmed orders that are not yet delivered can be assigned');
        module = order.module;
        ref = { type: 'order', id: order._id, number: order.orderNumber };
        pickup = (order.seller?.id && (await sellerPlace(order.seller.id))) || (await storePlace(module));
        drop = fromAddress(order.address);
        items = order.items.filter((l) => l.status === 'ok').map((l) => ({ name: l.name, variantLabel: l.variantLabel, qty: l.qty }));
        slot = { date: order.slot?.date ?? '', label: order.slot?.label ?? '' };
        notes = order.notes ?? '';
        const due = order.payment.method === 'cod' && order.payment.status !== 'paid' ? order.pricing.totalPaise : 0;
        payment = { method: order.payment.method, collectPaise: due };
    } else {
        const booking = await LaundryBooking.findById(refId).lean();
        if (!booking) throw new NotFoundError('Booking not found');
        const allowed = kind === 'laundry_pickup' ? PICKUP_ASSIGNABLE : RETURN_ASSIGNABLE;
        if (!allowed.includes(booking.status)) {
            throw new ConflictError(kind === 'laundry_pickup' ? 'Pickups can be assigned before the clothes are collected' : 'Returns can be assigned once the booking is weighed');
        }
        module = 'laundry';
        ref = { type: 'booking', id: booking._id, number: booking.bookingNumber };
        const customer = fromAddress(booking.address);
        const laundry = await storePlace('laundry');
        [pickup, drop] = kind === 'laundry_pickup' ? [customer, laundry] : [laundry, customer];
        items = booking.items.map((l) => ({ name: l.name, variantLabel: l.pricingUnit === 'kg' ? 'kg' : 'pcs', qty: l.finalQty ?? l.estimatedQty }));
        const slotSnap = kind === 'laundry_pickup' ? booking.pickupSlot : booking.returnSlot;
        slot = { date: slotSnap?.date ?? '', label: slotSnap?.label ?? '' };
        notes = booking.instructions ?? '';
        payment = { method: booking.payment.method, collectPaise: kind === 'laundry_return' ? booking.payment.balanceDuePaise ?? 0 : 0 };
        if (booking.status === 'placed') {
            await advanceBooking(booking._id, { to: 'pickup_scheduled', by: { kind: 'staff', id: by }, note: `Pickup assigned to ${rider.name}` });
        }
    }

    if (allowedModules && !allowedModules.includes(module)) throw new ForbiddenError(`No access to the ${module} module`);
    if (rider.modules.length && !rider.modules.includes(module)) throw new ConflictError(`${rider.name} doesn't deliver for this shop`);
    await expireOffers();
    if (await DeliveryTask.exists({ 'ref.id': ref.id, kind, status: { $in: ACTIVE_TASK_STATUSES } })) {
        throw new ConflictError('A delivery partner is already assigned. Cancel that first to reassign.');
    }

    const needsOtp = kind !== 'laundry_pickup';
    const task = await DeliveryTask.create({
        kind,
        module,
        ref,
        rider: rider._id,
        pickup,
        drop,
        items,
        slot,
        notes,
        payment,
        otp: needsOtp ? newOtp() : null,
        payoutPaise: payoutPaise ?? rider.payoutPerTaskPaise,
        offerExpiresAt: new Date(Date.now() + OFFER_MINUTES * 60_000),
        assignedBy: by,
        timeline: [{ status: 'offered', note: 'Assigned by the store' }]
    });

    notify(
        { ownerKind: 'rider', ownerId: rider._id },
        {
            title: `New ${KIND_LABEL[kind].toLowerCase()} · #${ref.number}`,
            body: `${drop.address || pickup.address}${payment.collectPaise ? ` · collect ${rupees(payment.collectPaise)}` : ''}`,
            type: 'rider.task.offer',
            data: { taskId: String(task._id), expiresAt: task.offerExpiresAt.toISOString() }
        }
    ).catch((err) => logger.warn({ err: err.message }, 'Rider offer push failed'));

    const doc = await DeliveryTask.findById(task._id).populate('rider', 'name phone').lean();
    return publicTask(doc);
};

export const cancelTask = async (taskId, { reason, allowedModules }) => {
    const task = await DeliveryTask.findById(taskId).lean();
    if (!task) throw new NotFoundError('Task not found');
    if (allowedModules && !allowedModules.includes(task.module)) throw new ForbiddenError(`No access to the ${task.module} module`);
    const result = await move(task, ACTIVE_TASK_STATUSES, 'cancelled', {}, reason);
    notify(
        { ownerKind: 'rider', ownerId: task.rider },
        { title: `#${task.ref.number} was taken off you`, body: reason || 'The store reassigned this task.', type: 'rider.task.cancelled', data: { taskId: String(task._id) } }
    ).catch(() => {});
    return result;
};

/** Called when an order or booking is cancelled: its open tasks go too, and the partner is told. */
export const cancelTasksForRef = async (refId, reason = 'The order was cancelled') => {
    const open = await DeliveryTask.find({ 'ref.id': refId, status: { $in: ACTIVE_TASK_STATUSES } }).lean();
    for (const t of open) {
        await DeliveryTask.updateOne({ _id: t._id, status: { $in: ACTIVE_TASK_STATUSES } }, { $set: { status: 'cancelled' }, $push: { timeline: { status: 'cancelled', note: reason } } });
        notify(
            { ownerKind: 'rider', ownerId: t.rider },
            { title: `#${t.ref.number} cancelled`, body: reason, type: 'rider.task.cancelled', data: { taskId: String(t._id) } }
        ).catch(() => {});
    }
};

export const listTasks = async ({ status = 'active', riderId, refId, page = 1, limit = 20 }, { allowedModules } = {}) => {
    await expireOffers();
    const filter = {};
    if (status === 'active') filter.status = { $in: ACTIVE_TASK_STATUSES };
    else if (status === 'done') filter.status = { $nin: ACTIVE_TASK_STATUSES };
    if (riderId) filter.rider = riderId;
    if (refId) filter['ref.id'] = refId;
    if (allowedModules) filter.module = { $in: allowedModules };
    const result = await paginate(DeliveryTask, filter, { page, limit, sort: { createdAt: -1 } });
    const riders = await Rider.find({ _id: { $in: [...new Set(result.items.map((t) => String(t.rider)))] } }).select('name phone').lean();
    const byId = new Map(riders.map((r) => [String(r._id), r]));
    return { ...result, items: result.items.map((t) => publicTask({ ...t, rider: byId.get(String(t.rider)) ?? { _id: t.rider } })) };
};

// ─── Customer: who's coming, and the handover code ───

export const deliveryInfoFor = async (refId) => {
    const task = await DeliveryTask.findOne({ 'ref.id': refId, status: { $in: ['accepted', 'at_pickup', 'picked_up', 'at_drop'] } })
        .select('+otp kind status rider')
        .populate('rider', 'name phone vehicle lastLocation')
        .lean();
    if (!task) return null;
    const handover = task.kind === 'laundry_pickup' ? null : task.otp;
    return {
        kind: task.kind,
        status: task.status,
        otp: handover,
        rider: task.rider ? { name: task.rider.name, phone: task.rider.phone, vehicle: task.rider.vehicle } : null,
        location: ['picked_up', 'at_drop'].includes(task.status) && task.rider?.lastLocation?.lat != null ? task.rider.lastLocation : null
    };
};

// ─── Rider app ───

export const listRiderTasks = async (riderId, { status = 'active', from, to, page = 1, limit = 20 }) => {
    await expireOffers();
    const filter = { rider: riderId };
    if (status === 'active') filter.status = { $in: ACTIVE_TASK_STATUSES };
    else {
        filter.status = { $nin: ACTIVE_TASK_STATUSES };
        if (from || to) filter.updatedAt = { ...(from && { $gte: from }), ...(to && { $lte: to }) };
    }
    const result = await paginate(DeliveryTask, filter, { page, limit, sort: status === 'active' ? { createdAt: 1 } : { updatedAt: -1 } });
    return { ...result, items: result.items.map((t) => publicTask(t)) };
};

export const getRiderTask = async (riderId, taskId) => {
    const task = await loadRiderTask(riderId, taskId);
    return publicTask(task.toObject());
};

export const acceptTask = async (riderId, taskId) => {
    const task = await loadRiderTask(riderId, taskId);
    if (task.status === 'expired') throw new ConflictError('This offer has expired');
    const result = await move(task, ['offered'], 'accepted', { offerExpiresAt: null });
    const rider = await Rider.findById(riderId).select('name').lean();
    if (task.ref.type === 'order') {
        const order = await Order.findById(task.ref.id).select('user orderNumber').lean();
        if (order) {
            notify(
                { ownerKind: 'user', ownerId: order.user },
                {
                    title: 'Your delivery partner is assigned',
                    body: `${rider?.name ?? 'Our partner'} will deliver order #${order.orderNumber}. Share code ${task.otp} at the door.`,
                    type: 'order.rider_assigned',
                    data: { orderId: String(order._id) }
                }
            ).catch(() => {});
        }
    }
    return result;
};

export const rejectTask = async (riderId, taskId, { reason = '' }) => {
    const task = await loadRiderTask(riderId, taskId);
    const result = await move(task, ['offered'], 'rejected', {}, reason);
    notifyStaff(
        { module: task.module, section: sectionFor(task.kind) },
        { title: `${KIND_LABEL[task.kind]} #${task.ref.number} declined`, body: reason || 'The delivery partner declined. Please assign someone else.', type: 'staff.task.rejected', data: { [task.ref.type === 'order' ? 'orderId' : 'bookingId']: String(task.ref.id), taskId: String(task._id) } }
    );
    return result;
};

const checkNear = (place, at) => {
    if (place.lat == null || place.lng == null || at?.lat == null || at?.lng == null) return;
    const d = metresBetween(place, at);
    if (d > ARRIVAL_RADIUS_M) throw new ValidationError(`You're about ${(d / 1000).toFixed(1)} km away. Mark arrived when you reach.`);
};

export const markArrived = async (riderId, taskId, at) => {
    const task = await loadRiderTask(riderId, taskId);
    if (task.status === 'accepted') {
        checkNear(task.pickup, at);
        return move(task, ['accepted'], 'at_pickup');
    }
    if (task.status === 'picked_up') {
        checkNear(task.drop, at);
        return move(task, ['picked_up'], 'at_drop');
    }
    throw new ConflictError('Accept the task first, or mark it picked up');
};

export const markPickedUp = async (riderId, taskId, { photo } = {}) => {
    const task = await loadRiderTask(riderId, taskId);
    if (!['accepted', 'at_pickup'].includes(task.status)) throw new ConflictError('This task is not waiting for pickup');
    const by = riderRef(riderId);

    if (task.kind === 'order_delivery') {
        const order = await Order.findById(task.ref.id).select('status').lean();
        if (!order) throw new NotFoundError('Order not found');
        if (order.status === 'ready') await advanceStatus(order._id, { to: 'dispatched', by, note: 'Picked up by delivery partner' });
        else if (order.status !== 'dispatched') throw new ConflictError("The store hasn't packed this order yet");
    } else if (task.kind === 'laundry_pickup') {
        const booking = await LaundryBooking.findById(task.ref.id).select('status').lean();
        if (!booking) throw new NotFoundError('Booking not found');
        if (booking.status === 'placed') await advanceBooking(booking._id, { to: 'pickup_scheduled', by });
        if (['placed', 'pickup_scheduled'].includes(booking.status)) await advanceBooking(booking._id, { to: 'picked_up', by, note: 'Collected by delivery partner' });
        else if (booking.status !== 'picked_up') throw new ConflictError('This booking is no longer waiting for pickup');
    } else {
        const booking = await LaundryBooking.findById(task.ref.id).select('status').lean();
        if (!booking) throw new NotFoundError('Booking not found');
        if (booking.status === 'ready') await advanceBooking(booking._id, { to: 'out_for_return', by, note: 'Out with delivery partner' });
        else if (booking.status !== 'out_for_return') throw new ConflictError("The laundry isn't ready yet");
    }
    return move(task, ['accepted', 'at_pickup'], 'picked_up', photo ? { photos: [...task.photos, photo] } : {});
};

export const completeTask = async (riderId, taskId, { otp, collectedPaise = 0, collectionMode = 'cash', photo } = {}) => {
    const task = await loadRiderTask(riderId, taskId);
    if (!['picked_up', 'at_drop'].includes(task.status)) throw new ConflictError('Mark the task picked up first');
    if (task.otp && String(otp ?? '').trim() !== task.otp) throw new ValidationError("That code doesn't match. Ask the customer to check their app.");

    const by = riderRef(riderId);
    let due = 0;
    if (task.kind === 'order_delivery') {
        const order = await Order.findById(task.ref.id).select('status payment pricing').lean();
        if (!order) throw new NotFoundError('Order not found');
        due = order.payment.method === 'cod' && order.payment.status !== 'paid' ? order.pricing.totalPaise : 0;
        if (due && collectedPaise !== due) throw new ValidationError(`Collect ${rupees(due)} before completing`);
        if (order.status === 'ready') await advanceStatus(order._id, { to: 'dispatched', by });
        if (order.status !== 'delivered') await advanceStatus(order._id, { to: 'delivered', by, note: due ? `${rupees(due)} collected by ${collectionMode}` : 'Delivered by partner' });
    } else if (task.kind === 'laundry_return') {
        const booking = await LaundryBooking.findById(task.ref.id).select('status payment').lean();
        if (!booking) throw new NotFoundError('Booking not found');
        due = booking.payment.balanceDuePaise ?? 0;
        if (due && collectedPaise !== due) throw new ValidationError(`Collect ${rupees(due)} before completing`);
        if (booking.status === 'ready') await advanceBooking(booking._id, { to: 'out_for_return', by });
        if (booking.status !== 'completed') await advanceBooking(booking._id, { to: 'completed', by, note: due ? `Collected by ${collectionMode}` : 'Returned by partner' });
    }
    // A laundry pickup ends at the laundry; staff weigh it next.

    const result = await move(
        task,
        ['picked_up', 'at_drop'],
        'completed',
        { completedAt: new Date(), collected: due ? { paise: due, mode: collectionMode } : null, ...(photo && { photos: [...task.photos, photo] }) }
    );
    // UPI goes straight to the store; only cash stays with the partner until deposited.
    if (due && collectionMode === 'cash') await Rider.updateOne({ _id: riderId }, { $inc: { cashInHandPaise: due } });
    return result;
};

export const failTask = async (riderId, taskId, { reason, note = '' }) => {
    const task = await loadRiderTask(riderId, taskId);
    const result = await move(task, ['accepted', 'at_pickup', 'picked_up', 'at_drop'], 'failed', { failReason: reason, failNote: note }, note);
    notifyStaff(
        { module: task.module, section: sectionFor(task.kind) },
        {
            title: `${KIND_LABEL[task.kind]} #${task.ref.number} failed`,
            body: `${reason.replace(/_/g, ' ')}${note ? `: ${note}` : ''}. Please reschedule.`,
            type: 'staff.task.failed',
            data: { [task.ref.type === 'order' ? 'orderId' : 'bookingId']: String(task.ref.id), taskId: String(task._id) }
        }
    );
    return result;
};

// ─── Earnings & cash ───

export const riderEarnings = async (riderId, { from, to }) => {
    // Aggregations don't cast ids the way queries do.
    const match = { rider: new mongoose.Types.ObjectId(String(riderId)), status: 'completed', completedAt: { ...(from && { $gte: from }), ...(to && { $lte: to }) } };
    if (!from && !to) delete match.completedAt;
    const perDay = await DeliveryTask.aggregate([
        { $match: match },
        { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$completedAt', timezone: 'Asia/Kolkata' } }, deliveries: { $sum: 1 }, earningsPaise: { $sum: '$payoutPaise' } } },
        { $sort: { _id: -1 } }
    ]);
    return {
        totalPaise: perDay.reduce((s, d) => s + d.earningsPaise, 0),
        deliveries: perDay.reduce((s, d) => s + d.deliveries, 0),
        perDay: perDay.map((d) => ({ date: d._id, deliveries: d.deliveries, earningsPaise: d.earningsPaise }))
    };
};

export const riderCash = async (riderId) => {
    const [rider, pending] = await Promise.all([
        Rider.findById(riderId).select('cashInHandPaise').lean(),
        CashDeposit.find({ rider: riderId, status: 'pending' }).sort({ createdAt: -1 }).lean()
    ]);
    return { inHandPaise: rider?.cashInHandPaise ?? 0, pendingDeposits: pending };
};

export const requestDeposit = async (riderId, { amountPaise, mode, reference = '' }) => {
    const { inHandPaise, pendingDeposits } = await riderCash(riderId);
    const pendingTotal = pendingDeposits.reduce((s, d) => s + d.amountPaise, 0);
    if (amountPaise > inHandPaise - pendingTotal) throw new ValidationError(`You can deposit up to ${rupees(Math.max(0, inHandPaise - pendingTotal))}`);
    return (await CashDeposit.create({ rider: riderId, amountPaise, mode, reference })).toObject();
};

export const decideDeposit = async (depositId, { confirm, by }) => {
    const deposit = await CashDeposit.findOneAndUpdate(
        { _id: depositId, status: 'pending' },
        { $set: { status: confirm ? 'confirmed' : 'rejected', decidedBy: by, decidedAt: new Date() } },
        { new: true }
    ).lean();
    if (!deposit) throw new ConflictError('This deposit was already handled');
    if (confirm) await Rider.updateOne({ _id: deposit.rider }, { $inc: { cashInHandPaise: -deposit.amountPaise } });
    notify(
        { ownerKind: 'rider', ownerId: deposit.rider },
        { title: confirm ? 'Cash deposit confirmed' : 'Cash deposit not confirmed', body: `${rupees(deposit.amountPaise)} via ${deposit.mode}`, type: 'rider.deposit', data: { depositId: String(deposit._id) } }
    ).catch(() => {});
    return deposit;
};

export const listDeposits = async ({ status, page = 1, limit = 20 }) => {
    const result = await paginate(CashDeposit, status ? { status } : {}, { page, limit });
    const riders = await Rider.find({ _id: { $in: result.items.map((d) => d.rider) } }).select('name phone').lean();
    const byId = new Map(riders.map((r) => [String(r._id), r]));
    return { ...result, items: result.items.map((d) => ({ ...d, rider: byId.get(String(d.rider)) ?? { _id: d.rider } })) };
};
