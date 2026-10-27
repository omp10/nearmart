import crypto from 'node:crypto';
import mongoose from 'mongoose';
import { env } from '../../config/env.js';
import { ConflictError, ForbiddenError, NotFoundError, TooManyRequestsError, ValidationError } from '../../lib/errors.js';
import { istDate } from '../../lib/istTime.js';
import { logger } from '../../lib/logger.js';
import { formatRupees, includedTax } from '../../lib/money.js';
import { escapeRegex } from '../../lib/pagination.js';
import { uniqueSlug } from '../../lib/slug.js';
import { getAddress } from '../customers/customer.service.js';
import { notify, notifyStaff } from '../notifications/notification.service.js';
import { gatewayConfig } from '../payments/gateway.config.js';
import { Payment } from '../payments/payment.model.js';
import { createGatewayPayment, initiateRefund, paymentEvents } from '../payments/payment.service.js';
import { assertCheckoutAllowed } from '../settings/settings.service.js';
import { releaseSlot, reserveSlot } from '../slots/slot.service.js';
import { User } from '../users/user.model.js';
import { zoneForAddress } from '../zones/zone.service.js';
import { BOOKING_LABELS, BOOKING_MESSAGES, CANCELLABLE, RETURN_SLOT_EDITABLE, canMoveBooking } from './booking.flow.js';
import { LaundryBooking } from './booking.model.js';
import { LaundryService, chargeFor } from './laundryService.model.js';

export const PAYMENT_WINDOW_MINUTES = 15;
const SYSTEM = { kind: 'system', id: null };
const MODULE = 'laundry';

const newBookingNumber = () =>
    `NL${istDate().slice(2).replaceAll('-', '')}${crypto.randomBytes(3).toString('hex').toUpperCase()}`;

const assertLaundryAccess = (allowedModules) => {
    if (allowedModules && !allowedModules.includes(MODULE)) throw new ForbiddenError('No access to the laundry module');
};

const tell = (booking, title, body, type) =>
    notify(
        { ownerKind: 'user', ownerId: booking.user },
        { title: `${title} · #${booking.bookingNumber}`, body, type, data: { bookingId: String(booking._id) } }
    ).catch((err) => logger.warn({ err: err.message }, 'Booking notification failed'));

const tellStatus = (booking, status, extra = '') =>
    tell(booking, BOOKING_LABELS[status], `${BOOKING_MESSAGES[status] ?? ''} ${extra}`.trim(), `booking.${status}`);

/** Tells laundry staff a pickup was booked (or, for prepaid, paid). */
const alertStaffNewBooking = (booking) =>
    notifyStaff(
        { module: MODULE, section: 'bookings' },
        {
            title: `New laundry pickup #${booking.bookingNumber}`,
            body: `${booking.items.map((l) => l.name).join(', ')} · pickup ${booking.pickupSlot?.date ?? ''} ${booking.pickupSlot?.label ?? ''}`.trim(),
            type: 'staff.booking.new',
            data: { bookingId: String(booking._id) }
        }
    );

const snapshotSlot =(s) => (s ? { id: s.id, date: s.date, start: s.start, end: s.end, label: s.label } : undefined);

// ─── Service catalogue ───

export const listServices = ({ activeOnly = false } = {}) =>
    LaundryService.find(activeOnly ? { isActive: true } : {}).sort({ sortOrder: 1, name: 1 }).lean();

export const createService = async (input) => LaundryService.create({ ...input, slug: await uniqueSlug(LaundryService, input.name) });

export const updateService = async (id, input) => {
    const service = await LaundryService.findById(id);
    if (!service) throw new NotFoundError('Service not found');
    if (input.name && input.name !== service.name) service.slug = await uniqueSlug(LaundryService, input.name, {}, service._id);
    Object.assign(service, input);
    return service.save();
};

export const deleteService = async (id) => {
    if (await LaundryBooking.exists({ 'items.service': id })) {
        throw new ConflictError('This service has bookings; switch it off instead');
    }
    const res = await LaundryService.deleteOne({ _id: id });
    if (!res.deletedCount) throw new NotFoundError('Service not found');
};

