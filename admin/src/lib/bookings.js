/** Mirrors backend/src/modules/laundry/booking.flow.js. */
export const BOOKING_LABELS = {
    pending_payment: 'Awaiting payment',
    placed: 'New',
    pickup_scheduled: 'Pickup scheduled',
    picked_up: 'Picked up',
    weighed: 'Weight confirmed',
    processing: 'Processing',
    ready: 'Ready',
    out_for_return: 'Out for return',
    completed: 'Completed',
    cancelled: 'Cancelled'
};

export const BOOKING_TONES = {
    pending_payment: 'slate',
    placed: 'amber',
    pickup_scheduled: 'amber',
    picked_up: 'amber',
    weighed: 'amber',
    processing: 'amber',
    ready: 'green',
    out_for_return: 'green',
    completed: 'green',
    cancelled: 'red'
};

const NEXT = { placed: 'pickup_scheduled', pickup_scheduled: 'picked_up', weighed: 'processing', processing: 'ready', ready: 'out_for_return', out_for_return: 'completed' };
export const nextBookingStatus = (s) => NEXT[s] ?? null;

export const BOOKING_ACTIONS = {
    pickup_scheduled: 'Confirm pickup',
    picked_up: 'Mark picked up',
    processing: 'Start processing',
    ready: 'Mark ready',
    out_for_return: 'Send out for return',
    completed: 'Mark returned'
};

export const BOOKING_CANCELLABLE = ['pending_payment', 'placed', 'pickup_scheduled'];
export const RETURN_SLOT_EDITABLE = ['weighed', 'processing', 'ready'];

export const formatQty = (qty, unit) => (qty == null ? '—' : `${qty} ${unit === 'kg' ? 'kg' : qty === 1 ? 'piece' : 'pieces'}`);
