import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { NavLink, Outlet, useNavigate } from 'react-router';
import { useAuth } from '../auth/AuthProvider.jsx';
import { api } from '../lib/api.js';
import { ModuleProvider, useCurrentModule } from '../lib/moduleContext.jsx';
import { GLOBAL, NAV_GROUPS } from '../nav.js';
import { ChevronDown, Globe, Leaf, LogOut, Menu, Plug, Search, Shirt, ShoppingCart, Store } from 'lucide-react';

// Each shop wears its quarter of the logo's bag (classes spelled out for Tailwind).
const MODULE_TABS = {
    [GLOBAL]: { label: 'Global', icon: Globe },
    grocery: { label: 'Grocery', icon: ShoppingCart, on: 'bg-shop-grocery', tint: 'text-shop-grocery' },
    produce: { label: 'Produce', icon: Leaf, on: 'bg-shop-produce', tint: 'text-shop-produce' },
    laundry: { label: 'Laundry', icon: Shirt, on: 'bg-shop-laundry', tint: 'text-shop-laundry' },
    electronics: { label: 'Electric', icon: Plug, on: 'bg-shop-electronics', tint: 'text-shop-electronics' }
};

const roleLabel = (user) => (user.isSuperAdmin ? 'Super admin' : user.role === 'ops' ? 'Operations' : 'Admin');

/** Nav groups the signed-in user may open in the selected view, narrowed by a search query. */
function useNavGroups(query = '') {
    const { can } = useAuth();
    const { view } = useCurrentModule();
    const q = query.trim().toLowerCase();
    // Everyone gets the dashboard as a landing page; its widgets check their own permissions.
    const shows = (item) =>
        (item.to === '/' || can(item.section)) && item.views.includes(view) && (!q || item.label.toLowerCase().includes(q));
    return NAV_GROUPS.map((g) => ({ ...g, items: g.items.filter(shows) })).filter((g) => g.items.length);
}

/** Pill tabs: Global (shared things) on its own row, then one per module. */
function ModuleSwitcher() {
    const { view, chooseModule, modules, canGlobal } = useCurrentModule();
    if (modules.length + (canGlobal ? 1 : 0) < 2) return null;

    const tabClass = (active, extra = '', on = 'bg-neutral-900') =>
        `flex min-w-0 items-center rounded-lg text-[11px] font-semibold transition ${
            active ? `${on} text-white shadow` : 'text-neutral-500 hover:bg-neutral-100 hover:text-neutral-800'
        } ${extra}`;
    const GlobalIcon = MODULE_TABS[GLOBAL].icon;

    return (
        <div role="radiogroup" aria-label="Module" className="space-y-1 rounded-xl border border-neutral-200 bg-white p-1 shadow-sm">
            {canGlobal && (
                <button
                    type="button"
                    role="radio"
                    aria-checked={view === GLOBAL}
                    title="Customers, settings, staff and every module together"
                    onClick={() => chooseModule(GLOBAL)}
                    className={tabClass(view === GLOBAL, 'w-full justify-center gap-1.5 px-2 py-1.5')}
                >
                    <GlobalIcon className="h-4 w-4" strokeWidth={1.8} aria-hidden="true" />
                    {MODULE_TABS[GLOBAL].label}
                </button>
            )}
            <div className="grid auto-cols-fr grid-flow-col gap-1">
                {modules.map((m) => {
                    const tab = MODULE_TABS[m.key] ?? { label: m.name, icon: Store };
                    const Icon = tab.icon;
                    return (
                        <button
                            key={m.key}
                            type="button"
                            role="radio"
                            aria-checked={m.key === view}
                            title={`${m.name}${m.isActive ? '' : ' (off)'}`}
                            onClick={() => chooseModule(m.key)}
                            className={tabClass(m.key === view, `flex-col gap-0.5 px-1 py-1.5 ${m.isActive ? '' : 'opacity-60'}`, tab.on)}
                        >
                            <Icon className={`h-4 w-4 ${m.key === view ? '' : (tab.tint ?? '')}`} strokeWidth={1.8} aria-hidden="true" />
                            <span className="w-full truncate">{tab.label}</span>
                        </button>
                    );
                })}
            </div>
        </div>
    );
}