// ─── Booking ───

/**
 * Prices a booking on the customer's estimate. The final price is set when
 * the clothes are weighed (or counted) after pickup.
 */
export const quoteBooking = async (userId, { addressId, items }) => {
    const address = await getAddress(userId, addressId);
    const zone = await zoneForAddress(address, MODULE);
    if (!zone) throw new ValidationError('Laundry pickup is not available at that address yet');

    const ids = items.map((i) => String(i.serviceId));
    if (new Set(ids).size !== ids.length) throw new ValidationError('Each service can be added once');
    const services = await LaundryService.find({ _id: { $in: ids }, isActive: true }).lean();
    const byId = new Map(services.map((s) => [String(s._id), s]));

    const lines = items.map((i) => {
        const s = byId.get(String(i.serviceId));
        if (!s) throw new ValidationError('One of the chosen services is not available');
        return {
            service: s._id,
            name: s.name,
            pricingUnit: s.pricingUnit,
            ratePaise: s.ratePaise,
            minQty: s.minQty,
            gstRate: s.gstRate,
            estimatedQty: i.estimatedQty,
            estimatePaise: chargeFor(s, i.estimatedQty)
        };
    });

    const subtotal = lines.reduce((sum, l) => sum + l.estimatePaise, 0);
    if (zone.minOrderPaise && subtotal < zone.minOrderPaise) {
        throw new ValidationError(`The minimum booking here is ${formatRupees(zone.minOrderPaise)}`);
    }
    const freeAbove = zone.freeDeliveryAbovePaise;
    const deliveryFeePaise = freeAbove != null && subtotal >= freeAbove ? 0 : zone.deliveryFeePaise ?? 0;
    const pricing = {
        estimatePaise: subtotal,
        deliveryFeePaise,
        finalPaise: null,
        totalPaise: subtotal + deliveryFeePaise,
        taxPaise: lines.reduce((sum, l) => sum + includedTax(l.estimatePaise, l.gstRate), 0)
    };
    return { address, zone, lines, pricing };
};

/** Books a pickup. An online booking prepays the estimate; any difference is settled after weighing. */
export const createBooking = async (userId, { addressId, items, pickupSlotId, instructions = '', pickupNotes = '', paymentMethod }) => {
    if (paymentMethod === 'online' && !(await gatewayConfig()).enabled) throw new ValidationError('Online payment is not available right now');
    const { address, zone, lines, pricing } = await quoteBooking(userId, { addressId, items });
    if (paymentMethod === 'online' && pricing.totalPaise < 100) throw new ValidationError('Online payment needs a total of at least ₹1');
    await assertCheckoutAllowed({ paymentMethod, totalPaise: pricing.totalPaise });
    // Bookings hold pickup capacity; cap what one account can hold (see orders).
    const [unpaid, active] = await Promise.all([
        LaundryBooking.countDocuments({ user: userId, status: 'pending_payment' }),
        LaundryBooking.countDocuments({ user: userId, status: { $in: ['placed', 'pickup_scheduled'] } })
    ]);
    if (unpaid >= 3) throw new TooManyRequestsError('Please pay for or cancel your pending bookings first');
    if (active >= 5) throw new TooManyRequestsError('You already have several pickups booked. Please wait for them first.');

    const user = await User.findById(userId).select('phone').lean();
    const bookingId = new mongoose.Types.ObjectId();
    const online = paymentMethod === 'online';
    const status = online ? 'pending_payment' : 'placed';

    const slot = await reserveSlot(pickupSlotId, { module: MODULE, kind: 'pickup', zoneId: zone._id });
    try {
        const { location, ...addressFields } = address;
        const booking = new LaundryBooking({
            _id: bookingId,
            bookingNumber: newBookingNumber(),
            user: userId,
            zone: zone._id,
            address: { ...addressFields, ...(location?.coordinates ? { location } : {}) },
            customerPhone: address.phone || user.phone,
            items: lines,
            pickupSlot: snapshotSlot(slot),
            instructions,
            pickupNotes,
            pricing,
            payment: { method: paymentMethod },
            status,
            statusHistory: [{ status, by: { kind: 'user', id: userId } }],
            paymentDueBy: online ? new Date(Date.now() + PAYMENT_WINDOW_MINUTES * 60_000) : null
        });
        for (let attempt = 0; ; attempt += 1) {
            try {
                await booking.save();
                break;
            } catch (err) {
                if (err?.code === 11000 && err.keyPattern?.bookingNumber && attempt < 3) {
                    booking.bookingNumber = newBookingNumber();
                    continue;
                }
                throw err;
            }
        }

        let payment = null;
        if (online) {
            try {
                payment = await createGatewayPayment({ userId, refType: 'booking', refId: bookingId, amountPaise: pricing.totalPaise });
            } catch (err) {
                await LaundryBooking.deleteOne({ _id: bookingId });
                throw err;
            }
            await LaundryBooking.updateOne({ _id: bookingId }, { $set: { 'payment.paymentId': payment.paymentId } });
            booking.payment.paymentId = payment.paymentId;
        } else {
            tellStatus(booking, 'placed');
            alertStaffNewBooking(booking);
        }
        return { booking: booking.toObject(), payment };
    } catch (err) {
        await releaseSlot(slot.id).catch(() => {});
        throw err;
    }
};

