import { useState } from 'react';
import { NavLink, Outlet } from 'react-router';
import { useAuth } from '../auth/AuthProvider.jsx';
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

export default function AppLayout() {
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
                    <div className="ml-auto flex items-center gap-3">
                        <div className="text-right">
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