function Sidebar({ onNavigate }) {
    const { user } = useAuth();
    const [query, setQuery] = useState('');
    const groups = useNavGroups(query);

    return (
        <div className="flex h-full flex-col">
            <div className="flex items-center gap-3 px-5 pt-5 pb-3">
                <img src="/brand/mark.png" alt="" className="h-10 w-10 shrink-0 object-contain" />
                <div className="min-w-0">
                    <div className="truncate text-[17px] font-extrabold tracking-tight">
                        <span className="text-[#292e3c]">Near</span>
                        <span className="text-brand-500">mart</span>
                    </div>
                    <div className="flex items-center gap-1.5 text-[10px] font-semibold tracking-[0.14em] text-neutral-500 uppercase">
                        <span className="h-1.5 w-1.5 rounded-full bg-brand-500" aria-hidden="true" />
                        {roleLabel(user)}
                    </div>
                </div>
            </div>

            <div className="space-y-3 border-b border-neutral-200 px-4 pb-4">
                <div className="px-1 pt-1 text-[11px] font-bold tracking-[0.14em] text-neutral-500 uppercase">Admin panel</div>
                <ModuleSwitcher />
                <label className="relative block">
                    <span className="sr-only">Search menu</span>
                    <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-neutral-400" aria-hidden="true" />
                    <input type="search" className="input pl-9" placeholder="Search menu…" value={query} onChange={(e) => setQuery(e.target.value)} />
                </label>
            </div>

            <nav className="flex-1 overflow-y-auto px-3 py-4" aria-label="Main">
                {groups.map((g) => (
                    <div key={g.title} className="mb-5 last:mb-0">
                        <div className="mb-1.5 px-3 text-[11px] font-bold tracking-[0.14em] text-neutral-500 uppercase">{g.title}</div>
                        <div className="flex flex-col gap-0.5">
                            {g.items.map((item) => (
                                <NavLink
                                    key={item.to}
                                    to={item.to}
                                    end={item.to === '/'}
                                    onClick={onNavigate}
                                    className={({ isActive }) =>
                                        `flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition ${
                                            isActive ? 'bg-neutral-900 text-white shadow-sm' : 'text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900'
                                        }`
                                    }
                                >
                                    <item.icon className="h-4 w-4 shrink-0" strokeWidth={1.8} aria-hidden="true" />
                                    <span className="truncate">{item.label}</span>
                                </NavLink>
                            ))}
                        </div>
                    </div>
                ))}
                {!groups.length && <p className="px-3 text-sm text-neutral-500">No menu items match.</p>}
            </nav>
        </div>
    );
}

/** Header search: jumps to any page the user can open. Ctrl+K focuses it. */
function PageSearch() {
    const navigate = useNavigate();
    const [query, setQuery] = useState('');
    const [open, setOpen] = useState(false);
    const inputRef = useRef(null);
    const matches = useNavGroups(query).flatMap((g) => g.items.map((item) => ({ ...item, group: g.title })));

    useEffect(() => {
        const onKey = (e) => {
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
                e.preventDefault();
                inputRef.current?.focus();
            }
        };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    }, []);

    const go = (to) => {
        navigate(to);
        setQuery('');
        setOpen(false);
        inputRef.current?.blur();
    };

    return (
        <div className="relative w-full max-w-md">
            <Search className="pointer-events-none absolute top-1/2 left-4 h-4 w-4 -translate-y-1/2 text-neutral-400" aria-hidden="true" />
            <input
                ref={inputRef}
                type="search"
                aria-label="Search pages"
                placeholder="Search"
                className="h-10 w-full rounded-full border border-neutral-200 bg-neutral-100 pr-4 pl-10 text-sm outline-none transition placeholder:text-neutral-500 focus:border-neutral-300 focus:bg-white focus:ring-4 focus:ring-neutral-100 sm:pr-20"
                value={query}
                onChange={(e) => {
                    setQuery(e.target.value);
                    setOpen(true);
                }}
                onFocus={() => setOpen(true)}
                onBlur={() => setOpen(false)}
                onKeyDown={(e) => {
                    if (e.key === 'Enter' && matches[0]) go(matches[0].to);
                    if (e.key === 'Escape') e.currentTarget.blur();
                }}
            />
            <kbd className="pointer-events-none absolute top-1/2 right-3 hidden -translate-y-1/2 rounded-md border border-neutral-200 bg-white px-1.5 py-0.5 font-sans text-[11px] font-medium text-neutral-500 sm:block">Ctrl+K</kbd>
            {open && query.trim() && (
                <ul className="absolute inset-x-0 top-full z-30 mt-2 max-h-80 overflow-y-auto rounded-xl border border-neutral-200 bg-white p-1 shadow-lg">
                    {matches.map((m) => (
                        <li key={m.to}>
                            {/* mousedown fires before the input's blur closes the list. */}
                            <button type="button" className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm hover:bg-neutral-100" onMouseDown={(e) => { e.preventDefault(); go(m.to); }}>
                                <m.icon className="h-4 w-4 text-neutral-500" aria-hidden="true" />
                                <span className="flex-1">{m.label}</span>
                                <span className="text-xs text-neutral-400">{m.group}</span>
                            </button>
                        </li>
                    ))}
                    {!matches.length && <li className="px-3 py-3 text-sm text-neutral-500">No pages match.</li>}
                </ul>
            )}
        </div>
    );
}

