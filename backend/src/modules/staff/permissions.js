/**
 * Admin-panel sections and the actions a sub-admin can be granted on each.
 * Super admins bypass these checks. Sections are added here as each module
 * of the scope lands, so a role editor can list them without code changes.
 */
export const PERMISSION_SECTIONS = Object.freeze([
    'dashboard',
    'catalog',
    'inventory',
    'orders',
    'bookings',
    'riders',
    'sellers',
    'payouts',
    'customers',
    'zones',
    'banners',
    'coupons',
    'reports',
    'settings',
    'staff'
]);

export const PERMISSION_ACTIONS = Object.freeze(['view', 'create', 'update', 'delete']);

/**
 * The four business modules in the scope. Ops staff are assigned to one or
 * more and only see catalogue and orders for those.
 */
export const BUSINESS_MODULES = Object.freeze(['grocery', 'produce', 'laundry', 'electronics']);

export const STAFF_ROLES = Object.freeze({
    ADMIN: 'admin',
    OPS: 'ops'
});

/** Drops unknown sections/actions so stored permissions can only ever be a subset of the catalogue. */
export const sanitizePermissions = (input = {}) => {
    const out = {};
    for (const section of PERMISSION_SECTIONS) {
        const actions = Array.isArray(input?.[section]) ? input[section] : [];
        const allowed = [...new Set(actions.filter((a) => PERMISSION_ACTIONS.includes(a)))];
        if (allowed.length) out[section] = allowed;
    }
    return out;
};

export const FULL_PERMISSIONS = Object.freeze(
    Object.fromEntries(PERMISSION_SECTIONS.map((s) => [s, [...PERMISSION_ACTIONS]]))
);
