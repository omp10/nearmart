import {
    Bell, Boxes, FileText, HandCoins, KeyRound, LayoutDashboard, Package, Percent, ShoppingBag, Store, Tags, Wallet
} from 'lucide-react';

/**
 * Sidebar entries, grouped under section headings. `selling` marks pages that
 * need an approved store; while the store is paused they show a notice.
 */
export const NAV_GROUPS = [
    { title: 'Home', items: [{ to: '/', label: 'Dashboard', icon: LayoutDashboard, selling: true }] },
    { title: 'Orders', items: [{ to: '/orders', label: 'Orders', icon: ShoppingBag, selling: true, badge: 'orders' }] },
    {
        title: 'Catalogue',
        items: [
            { to: '/products', label: 'Products', icon: Package, selling: true },
            { to: '/inventory', label: 'Inventory', icon: Boxes, selling: true }
        ]
    },
    {
        title: 'Money',
        items: [
            { to: '/earnings', label: 'Earnings', icon: Wallet, selling: true },
            { to: '/payouts', label: 'Payouts', icon: HandCoins, selling: true },
            { to: '/commission', label: 'Commission', icon: Percent, selling: true }
        ]
    },
    {
        title: 'Store',
        items: [
            { to: '/store', label: 'Store profile', icon: Store },
            { to: '/shops', label: 'Shops & categories', icon: Tags }
        ]
    },
    {
        title: 'Account',
        items: [
            { to: '/notifications', label: 'Notifications', icon: Bell, badge: 'notifications' },
            { to: '/documents', label: 'Documents', icon: FileText },
            { to: '/account', label: 'Password & sign out', icon: KeyRound }
        ]
    }
];