/** Name, email and sign-out behind the account button in the header. */
function ProfileMenu() {
    const { user, logout } = useAuth();
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
                    <span className="block text-sm font-semibold text-neutral-900">{user.name}</span>
                    <span className="block text-xs text-neutral-500">{user.email}</span>
                </span>
                <span className="grid h-9 w-9 place-items-center rounded-full bg-neutral-900 text-sm font-semibold text-white sm:hidden">{user.name?.[0]?.toUpperCase()}</span>
                <ChevronDown className="hidden h-4 w-4 text-neutral-500 sm:block" aria-hidden="true" />
            </button>
            {open && (
                <div className="absolute right-0 z-30 mt-2 w-60 rounded-xl border border-neutral-200 bg-white p-1 shadow-lg">
                    <div className="border-b border-neutral-100 px-3 py-2.5">
                        <div className="truncate text-sm font-semibold">{user.name}</div>
                        <div className="truncate text-xs text-neutral-500">{user.email}</div>
                        <div className="mt-1 text-[10px] font-semibold tracking-[0.14em] text-neutral-500 uppercase">{roleLabel(user)}</div>
                    </div>
                    <button type="button" className="mt-1 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-red-600 hover:bg-red-50" onClick={logout}>
                        <LogOut className="h-4 w-4" aria-hidden="true" />
                        Sign out
                    </button>
                </div>
            )}
        </div>
    );
}

