/**
 * Order statuses and the moves allowed between them (scope §3, §4, §6).
 * Grocery, produce and electronics share one goods flow; laundry bookings
 * get their own in Phase 4.
 *
 *   pending_payment ─(paid)→ placed → accepted → packing → ready → dispatched → delivered
 *          └──────────── cancelled ←──────── (any step before dispatched)
 */
export const ORDER_STATUSES = Object.freeze([
    'pending_payment',
    'placed',
    'accepted',
    'packing',
    'ready',
    'dispatched',
    'delivered',
    'cancelled'
]);

/** Steps staff move an order through, in order. */
const FORWARD = { placed: 'accepted', accepted: 'packing', packing: 'ready', ready: 'dispatched', dispatched: 'delivered' };

/** Before dispatch an order can still be stopped. */
export const CANCELLABLE_BY_STAFF = Object.freeze(['pending_payment', 'placed', 'accepted', 'packing', 'ready']);
/** Customers may cancel until the store has started packing. */
export const CANCELLABLE_BY_CUSTOMER = Object.freeze(['pending_payment', 'placed', 'accepted']);
/** Items can be marked unavailable while the order is being put together. */
export const ITEM_EDITABLE = Object.freeze(['placed', 'accepted', 'packing']);
export const OPEN_STATUSES = Object.freeze(['pending_payment', 'placed', 'accepted', 'packing', 'ready', 'dispatched']);

export const nextStatus = (status) => FORWARD[status] ?? null;

export const canMove = (from, to) => FORWARD[from] === to || (to === 'cancelled' && CANCELLABLE_BY_STAFF.includes(from));

export const STATUS_LABELS = Object.freeze({
    pending_payment: 'Awaiting payment',
    placed: 'Order placed',
    accepted: 'Order confirmed',
    packing: 'Being packed',
    ready: 'Ready for dispatch',
    dispatched: 'Out for delivery',
    delivered: 'Delivered',
    cancelled: 'Cancelled'
});

/** What the customer is told at each step. */
export const CUSTOMER_MESSAGES = Object.freeze({
    placed: 'We have received your order.',
    accepted: 'Your order is confirmed.',
    packing: 'Your order is being packed.',
    ready: 'Your order is packed and ready for dispatch.',
    dispatched: 'Your order is out for delivery.',
    delivered: 'Your order has been delivered. Thank you!',
    cancelled: 'Your order has been cancelled.'
});