const loadBooking = async (id, { userId, allowedModules } = {}) => {
    assertLaundryAccess(allowedModules);
    if (!mongoose.isValidObjectId(id)) throw new NotFoundError('Booking not found');
    const booking = await LaundryBooking.findById(id);
    if (!booking || (userId && String(booking.user) !== String(userId))) throw new NotFoundError('Booking not found');
    return booking;
};

const paidOnline = (b) => b.payment.method === 'online' && b.payment.paidPaise > 0;

const requestRefund = async (booking, amountPaise, reason) => {
    if (amountPaise <= 0 || !booking.payment.paymentId) return;
    await LaundryBooking.updateOne(
        { _id: booking._id },
        { $inc: { 'payment.refundPendingPaise': amountPaise }, $set: { 'payment.status': 'refund_pending' } }
    );
    try {
        await initiateRefund(booking.payment.paymentId, amountPaise, reason);
    } catch (err) {
        logger.error({ err: err.message, booking: booking.bookingNumber }, 'Booking refund request failed');
    }
};

export const cancelBooking = async (id, { by, reason = '', userId, allowedModules }) => {
    const current = await loadBooking(id, { userId, allowedModules });
    const booking = await LaundryBooking.findOneAndUpdate(
        { _id: current._id, status: { $in: CANCELLABLE } },
        { $set: { status: 'cancelled', cancelReason: reason, paymentDueBy: null }, $push: { statusHistory: { status: 'cancelled', by, note: reason } } },
        { new: true }
    );
    if (!booking) throw new ConflictError(`This booking can't be cancelled now (${BOOKING_LABELS[current.status].toLowerCase()})`);

    if (booking.pickupSlot?.id) await releaseSlot(booking.pickupSlot.id).catch(() => {});
    if (booking.returnSlot?.id) await releaseSlot(booking.returnSlot.id).catch(() => {});
    if (paidOnline(booking)) await requestRefund(booking, booking.payment.paidPaise, `Booking ${booking.bookingNumber} cancelled`);
    // Any delivery partner on this job is stood down (loaded lazily: the riders module depends on this one).
    import('../riders/task.service.js').then((m) => m.cancelTasksForRef(booking._id, reason || 'Cancelled')).catch(() => {});
    tellStatus(booking, 'cancelled', paidOnline(booking) ? 'Your refund has been started.' : '');
    if (by?.kind === 'user') {
        notifyStaff(
            { module: MODULE, section: 'bookings' },
            { title: `Pickup #${booking.bookingNumber} cancelled by customer`, body: reason, type: 'staff.booking.cancelled', data: { bookingId: String(booking._id) } }
        );
    }
    return LaundryBooking.findById(booking._id).lean();
};