const timeAgo = (d) => {
    const mins = Math.round((Date.now() - new Date(d)) / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins} min ago`;
    const hours = Math.round(mins / 60);
    return hours < 24 ? `${hours} h ago` : new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
};

/** New-order and new-pickup alerts for staff, polled every 20 seconds. */
function NotificationBell() {
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const [open, setOpen] = useState(false);
    const ref = useRef(null);
    const { data } = useQuery({
        queryKey: ['staff-notifications'],
        queryFn: () => api.get('/notifications', { params: { limit: 15 } }).then((r) => r.data.data),
        refetchInterval: 20_000,
        refetchIntervalInBackground: true
    });
    const unread = data?.unread ?? 0;
    const refresh = () => queryClient.invalidateQueries({ queryKey: ['staff-notifications'] });
    const markAll = useMutation({ mutationFn: () => api.post('/notifications/read-all'), onSuccess: refresh });

    // The tab title carries the unread count so a backgrounded panel still shows new orders.
    useEffect(() => {
        document.title = unread ? `(${unread}) Nearmart Admin` : 'Nearmart Admin';
    }, [unread]);

    useEffect(() => {
        if (!open) return undefined;
        const close = (e) => !ref.current?.contains(e.target) && setOpen(false);
        document.addEventListener('mousedown', close);
        return () => document.removeEventListener('mousedown', close);
    }, [open]);

    const openItem = async (n) => {
        setOpen(false);
        if (!n.readAt) api.post(`/notifications/${n._id}/read`).then(refresh).catch(() => {});
        if (n.data?.orderId) navigate(`/orders/${n.data.orderId}`);
        else if (n.data?.bookingId) navigate(`/bookings/${n.data.bookingId}`);
    };

    return (
        <div className="relative" ref={ref}>
            <button type="button" className="relative grid h-10 w-10 place-items-center rounded-full border border-neutral-200 bg-white text-neutral-600 transition hover:bg-neutral-50" aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
                <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                    <path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
                    <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
                </svg>
                {unread > 0 && (
                    <span className="absolute -right-0.5 -top-0.5 min-w-5 rounded-full bg-red-600 px-1 text-center text-[11px] font-semibold leading-5 text-white">
                        {unread > 99 ? '99+' : unread}
                    </span>
                )}
            </button>
            {open && (
                <div className="absolute right-0 z-30 mt-2 w-80 max-w-[calc(100vw-2rem)] rounded-xl border border-slate-200 bg-white shadow-lg">
                    <div className="flex items-center justify-between border-b border-slate-100 px-4 py-2">
                        <span className="text-sm font-semibold">Notifications</span>
                        {unread > 0 && <button type="button" className="text-xs text-brand-700 hover:underline" onClick={() => markAll.mutate()}>Mark all read</button>}
                    </div>
                    <ul className="max-h-96 overflow-y-auto">
                        {!data?.items.length && <li className="px-4 py-6 text-center text-sm text-slate-500">Nothing yet.</li>}
                        {data?.items.map((n) => (
                            <li key={n._id}>
                                <button type="button" className={`block w-full px-4 py-3 text-left hover:bg-slate-50 ${n.readAt ? '' : 'bg-brand-50/50'}`} onClick={() => openItem(n)}>
                                    <span className="flex items-start justify-between gap-2">
                                        <span className="text-sm font-medium">{n.title}</span>
                                        {!n.readAt && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-brand-600" aria-label="unread" />}
                                    </span>
                                    {n.body && <span className="block text-xs text-slate-600">{n.body}</span>}
                                    <span className="block text-[11px] text-slate-400">{timeAgo(n.createdAt)}</span>
                                </button>
                            </li>
                        ))}
                    </ul>
                </div>
            )}
        </div>
    );
}

export default function AppLayout() {
    // Inside the signed-in shell so the module list can be fetched.
    return (
        <ModuleProvider>
            <Shell />
        </ModuleProvider>
    );
}

function Shell() {
    const [menuOpen, setMenuOpen] = useState(false);

    return (
        <div className="min-h-screen lg:grid lg:grid-cols-[280px_1fr]">
            <aside className="sticky top-0 hidden h-screen border-r border-neutral-200 bg-white lg:block">
                <Sidebar />
            </aside>

            {menuOpen && (
                <div className="fixed inset-0 z-40 lg:hidden">
                    <button
                        type="button"
                        className="absolute inset-0 bg-neutral-900/40"
                        aria-label="Close menu"
                        onClick={() => setMenuOpen(false)}
                    />
                    <aside className="relative z-10 h-full w-72 bg-white shadow-xl">
                        <Sidebar onNavigate={() => setMenuOpen(false)} />
                    </aside>
                </div>
            )}

            <div className="flex min-w-0 flex-col">
                <header className="sticky top-0 z-20 flex h-[72px] items-center gap-3 border-b border-neutral-200 bg-white/90 px-4 backdrop-blur lg:px-8">
                    <button type="button" className="btn-ghost px-2 lg:hidden" onClick={() => setMenuOpen(true)} aria-label="Open menu">
                        <Menu className="h-5 w-5" aria-hidden="true" />
                    </button>
                    <div className="flex min-w-0 flex-1 justify-center">
                        <PageSearch />
                    </div>
                    <div className="flex items-center gap-2 sm:gap-3">
                        <NotificationBell />
                        <div className="hidden h-8 w-px bg-neutral-200 sm:block" aria-hidden="true" />
                        <ProfileMenu />
                    </div>
                </header>
                <main className="flex-1 p-4 lg:p-8">
                    <Outlet />
                </main>
            </div>
        </div>
    );
}
