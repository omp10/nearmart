import {
    Bell, Boxes, Clock, FileText, HandCoins, KeyRound, LayoutDashboard, Package, Percent, ShoppingBag, Store, Tags, Wallet
} from 'lucide-react';

/**
 * Sidebar entries, grouped under section headings. `catalogue` marks pages
 * that need an approved store; while the store is paused they show a notice.
 * Orders and money stay open to paused stores so they can finish their orders.
 */
export const NAV_GROUPS = [
    { title: 'Home', items: [{ to: '/', label: 'Dashboard', icon: LayoutDashboard }] },
    { title: 'Orders', items: [{ to: '/orders', label: 'Orders', icon: ShoppingBag, badge: 'orders' }] },
    {
        title: 'Catalogue',
        items: [
            { to: '/products', label: 'Products', icon: Package, catalogue: true },
            { to: '/inventory', label: 'Inventory', icon: Boxes, catalogue: true }
        ]
    },
    {
        title: 'Money',
        items: [
            { to: '/earnings', label: 'Earnings', icon: Wallet },
            { to: '/payouts', label: 'Payouts', icon: HandCoins },
            { to: '/commission', label: 'Commission', icon: Percent }
        ]
    },
    {
        title: 'Store',
        items: [
            { to: '/store', label: 'Store profile', icon: Store, end: true },
            { to: '/store/hours', label: 'Opening hours', icon: Clock },
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