/** One plain step forward. Completing the return also records that any balance was collected. */
export const advanceBooking = async (id, { to, by, note = '', allowedModules }) => {
    const current = await loadBooking(id, { allowedModules });
    if (to === 'weighed') throw new ValidationError('Use "confirm weight" to record the weighed quantities');
    if (!canMoveBooking(current.status, to)) {
        throw new ConflictError(`A booking that is "${BOOKING_LABELS[current.status]}" can't move to "${BOOKING_LABELS[to]}"`);
    }
    const set = { status: to };
    let collectedNote = '';
    if (to === 'completed' && current.payment.balanceDuePaise > 0) {
        collectedNote = `Collected ${formatRupees(current.payment.balanceDuePaise)} at return`;
        set['payment.balanceDuePaise'] = 0;
        if (current.payment.status === 'pending') set['payment.status'] = 'paid';
    }
    const booking = await LaundryBooking.findOneAndUpdate(
        { _id: current._id, status: current.status },
        { $set: set, $push: { statusHistory: { status: to, by, note: [note, collectedNote].filter(Boolean).join('. ') } } },
        { new: true }
    ).lean();
    if (!booking) throw new ConflictError('This booking was updated by someone else. Reload and try again.');
    tellStatus(booking, to);
    return booking;
};

/**
 * Records the weighed (or counted) quantity for every service on the booking
 * and fixes the final price (scope §5: "received / weight confirmed").
 *
 * Settling the difference with the estimate (to confirm with the client):
 * cash bookings pay the final amount at return; prepaid bookings are refunded
 * if the final is lower, or pay the balance at return if it is higher.
 */
export const weighBooking = async (id, { lines, note = '', by, allowedModules }) => {
    const booking = await loadBooking(id, { allowedModules });
    if (booking.status !== 'picked_up') throw new ConflictError('Weigh a booking after its pickup');

    const given = new Map(lines.map((l) => [String(l.lineId), l.finalQty]));
    if (given.size !== booking.items.length || booking.items.some((l) => !given.has(String(l._id)))) {
        throw new ValidationError('Enter the weighed quantity for every service on the booking');
    }
    for (const line of booking.items) {
        line.finalQty = given.get(String(line._id));
        line.finalPaise = chargeFor(line, line.finalQty);
    }
    const itemsTotal = booking.items.reduce((sum, l) => sum + l.finalPaise, 0);
    const finalPaise = itemsTotal + booking.pricing.deliveryFeePaise;
    booking.pricing.finalPaise = finalPaise;
    booking.pricing.totalPaise = finalPaise;
    booking.pricing.taxPaise = booking.items.reduce((sum, l) => sum + includedTax(l.finalPaise, l.gstRate), 0);

    const paid = booking.payment.paidPaise;
    const refundDue = paid > finalPaise ? paid - finalPaise : 0;
    booking.payment.balanceDuePaise = Math.max(0, finalPaise - paid);
    const summary = booking.items.map((l) => `${l.name}: ${l.finalQty} ${l.pricingUnit}`).join(', ');
    booking.status = 'weighed';
    booking.statusHistory.push({ status: 'weighed', by, note: [summary, note].filter(Boolean).join('. ') });

    // Guard against a concurrent change between load and save.
    const saved = await LaundryBooking.findOneAndUpdate(
        { _id: booking._id, status: 'picked_up' },
        {
            $set: {
                items: booking.items.map((l) => l.toObject()),
                pricing: booking.pricing.toObject ? booking.pricing.toObject() : booking.pricing,
                'payment.balanceDuePaise': booking.payment.balanceDuePaise,
                status: 'weighed',
                statusHistory: booking.statusHistory.map((h) => (h.toObject ? h.toObject() : h))
            }
        },
        { new: true }
    );
    if (!saved) throw new ConflictError('This booking was updated by someone else. Reload and try again.');

    if (refundDue) await requestRefund(saved, refundDue, `Weighed below estimate on ${saved.bookingNumber}`);
    const money = refundDue
        ? `We are refunding ${formatRupees(refundDue)}.`
        : booking.payment.balanceDuePaise
            ? `${formatRupees(booking.payment.balanceDuePaise)} is payable when we return your clothes.`
            : '';
    tell(saved, 'Weight confirmed', `${summary}. Final amount ${formatRupees(finalPaise)}. ${money}`.trim(), 'booking.weighed');
    return LaundryBooking.findById(saved._id).lean();
};

