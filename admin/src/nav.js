/**
 * Sidebar entries, in scope order (§7). `section` is the permission section
 * that gates the entry; `ready: false` marks modules not built yet, shown
 * disabled so the panel's shape is visible from Phase 0.
 */
export const NAV_ITEMS = [
    { to: '/', label: 'Dashboard', section: 'dashboard', ready: true },
    { to: '/categories', label: 'Categories', section: 'catalog', ready: true },
    { to: '/products', label: 'Products', section: 'catalog', ready: true },
    { to: '/inventory', label: 'Inventory', section: 'inventory', ready: true },
    { to: '/orders', label: 'Orders', section: 'orders', ready: true },
    { to: '/bookings', label: 'Laundry bookings', section: 'bookings', ready: true },
    { to: '/laundry-services', label: 'Laundry services', section: 'catalog', ready: true },
    { to: '/customers', label: 'Customers', section: 'customers', ready: true },
    { to: '/zones', label: 'Service areas', section: 'zones', ready: true },
    { to: '/slots', label: 'Slots', section: 'zones', ready: true },
    { to: '/banners', label: 'Banners', section: 'banners', ready: true },
    { to: '/coupons', label: 'Coupons', section: 'coupons', ready: true },
    { to: '/reports', label: 'Reports', section: 'reports', ready: true },
    { to: '/settings', label: 'Settings', section: 'settings', ready: true },
    { to: '/staff', label: 'Staff & roles', section: 'staff', ready: true }
];

/** Must match PERMISSION_SECTIONS / PERMISSION_ACTIONS / BUSINESS_MODULES in the backend. */
export const PERMISSION_SECTIONS = [
    { section: 'dashboard', label: 'Dashboard' },
    { section: 'catalog', label: 'Catalogue (categories & products)' },
    { section: 'inventory', label: 'Inventory' },
    { section: 'orders', label: 'Orders' },
    { section: 'bookings', label: 'Laundry bookings' },
    { section: 'customers', label: 'Customers' },
    { section: 'zones', label: 'Service areas & slots' },
    { section: 'banners', label: 'Banners' },
    { section: 'coupons', label: 'Coupons' },
    { section: 'reports', label: 'Reports' },
    { section: 'settings', label: 'Settings' },
    { section: 'staff', label: 'Staff & roles' }
];
export const PERMISSION_ACTIONS = ['view', 'create', 'update', 'delete'];
export const BUSINESS_MODULES = [
    { id: 'grocery', label: 'Grocery' },
    { id: 'produce', label: 'Vegetables & produce' },
    { id: 'laundry', label: 'Laundry' },
    { id: 'electronics', label: 'Electrical & electronics' }
];
