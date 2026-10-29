import { useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router';
import { ChevronDown, KeyRound, Lock, LogOut, Menu, PauseCircle, X } from 'lucide-react';
import { useAuth } from '../auth/AuthProvider.jsx';
import { NAV_GROUPS } from '../nav.js';
import { BrandMark } from './Brand.jsx';
import NotificationBell, { useInbox } from './NotificationBell.jsx';
import { OrderAlertsPrompt, OrderAlertsToggle, useNewOrders, useOrderAlerts } from './OrderAlerts.jsx';

/** Approved and paused stores both finish their orders and see their money. */
export const isTrading = (seller) => seller?.status === 'approved' || seller?.status === 'suspended';

function StoreStatePill({ seller }) {
    if (seller.status === 'suspended') return <span className="rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-semibold text-red-700">Paused by Nearmart</span>;
    if (seller.isOpen && seller.tradingNow === false) {
        return <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700">● Outside opening hours</span>;
    }
    return seller.isOpen ? (
        <span className="rounded-full bg-brand-50 px-2 py-0.5 text-[11px] font-semibold text-brand-700">● Open for orders</span>
    ) : (
        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600">● Closed</span>
    );
}

function Sidebar({ onNavigate, onClose }) {
    const { seller } = useAuth();
    const { data: newOrders } = useNewOrders(isTrading(seller));
    const { data: inbox } = useInbox();
    const badges = { orders: newOrders?.total ?? 0, notifications: inbox?.unread ?? 0 };

    return (
        <div className="flex h-full flex-col">
            <div className="flex items-center justify-between gap-2 px-5 pt-5 pb-3">
                <BrandMark subtitle="Seller" />
                {onClose && (
                    <button type="button" className="btn-ghost px-2" onClick={onClose} aria-label="Close menu">
                        <X className="h-5 w-5" aria-hidden="true" />
                    </button>
                )}
            </div>

            <div className="mx-4 mb-2 flex items-center gap-3 rounded-xl border border-neutral-200 bg-neutral-50 p-3">
                {seller.store?.logo ? (
                    <img src={seller.store.logo} alt="" className="h-10 w-10 shrink-0 rounded-lg object-cover" />
                ) : (
                    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-brand-700 text-sm font-semibold text-white">{seller.businessName?.[0]?.toUpperCase()}</span>
                )}
                <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-neutral-900">{seller.businessName}</p>
                    <StoreStatePill seller={seller} />
                </div>
            </div>

            <nav className="flex-1 overflow-y-auto px-3 py-3" aria-label="Main">
                {NAV_GROUPS.map((g) => (
                    <div key={g.title} className="mb-5 last:mb-0">
                        <div className="mb-1.5 px-3 text-[11px] font-bold tracking-[0.14em] text-neutral-500 uppercase">{g.title}</div>
                        <div className="flex flex-col gap-0.5">
                            {g.items.map((item) => {
                                const count = item.badge ? badges[item.badge] : 0;
                                return (
                                    <NavLink
                                        key={item.to}
                                        to={item.to}
                                        end={item.to === '/' || item.end}
                                        onClick={onNavigate}
                                        className={({ isActive }) =>
                                            `flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm font-medium transition ${
                                                isActive ? 'bg-brand-700 text-white shadow-sm' : 'text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900'
                                            }`
                                        }
                                    >
                                        <item.icon className="h-4 w-4 shrink-0" strokeWidth={1.8} aria-hidden="true" />
                                        <span className="flex-1 truncate">{item.label}</span>
                                        {item.catalogue && seller.status === 'suspended' && <Lock className="h-3.5 w-3.5 shrink-0 opacity-60" aria-label="Locked while paused" />}
                                        {count > 0 && (
                                            <span className="min-w-5 rounded-full bg-red-600 px-1.5 text-center text-[11px] font-semibold leading-5 text-white" aria-label={`${count} new`}>
                                                {count > 99 ? '99+' : count}
                                            </span>
                                        )}
                                    </NavLink>
                                );
                            })}
                        </div>
                    </div>
                ))}
            </nav>
        </div>
    );
}

function ProfileMenu() {
    const { seller, logout } = useAuth();
    const [open, setOpen] = useState(false);
    const ref = useRef(null);

    useEffect(() => {
        if (!open) return undefined;
        const close = (e) => !ref.current?.contains(e.target) && setOpen(false);
        document.addEventListener('mousedown', close);
        return () => document.removeEventListener('mousedown', close);
    }, [open]);

    return (
        <div className="relative" ref={ref}>
            <button type="button" className="flex items-center gap-3 rounded-xl p-1 text-left hover:bg-neutral-100 sm:pl-3" aria-expanded={open} aria-label="Account menu" onClick={() => setOpen((o) => !o)}>
                <span className="hidden leading-tight sm:block">
                    <span className="block max-w-48 truncate text-sm font-semibold text-neutral-900">{seller.ownerName}</span>
                    <span className="block max-w-48 truncate text-xs text-neutral-500">{seller.email}</span>
                </span>
                <span className="grid h-9 w-9 place-items-center rounded-full bg-brand-700 text-sm font-semibold text-white sm:hidden">{seller.ownerName?.[0]?.toUpperCase()}</span>
                <ChevronDown className="hidden h-4 w-4 text-neutral-500 sm:block" aria-hidden="true" />
            </button>
            {open && (
                <div className="absolute right-0 z-30 mt-2 w-64 rounded-xl border border-neutral-200 bg-white p-1 shadow-lg">
                    <div className="border-b border-neutral-100 px-3 py-2.5">
                        <div className="truncate text-sm font-semibold">{seller.ownerName}</div>
                        <div className="truncate text-xs text-neutral-500">{seller.email}</div>
                        <div className="truncate text-xs text-neutral-500">{seller.phone}</div>
                    </div>
                    {(seller.status === 'approved' || seller.status === 'suspended') && (
                        <NavLink to="/account" className="mt-1 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-neutral-700 hover:bg-neutral-100" onClick={() => setOpen(false)}>
                            <KeyRound className="h-4 w-4" aria-hidden="true" />
                            Change password
                        </NavLink>
                    )}
                    <button type="button" className="mt-1 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-red-600 hover:bg-red-50" onClick={logout}>
                        <LogOut className="h-4 w-4" aria-hidden="true" />
                        Sign out
                    </button>
                </div>
            )}
        </div>
    );
}

export function SuspendedBanner({ seller }) {
    return (
        <div className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800" role="alert">
            <PauseCircle className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
            <div>
                <p className="font-semibold">Your store is paused by Nearmart</p>
                <p className="mt-0.5">{seller.rejectionReason || 'Customers cannot see your products right now.'}</p>
                <p className="mt-1 text-xs text-red-700">
                    You can still accept, pack and hand over orders you've already received, see your earnings and payouts, and update your store profile and documents.
                    Products and stock are locked until Nearmart resumes your store. Please contact Nearmart support to resume selling.
                </p>
            </div>
        </div>
    );
}

/** Header used by every signed-in screen: menu button (phones), title, bell, account. */
export function TopBar({ onMenu, actions, children }) {
    return (
        <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-neutral-200 bg-white/90 px-4 backdrop-blur lg:h-[72px] lg:px-8">
            {onMenu && (
                <button type="button" className="btn-ghost px-2 lg:hidden" onClick={onMenu} aria-label="Open menu">
                    <Menu className="h-5 w-5" aria-hidden="true" />
                </button>
            )}
            <div className="flex min-w-0 flex-1 items-center">{children}</div>
            <div className="flex items-center gap-2 sm:gap-3">
                {actions}
                <NotificationBell />
                <div className="hidden h-8 w-px bg-neutral-200 sm:block" aria-hidden="true" />
                <ProfileMenu />
            </div>
        </header>
    );
}

export default function AppLayout() {
    const { seller } = useAuth();
    const [menuOpen, setMenuOpen] = useState(false);
    const location = useLocation();
    const trading = isTrading(seller);
    useOrderAlerts(trading);

    // Close the drawer on navigation (e.g. from a notification) and on Esc.
    useEffect(() => setMenuOpen(false), [location.pathname]);
    useEffect(() => {
        if (!menuOpen) return undefined;
        const onKey = (e) => e.key === 'Escape' && setMenuOpen(false);
        document.addEventListener('keydown', onKey);
        document.body.style.overflow = 'hidden';
        return () => {
            document.removeEventListener('keydown', onKey);
            document.body.style.overflow = '';
        };
    }, [menuOpen]);

    return (
        <div className="min-h-screen lg:grid lg:grid-cols-[272px_1fr]">
            <aside className="sticky top-0 hidden h-screen border-r border-neutral-200 bg-white lg:block">
                <Sidebar />
            </aside>

            {menuOpen && (
                <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Menu">
                    <button type="button" className="absolute inset-0 bg-neutral-900/40" aria-label="Close menu" onClick={() => setMenuOpen(false)} />
                    <aside className="relative z-10 h-full w-[17.5rem] max-w-[85vw] bg-white shadow-xl">
                        <Sidebar onNavigate={() => setMenuOpen(false)} onClose={() => setMenuOpen(false)} />
                    </aside>
                </div>
            )}

            <div className="flex min-w-0 flex-col">
                <TopBar onMenu={() => setMenuOpen(true)} actions={trading && <OrderAlertsToggle />}>
                    <p className="truncate text-sm font-semibold text-neutral-900 lg:hidden">{seller.businessName}</p>
                </TopBar>
                <main className="flex-1 space-y-6 p-4 lg:p-8">
                    {seller.status === 'suspended' && <SuspendedBanner seller={seller} />}
                    {trading && <OrderAlertsPrompt />}
                    <Outlet />
                </main>
            </div>
        </div>
    );
}
