/** Mirrors backend/src/modules/orders/order.flow.js. */
export const STATUS_LABELS = {
    pending_payment: 'Awaiting payment',
    placed: 'New',
    accepted: 'Accepted',
    packing: 'Packing',
    ready: 'Ready',
    dispatched: 'Dispatched',
    delivered: 'Delivered',
    cancelled: 'Cancelled'
};

export const STATUS_TONES = {
    pending_payment: 'slate',
    placed: 'amber',
    accepted: 'amber',
    packing: 'amber',
    ready: 'amber',
    dispatched: 'green',
    delivered: 'green',
    cancelled: 'red'
};

const NEXT = { placed: 'accepted', accepted: 'packing', packing: 'ready', ready: 'dispatched', dispatched: 'delivered' };
export const NEXT_ACTION_LABELS = {
    accepted: 'Accept order',
    packing: 'Start packing',
    ready: 'Mark ready for dispatch',
    dispatched: 'Mark dispatched',
    delivered: 'Mark delivered'
};

export const nextStatus = (status) => NEXT[status] ?? null;
export const CANCELLABLE = ['pending_payment', 'placed', 'accepted', 'packing', 'ready'];
export const ITEM_EDITABLE = ['placed', 'accepted', 'packing'];

export const PAYMENT_LABELS = {
    pending: 'Pending',
    paid: 'Paid',
    failed: 'Failed',
    refund_pending: 'Refund pending',
    refunded: 'Refunded',
    partially_refunded: 'Partly refunded'
};
