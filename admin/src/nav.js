import {
    BadgePercent, Bike, Boxes, CalendarClock, ChartColumn, FolderTree, LayoutDashboard, MapPinned, Megaphone,
    Package, Settings, ShieldCheck, Shirt, ShoppingBag, Sparkles, Store, Users, Wallet, WashingMachine
} from 'lucide-react';

/** The Global view: things shared by every module (customers, settings, staff). */
export const GLOBAL = 'global';
const MODULES = ['grocery', 'produce', 'laundry', 'electronics'];
const PRODUCT = ['grocery', 'produce', 'electronics'];
const LAUNDRY = ['laundry'];
const EVERYWHERE = [GLOBAL, ...MODULES];

/** Where a page sends you when you switch to a view it doesn't apply to. */
export const MODULE_EQUIVALENT = {
    '/orders': '/bookings',
    '/bookings': '/orders',
    '/products': '/laundry-services',
    '/laundry-services': '/products'
};

/**
 * Sidebar entries, grouped under section headings. `section` is the
 * permission section that gates the entry; `views` lists where it appears:
 * Global, and/or the modules it applies to (laundry has bookings, not orders
 * or products). Empty groups are hidden.
 */
export const NAV_GROUPS = [
    { title: 'Home', items: [{ to: '/', label: 'Dashboard', section: 'dashboard', icon: LayoutDashboard, views: EVERYWHERE }] },
    {
        title: 'Operations',
        items: [
            { to: '/orders', label: 'Orders', section: 'orders', icon: ShoppingBag, views: PRODUCT },
            { to: '/bookings', label: 'Laundry bookings', section: 'bookings', icon: WashingMachine, views: LAUNDRY },
            { to: '/riders', label: 'Delivery partners', section: 'riders', icon: Bike, views: EVERYWHERE }
        ]
    },
    {
        title: 'Catalogue',
        items: [
            { to: '/categories', label: 'Categories', section: 'catalog', icon: FolderTree, views: MODULES },
            { to: '/products', label: 'Products', section: 'catalog', icon: Package, views: PRODUCT },
            { to: '/inventory', label: 'Inventory', section: 'inventory', icon: Boxes, views: PRODUCT },
            { to: '/laundry-services', label: 'Laundry services', section: 'catalog', icon: Shirt, views: LAUNDRY }
        ]
    },
    {
        title: 'People',
        items: [
            { to: '/customers', label: 'Customers', section: 'customers', icon: Users, views: [GLOBAL] },
            { to: '/sellers', label: 'Sellers', section: 'sellers', icon: Store, views: [GLOBAL] },
            { to: '/staff', label: 'Staff & roles', section: 'staff', icon: ShieldCheck, views: [GLOBAL] }
        ]
    },
    {
        title: 'Money',
        items: [{ to: '/payouts', label: 'Payouts', section: 'payouts', icon: Wallet, views: [GLOBAL] }]
    },
    {
        title: 'Delivery setup',
        items: [
            { to: '/zones', label: 'Service areas', section: 'zones', icon: MapPinned, views: EVERYWHERE },
            { to: '/slots', label: 'Slots', section: 'zones', icon: CalendarClock, views: MODULES }
        ]
    },
    {
        title: 'Marketing',
        items: [
            { to: '/banners', label: 'Banners', section: 'banners', icon: Megaphone, views: EVERYWHERE },
            { to: '/offer-cards', label: 'Offer cards', section: 'banners', icon: Sparkles, views: MODULES },
            { to: '/coupons', label: 'Coupons', section: 'coupons', icon: BadgePercent, views: [GLOBAL, ...PRODUCT] }
        ]
    },
    {
        title: 'Business',
        items: [
            { to: '/reports', label: 'Reports', section: 'reports', icon: ChartColumn, views: EVERYWHERE },
            { to: '/settings', label: 'Settings', section: 'settings', icon: Settings, views: [GLOBAL] }
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
    { section: 'riders', label: 'Delivery partners' },
    { section: 'customers', label: 'Customers' },
    { section: 'sellers', label: 'Sellers' },
    { section: 'payouts', label: 'Seller payouts' },
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
