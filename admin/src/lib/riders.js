/** Mirrors backend/src/modules/riders (rider.model.js, task.model.js). */
export const VEHICLES = [
    { id: 'bike', label: 'Motorbike' },
    { id: 'scooter', label: 'Scooter' },
    { id: 'cycle', label: 'Bicycle' },
    { id: 'car', label: 'Car' },
    { id: 'walk', label: 'On foot' }
];
export const VEHICLE_LABELS = Object.fromEntries(VEHICLES.map((v) => [v.id, v.label]));

export const TASK_KIND_LABELS = {
    order_delivery: 'Delivery',
    laundry_pickup: 'Laundry pickup',
    laundry_return: 'Laundry return'
};

export const TASK_STATUS_LABELS = {
    offered: 'Offered',
    accepted: 'Accepted',
    at_pickup: 'At pickup',
    picked_up: 'Picked up',
    at_drop: 'At drop',
    completed: 'Completed',
    failed: 'Failed',
    rejected: 'Rejected',
    expired: 'Offer expired',
    cancelled: 'Cancelled'
};

export const TASK_STATUS_TONES = {
    offered: 'slate',
    accepted: 'amber',
    at_pickup: 'amber',
    picked_up: 'amber',
    at_drop: 'amber',
    completed: 'green',
    failed: 'red',
    rejected: 'red',
    expired: 'slate',
    cancelled: 'red'
};

export const ACTIVE_TASK_STATUSES = ['offered', 'accepted', 'at_pickup', 'picked_up', 'at_drop'];
export const isActiveTask = (task) => ACTIVE_TASK_STATUSES.includes(task.status);

export const DEPOSIT_LABELS = { pending: 'Pending', confirmed: 'Confirmed', rejected: 'Rejected' };
export const DEPOSIT_TONES = { pending: 'amber', confirmed: 'green', rejected: 'red' };
export const DEPOSIT_MODES = { upi: 'UPI', store: 'Cash at store' };

/** Order statuses in which a delivery partner can be sent. */
export const ORDER_ASSIGNABLE = ['accepted', 'packing', 'ready', 'dispatched'];

/** Which leg a laundry booking needs next, or null when none can be assigned now. */
export const bookingTaskKind = (status) =>
    ['placed', 'pickup_scheduled'].includes(status) ? 'laundry_pickup' : ['weighed', 'processing', 'ready'].includes(status) ? 'laundry_return' : null;

export const refPath = (ref) => (ref?.type === 'booking' ? `/bookings/${ref.id}` : `/orders/${ref?.id}`);

export const mapsUrl = (loc) => `https://www.google.com/maps?q=${loc.lat},${loc.lng}`;

/** "just now", "3 min ago", "2 h ago", "4 days ago". */
export const ago = (date) => {
    if (!date) return '—';
    const mins = Math.max(0, Math.floor((Date.now() - new Date(date).getTime()) / 60_000));
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins} min ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours} h ago`;
    const days = Math.floor(hours / 24);
    return `${days} day${days === 1 ? '' : 's'} ago`;
};

/** Age without the "ago", for how long a task has been running. */
export const age = (date) => {
    const a = ago(date);
    return a === 'just now' ? '<1 min' : a.replace(' ago', '');
};