/** Books (or changes) the return delivery slot. The customer or staff can choose it once the clothes are weighed. */
export const setReturnSlot = async (id, slotId, { by, userId, allowedModules }) => {
    const booking = await loadBooking(id, { userId, allowedModules });
    if (!RETURN_SLOT_EDITABLE.includes(booking.status)) throw new ConflictError('The return slot can be chosen after weighing and before the return trip');
    if (booking.returnSlot?.id === slotId) return booking.toObject();

    const slot = await reserveSlot(slotId, { module: MODULE, kind: 'return', zoneId: booking.zone });
    const previous = booking.returnSlot?.id;
    const updated = await LaundryBooking.findOneAndUpdate(
        { _id: booking._id, status: { $in: RETURN_SLOT_EDITABLE } },
        { $set: { returnSlot: snapshotSlot(slot) }, $push: { statusHistory: { status: booking.status, by, note: `Return slot: ${slot.date} ${slot.label}` } } },
        { new: true }
    ).lean();
    if (!updated) {
        await releaseSlot(slot.id);
        throw new ConflictError('This booking was updated by someone else. Reload and try again.');
    }
    if (previous) await releaseSlot(previous).catch(() => {});
    if (by.kind === 'staff') tell(updated, 'Return scheduled', `We will return your laundry on ${slot.date}, ${slot.label}.`, 'booking.return_scheduled');
    return updated;
};

export const retryBookingRefund = async (id, { allowedModules }) => {
    const booking = await loadBooking(id, { allowedModules });
    const payment = booking.payment.paymentId ? await Payment.findById(booking.payment.paymentId).lean() : null;
    if (!payment) throw new ValidationError('This booking has no online payment');
    const requested = payment.refundRequests.reduce((sum, r) => sum + r.amountPaise, 0);
    const owed = booking.status === 'cancelled' ? booking.payment.paidPaise : Math.max(0, booking.payment.paidPaise - (booking.pricing.finalPaise ?? booking.payment.paidPaise));
    if (owed - requested <= 0) throw new ValidationError('Every refund for this booking has already been requested');
    await initiateRefund(payment._id, owed - requested, `Retry for ${booking.bookingNumber}`);
    return LaundryBooking.findById(booking._id).lean();
};

export const expireUnpaidBookings = async (now = new Date()) => {
    const due = await LaundryBooking.find({ status: 'pending_payment', paymentDueBy: { $lte: now } }).select('_id').lean();
    for (const { _id } of due) {
        try {
            await cancelBooking(_id, { by: SYSTEM, reason: 'Payment was not completed in time' });
        } catch (err) {
            if (!(err instanceof ConflictError)) logger.error({ err: err.message }, 'Expiring unpaid booking failed');
        }
    }
    return due.length;
};

export const bookingPaymentDetails = async (userId, id) => {
    const booking = await loadBooking(id, { userId });
    if (booking.status !== 'pending_payment') throw new ConflictError('This booking is not awaiting payment');
    const payment = await Payment.findById(booking.payment.paymentId).lean();
    return { paymentId: String(payment._id), keyId: (await gatewayConfig()).keyId, gatewayOrderId: payment.gatewayOrderId, amountPaise: payment.amountPaise, currency: 'INR', payBy: booking.paymentDueBy };
};

// ─── Reads ───

export const getCustomerBooking = (userId, id) => loadBooking(id, { userId }).then((b) => b.toObject());

