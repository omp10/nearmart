import {
    BadgePercent, Boxes, CalendarClock, ChartColumn, FolderTree, LayoutDashboard, MapPinned, Megaphone,
    Package, Settings, ShieldCheck, Shirt, ShoppingBag, Users, WashingMachine
} from 'lucide-react';

/**
 * Sidebar entries, grouped under section headings. `section` is the
 * permission section that gates the entry.
 */
export const NAV_GROUPS = [
    { title: 'Home', items: [{ to: '/', label: 'Dashboard', section: 'dashboard', icon: LayoutDashboard }] },
    {
        title: 'Operations',
        items: [
            { to: '/orders', label: 'Orders', section: 'orders', icon: ShoppingBag },
            { to: '/bookings', label: 'Laundry bookings', section: 'bookings', icon: WashingMachine },
            { to: '/customers', label: 'Customers', section: 'customers', icon: Users }
        ]
    },
    {
        title: 'Catalogue',
        items: [
            { to: '/categories', label: 'Categories', section: 'catalog', icon: FolderTree },
            { to: '/products', label: 'Products', section: 'catalog', icon: Package },
            { to: '/inventory', label: 'Inventory', section: 'inventory', icon: Boxes },
            { to: '/laundry-services', label: 'Laundry services', section: 'catalog', icon: Shirt }
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
            { to: '/coupons', label: 'Coupons', section: 'coupons', icon: BadgePercent }
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
