import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { NavLink, Outlet, useNavigate } from 'react-router';
import { useAuth } from '../auth/AuthProvider.jsx';
import { api } from '../lib/api.js';
import { ModuleProvider, useCurrentModule } from '../lib/moduleContext.jsx';
import { NAV_ITEMS } from '../nav.js';

function Sidebar({ onNavigate }) {
    const { can } = useAuth();
    // Everyone gets the dashboard as a landing page; its widgets check their own permissions.
    const items = NAV_ITEMS.filter((item) => item.to === '/' || can(item.section));

    return (
        <nav className="flex flex-col gap-1 p-3" aria-label="Main">
            {items.map((item) =>
                item.ready ? (
                    <NavLink
                        key={item.to}
                        to={item.to}
                        end={item.to === '/'}
                        onClick={onNavigate}
                        className={({ isActive }) =>
                            `rounded-lg px-3 py-2 text-sm font-medium ${
                                isActive ? 'bg-brand-50 text-brand-700' : 'text-slate-600 hover:bg-slate-100'
                            }`
                        }
                    >
                        {item.label}
                    </NavLink>
                ) : (
                    <span
                        key={item.to}
                        className="flex items-center justify-between rounded-lg px-3 py-2 text-sm text-slate-400"
                        title="Coming in a later phase"
                    >
                        {item.label}
                        <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] uppercase tracking-wide">Soon</span>
                    </span>
                )
            )}
        </nav>
    );
}

/** Header control choosing the module every module-aware page shows. */
function ModuleSwitcher() {
    const { module, setModule, modules } = useCurrentModule();
    if (modules.length < 2) return null;
    return (
        <label className="flex items-center gap-2 text-sm">
            <span className="hidden text-slate-500 sm:inline">Module</span>
            <select className="input w-auto py-1.5 font-medium" aria-label="Module" value={module} onChange={(e) => setModule(e.target.value)}>
                {modules.map((m) => (
                    <option key={m.key} value={m.key}>{m.name}{m.isActive ? '' : ' (off)'}</option>
                ))}
            </select>
        </label>
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
            <button type="button" className="btn-ghost relative px-2" aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
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
    const { user, logout } = useAuth();
    const [menuOpen, setMenuOpen] = useState(false);

    return (
        <div className="min-h-screen lg:grid lg:grid-cols-[240px_1fr]">
            <aside className="hidden border-r border-slate-200 bg-white lg:block">
                <div className="px-6 py-5 text-lg font-semibold text-brand-700">Nearmart</div>
                <Sidebar />
            </aside>

            {menuOpen && (
                <div className="fixed inset-0 z-40 lg:hidden">
                    <button
                        type="button"
                        className="absolute inset-0 bg-slate-900/40"
                        aria-label="Close menu"
                        onClick={() => setMenuOpen(false)}
                    />
                    <aside className="relative z-10 h-full w-64 bg-white shadow-xl">
                        <div className="px-6 py-5 text-lg font-semibold text-brand-700">Nearmart</div>
                        <Sidebar onNavigate={() => setMenuOpen(false)} />
                    </aside>
                </div>
            )}

            <div className="flex min-w-0 flex-col">
                <header className="flex items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-3 lg:px-8">
                    <button type="button" className="btn-ghost lg:hidden" onClick={() => setMenuOpen(true)} aria-label="Open menu">
                        ☰
                    </button>
                    <ModuleSwitcher />
                    <div className="ml-auto flex items-center gap-3">
                        <NotificationBell />
                        <div className="hidden text-right sm:block">
                            <div className="text-sm font-medium">{user.name}</div>
                            <div className="text-xs text-slate-500">
                                {user.isSuperAdmin ? 'Super admin' : user.role === 'ops' ? 'Operations' : 'Admin'}
                            </div>
                        </div>
                        <button type="button" className="btn-ghost" onClick={logout}>
                            Sign out
                        </button>
                    </div>
                </header>
                <main className="flex-1 p-4 lg:p-8">
                    <Outlet />
                </main>
            </div>
        </div>
    );
}