export const listCustomerBookings = async (userId, { status, page, limit }) => {
    const done = ['completed', 'cancelled'];
    const filter = { user: userId, ...(status === 'active' ? { status: { $nin: done } } : status === 'past' ? { status: { $in: done } } : {}) };
    const [items, total] = await Promise.all([
        LaundryBooking.find(filter)
            .select('bookingNumber status pricing payment.method payment.status payment.balanceDuePaise pickupSlot returnSlot items.name createdAt')
            .sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
        LaundryBooking.countDocuments(filter)
    ]);
    return { items, page, limit, total, pages: Math.ceil(total / limit) };
};

export const getAdminBooking = async (id, { allowedModules }) => {
    const booking = await loadBooking(id, { allowedModules });
    await booking.populate([{ path: 'zone', select: 'name' }, { path: 'user', select: 'name phone' }]);
    const payment = booking.payment.paymentId ? await Payment.findById(booking.payment.paymentId).select('-__v').lean() : null;
    return { ...booking.toObject(), paymentRecord: payment };
};

export const listAdminBookings = async ({ status, q, pickupDate, page, limit }, { allowedModules }) => {
    assertLaundryAccess(allowedModules);
    const filter = {};
    if (status === 'active') filter.status = { $nin: ['completed', 'cancelled', 'pending_payment'] };
    else if (status) filter.status = status;
    if (pickupDate) filter['pickupSlot.date'] = pickupDate;
    if (q) {
        const rx = new RegExp(escapeRegex(q.trim()), 'i');
        filter.$or = [{ bookingNumber: rx }, { customerPhone: rx }, { 'address.name': rx }];
    }
    const [items, total, counts] = await Promise.all([
        LaundryBooking.find(filter)
            .select('bookingNumber status pricing payment customerPhone address.name address.pincode pickupSlot returnSlot items.name items.estimatedQty items.finalQty items.pricingUnit createdAt')
            .sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
        LaundryBooking.countDocuments(filter),
        LaundryBooking.aggregate([{ $group: { _id: '$status', n: { $sum: 1 } } }])
    ]);
    return { items, page, limit, total, pages: Math.ceil(total / limit), statusCounts: Object.fromEntries(counts.map((c) => [c._id, c.n])) };
};

// ─── Payment events ───

let registered = false;
export const registerBookingPaymentHandlers = () => {
    if (registered) return;
    registered = true;

    paymentEvents.on('paid', async (payment) => {
        if (payment.refType !== 'booking') return;
        try {
            const booking = await LaundryBooking.findOneAndUpdate(
                { _id: payment.refId, status: 'pending_payment' },
                {
                    $set: { status: 'placed', 'payment.status': 'paid', 'payment.paidPaise': payment.amountPaise, paymentDueBy: null },
                    $push: { statusHistory: { status: 'placed', by: SYSTEM, note: 'Payment received' } }
                },
                { new: true }
            );
            if (booking) {
                alertStaffNewBooking(booking);
                return tellStatus(booking, 'placed');
            }

            const late = await LaundryBooking.findById(payment.refId);
            if (late?.status === 'cancelled') {
                await LaundryBooking.updateOne({ _id: late._id }, { $set: { 'payment.status': 'paid', 'payment.paidPaise': payment.amountPaise } });
                late.payment.paidPaise = payment.amountPaise;
                await requestRefund(late, payment.amountPaise, `Payment for cancelled booking ${late.bookingNumber}`);
            }
        } catch (err) {
            logger.error({ err: err.message }, 'Applying payment to booking failed');
        }
    });

    paymentEvents.on('refunded', async (payment) => {
        if (payment.refType !== 'booking') return;
        try {
            const requested = payment.refundRequests.reduce((sum, r) => sum + r.amountPaise, 0);
            await LaundryBooking.updateOne(
                { _id: payment.refId },
                {
                    $set: {
                        'payment.status': payment.status === 'refunded' ? 'refunded' : requested > payment.refundedPaise ? 'refund_pending' : 'partially_refunded',
                        'payment.refundPendingPaise': Math.max(0, requested - payment.refundedPaise)
                    }
                }
            );
        } catch (err) {
            logger.error({ err: err.message }, 'Applying refund to booking failed');
        }
    });
};
