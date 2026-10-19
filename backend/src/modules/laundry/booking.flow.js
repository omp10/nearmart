/**
 * Laundry booking statuses (scope §5):
 *
 *   pending_payment ─(paid)→ placed → pickup_scheduled → picked_up → weighed
 *       → processing → ready → out_for_return → completed
 *
 * `weighed` is "received / weight confirmed": it is entered only through the
 * weighing action, which sets the final price. Bookings can be cancelled
 * until the clothes are picked up.
 */
export const BOOKING_STATUSES = Object.freeze([
    'pending_payment',
    'placed',
    'pickup_scheduled',
    'picked_up',
    'weighed',
    'processing',
    'ready',
    'out_for_return',
    'completed',
    'cancelled'
]);

/** Plain forward moves staff make. picked_up → weighed happens only by weighing. */
const FORWARD = {
    placed: 'pickup_scheduled',
    pickup_scheduled: 'picked_up',
    weighed: 'processing',
    processing: 'ready',
    ready: 'out_for_return',
    out_for_return: 'completed'
};

export const nextBookingStatus = (status) => FORWARD[status] ?? null;
export const canMoveBooking = (from, to) => FORWARD[from] === to;

export const CANCELLABLE = Object.freeze(['pending_payment', 'placed', 'pickup_scheduled']);
/** The return slot can be chosen once the final price is known and before the return trip. */
export const RETURN_SLOT_EDITABLE = Object.freeze(['weighed', 'processing', 'ready']);

export const BOOKING_LABELS = Object.freeze({
    pending_payment: 'Awaiting payment',
    placed: 'Booking placed',
    pickup_scheduled: 'Pickup scheduled',
    picked_up: 'Picked up',
    weighed: 'Weight confirmed',
    processing: 'Processing',
    ready: 'Ready',
    out_for_return: 'Out for return',
    completed: 'Completed',
    cancelled: 'Cancelled'
});

export const BOOKING_MESSAGES = Object.freeze({
    placed: 'We have received your laundry booking.',
    pickup_scheduled: 'Your pickup is confirmed.',
    picked_up: 'We have picked up your clothes.',
    processing: 'Your clothes are being cleaned.',
    ready: 'Your laundry is ready.',
    out_for_return: 'Your laundry is on its way back.',
    completed: 'Your laundry has been delivered. Thank you!',
    cancelled: 'Your booking has been cancelled.'
});
