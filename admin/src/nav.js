import {
    BadgePercent, Boxes, CalendarClock, ChartColumn, FolderTree, LayoutDashboard, MapPinned, Megaphone,
    Package, Settings, ShieldCheck, Shirt, ShoppingBag, Users, WashingMachine
} from 'lucide-react';

const PRODUCT_ONLY = ['grocery', 'produce', 'electronics'];
const LAUNDRY_ONLY = ['laundry'];

/** Where a page sends you when you switch to a module it doesn't apply to. */
export const MODULE_EQUIVALENT = {
    '/orders': '/bookings',
    '/bookings': '/orders',
    '/products': '/laundry-services',
    '/laundry-services': '/products'
};

/**
 * Sidebar entries, grouped under section headings. `section` is the
 * permission section that gates the entry; `modules`, when set, limits the
 * entry to those modules (laundry has bookings, not orders or products).
 */
export const NAV_GROUPS = [
    { title: 'Home', items: [{ to: '/', label: 'Dashboard', section: 'dashboard', icon: LayoutDashboard }] },
    {
        title: 'Operations',
        items: [
            { to: '/orders', label: 'Orders', section: 'orders', icon: ShoppingBag, modules: PRODUCT_ONLY },
            { to: '/bookings', label: 'Laundry bookings', section: 'bookings', icon: WashingMachine, modules: LAUNDRY_ONLY },
            { to: '/customers', label: 'Customers', section: 'customers', icon: Users }
        ]
    },
    {
        title: 'Catalogue',
        items: [
            { to: '/categories', label: 'Categories', section: 'catalog', icon: FolderTree },
            { to: '/products', label: 'Products', section: 'catalog', icon: Package, modules: PRODUCT_ONLY },
            { to: '/inventory', label: 'Inventory', section: 'inventory', icon: Boxes, modules: PRODUCT_ONLY },
            { to: '/laundry-services', label: 'Laundry services', section: 'catalog', icon: Shirt, modules: LAUNDRY_ONLY }
        ]
    },
    {
        title: 'Delivery setup',
        items: [
            { to: '/zones', label: 'Service areas', section: 'zones', icon: MapPinned },
            { to: '/slots', label: 'Slots', section: 'zones', icon: CalendarClock }
        ]
    },
    {
        title: 'Marketing',
        items: [
            { to: '/banners', label: 'Banners', section: 'banners', icon: Megaphone },
            { to: '/coupons', label: 'Coupons', section: 'coupons', icon: BadgePercent, modules: PRODUCT_ONLY }
        ]
    },
    {
        title: 'Business',
        items: [
            { to: '/reports', label: 'Reports', section: 'reports', icon: ChartColumn },
            { to: '/settings', label: 'Settings', section: 'settings', icon: Settings },
            { to: '/staff', label: 'Staff & roles', section: 'staff', icon: ShieldCheck }
        ]
    }
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
