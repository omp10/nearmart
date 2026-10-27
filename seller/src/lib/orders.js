/** Mirrors backend/src/modules/orders/order.flow.js, in the seller's words. */
export const STATUS_LABELS = {
    pending_payment: 'Awaiting payment',
    placed: 'New',
    accepted: 'Accepted',
    packing: 'Packing',
    ready: 'Ready for pickup',
    dispatched: 'Out for delivery',
    delivered: 'Delivered',
    cancelled: 'Cancelled'
};

export const STATUS_TONES = {
    pending_payment: 'slate',
    placed: 'red',
    accepted: 'amber',
    packing: 'amber',
    ready: 'blue',
    dispatched: 'blue',
    delivered: 'green',
    cancelled: 'slate'
};

/** Tabs on the Orders page, in the order a seller works through them. */
export const ORDER_TABS = [
    { key: 'open', label: 'Open' },
    { key: 'placed', label: 'New' },
    { key: 'accepted', label: 'Accepted' },
    { key: 'packing', label: 'Packing' },
    { key: 'ready', label: 'Ready' },
    { key: 'dispatched', label: 'Out for delivery' },
    { key: 'delivered', label: 'Delivered' },
    { key: 'cancelled', label: 'Cancelled' }
];

export const OPEN_STATUSES = ['placed', 'accepted', 'packing', 'ready', 'dispatched'];

/** The moves a seller makes; the delivery partner and Nearmart do the rest. */
const NEXT = { placed: 'accepted', accepted: 'packing', packing: 'ready' };
export const NEXT_ACTION_LABELS = {
    accepted: 'Accept order',
    packing: 'Start packing',
    ready: 'Ready for pickup'
};
export const nextStatus = (status) => NEXT[status] ?? null;

export const CANCELLABLE = ['placed', 'accepted', 'packing'];
export const ITEM_EDITABLE = ['placed', 'accepted', 'packing'];

export const PAYMENT_LABELS = {
    pending: 'Not paid yet',
    paid: 'Paid',
    failed: 'Failed',
    refund_pending: 'Refund pending',
    refunded: 'Refunded',
    partially_refunded: 'Partly refunded'
};
