import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { useAuth } from '../auth/AuthProvider.jsx';
import { api } from '../lib/api.js';
import { BOOKING_LABELS } from '../lib/bookings.js';
import { formatPaise } from '../lib/money.js';
import { useCurrentModule } from '../lib/moduleContext.jsx';
import { STATUS_LABELS } from '../lib/orders.js';
import { ErrorNote } from '../components/ui.jsx';
import { Boxes, CalendarDays, ClipboardList, IndianRupee, Package, Scale, TriangleAlert, Users } from 'lucide-react';

const MODULE_NAMES = { grocery: 'Grocery', produce: 'Vegetables & produce', laundry: 'Laundry', electronics: 'Electrical & electronics' };
const shortDay = (date) => new Date(`${date}T00:00:00`).toLocaleDateString('en-IN', { weekday: 'short' });
const longDay = (date) => new Date(`${date}T00:00:00`).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'short' });

const TONES = {
    emerald: 'from-emerald-50 border-emerald-100 text-emerald-600',
    sky: 'from-sky-50 border-sky-100 text-sky-600',
    amber: 'from-amber-50 border-amber-100 text-amber-600',
    violet: 'from-violet-50 border-violet-100 text-violet-600',
    rose: 'from-rose-50 border-rose-100 text-rose-600',
    cyan: 'from-cyan-50 border-cyan-100 text-cyan-600',
    lime: 'from-lime-50 border-lime-100 text-lime-600',
    orange: 'from-orange-50 border-orange-100 text-orange-600'
};

/** Stat tile: tinted by tone, small-caps label, big figure, icon chip on the right. */
function Tile({ label, value, sub, to, icon: Icon = Package, tone = 'sky' }) {
    const tint = TONES[tone];
    const body = (
        <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
                <div className="mb-1 truncate text-[10px] font-bold tracking-[0.18em] text-neutral-500 uppercase">{label}</div>
                <div className="text-2xl font-bold tabular-nums text-neutral-900">{value}</div>
                {sub && <div className="mt-0.5 truncate text-xs text-neutral-500">{sub}</div>}
            </div>
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-neutral-200/70 bg-white shadow-sm">
                <Icon className="h-5 w-5" strokeWidth={1.8} aria-hidden="true" />
            </span>
        </div>
    );
    const cls = `block min-w-0 rounded-xl border bg-gradient-to-br to-white p-4 shadow-sm ${tint}`;
    return to ? (
        <Link to={to} className={`${cls} transition hover:-translate-y-0.5 hover:shadow-md`}>{body}</Link>
    ) : (
        <div className={cls}>{body}</div>
    );
}

/** White panel with a ruled header, as on the reference dashboard. */
function Panel({ title, sub, children, className = '' }) {
    return (
        <section className={`rounded-xl border border-neutral-200 bg-white shadow-sm ${className}`}>
            <div className="border-b border-neutral-200 px-5 py-4">
                <h2 className="text-lg font-semibold text-neutral-900">{title}</h2>
                {sub && <p className="text-sm text-neutral-500">{sub}</p>}
            </div>
            <div className="p-5">{children}</div>
        </section>
    );
}

/**
 * Orders per IST day, one series: thin columns from a shared baseline,
 * today's value labelled on its cap, every value in the tooltip and the
 * screen-reader table.
 */
function WeekChart({ daily, noun }) {
    const [hover, setHover] = useState(null);
    // Two equal steps of a round size (1, 2, 5, 10, 20, 50…) so the midline label is exact.
    const max = Math.max(1, ...daily.map((d) => d.orders));
    const step = [1, 2, 5].flatMap((m) => [1, 10, 100, 1000, 10000].map((p) => m * p)).sort((a, b) => a - b).find((s) => s * 2 >= max) ?? max;
    const top = step * 2;
    const ticks = [top, step, 0];
    const today = daily.at(-1);

    return (
        <Panel title={`${noun[0].toUpperCase()}${noun.slice(1)}, last 7 days`} sub="Excluding cancelled">
            <div className="relative flex h-56 gap-2">
                <div className="flex w-6 flex-col justify-between pb-6 text-right text-[11px] tabular-nums text-slate-400" aria-hidden="true">
                    {ticks.map((t) => <span key={t}>{t}</span>)}
                </div>
                <div className="relative flex-1">
                    {/* Hairline gridlines, recessive. */}
                    <div className="absolute inset-x-0 top-0 bottom-6 flex flex-col justify-between" aria-hidden="true">
                        {ticks.map((t) => <div key={t} className="h-px bg-slate-100" />)}
                    </div>
                    <div className="absolute inset-x-0 top-0 bottom-6 flex items-end justify-around" aria-hidden="true">
                        {daily.map((d, i) => {
                            const isToday = i === daily.length - 1;
                            const height = `${(d.orders / top) * 100}%`;
                            return (
                                <div
                                    key={d.date}
                                    className="relative flex h-full w-full items-end justify-center"
                                    onMouseEnter={() => setHover(i)}
                                    onMouseLeave={() => setHover(null)}
                                >
                                    {isToday && d.orders > 0 && (
                                        <span className="absolute text-xs font-medium tabular-nums text-slate-700" style={{ bottom: `calc(${height} + 4px)` }}>
                                            {d.orders}
                                        </span>
                                    )}
                                    <div
                                        className={`w-full max-w-6 rounded-t ${hover === i ? 'bg-brand-700' : 'bg-brand-600'}`}
                                        style={{ height, minHeight: d.orders ? 2 : 0 }}
                                    />
                                    {hover === i && (
                                        <div className="pointer-events-none absolute bottom-full z-10 mb-1 whitespace-nowrap rounded-md bg-slate-900 px-2 py-1 text-xs text-white shadow">
                                            <div className="font-medium">{longDay(d.date)}</div>
                                            <div>{d.orders} {noun} · {formatPaise(d.revenuePaise)}</div>
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                    <div className="absolute inset-x-0 bottom-0 flex justify-around text-[11px] text-slate-500" aria-hidden="true">
                        {daily.map((d) => <span key={d.date} className="w-full text-center">{shortDay(d.date)}</span>)}
                    </div>
                </div>
            </div>

            <table className="sr-only">
                <caption>{noun} per day, last 7 days</caption>
                <thead><tr><th>Date</th><th>{noun}</th><th>Value</th></tr></thead>
                <tbody>
                    {daily.map((d) => <tr key={d.date}><td>{d.date}</td><td>{d.orders}</td><td>{formatPaise(d.revenuePaise)}</td></tr>)}
                </tbody>
            </table>
            <p className="mt-3 text-xs text-slate-500">Today: {today.orders} · {formatPaise(today.revenuePaise)}</p>
        </Panel>
    );
}

/** Open work by status, in workflow order, linking to the filtered list. */
function OpenByStatus({ counts, labels, to }) {
    const rows = Object.keys(labels).filter((s) => counts[s]);
    if (!rows.length) return <p className="text-sm text-slate-500">Nothing open right now.</p>;
    return (
        <ul className="divide-y divide-slate-100 text-sm">
            {rows.map((s) => (
                <li key={s} className="flex items-center justify-between py-2.5">
                    {to ? <Link to={`${to}?status=${s}`} className="hover:underline">{labels[s]}</Link> : <span>{labels[s]}</span>}
                    <span className="font-semibold tabular-nums">{counts[s]}</span>
                </li>
            ))}
        </ul>
    );
}

export default function Dashboard() {
    const { user, can } = useAuth();
    const { module, modules } = useCurrentModule();
    const { data: d, isLoading, error } = useQuery({
        queryKey: ['dashboard', module],
        queryFn: () => api.get('/admin/dashboard', { params: { module } }).then((r) => r.data.data),
        refetchInterval: 60_000
    });
    const name = modules.find((m) => m.key === module)?.name ?? MODULE_NAMES[module];
    const isLaundry = module === 'laundry';
    const catalogue = d?.catalogue.byModule[0];

    return (
        <div className="space-y-6">
            <section className="overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-sm">
                <div className="border-b border-neutral-200 bg-neutral-50/70 px-5 py-5 sm:px-6">
                    <div className="text-xs font-medium tracking-[0.18em] text-neutral-500 uppercase">{name} overview</div>
                    <h1 className="mt-1 text-2xl font-semibold sm:text-[28px]">Welcome, {user.name}</h1>
                    <p className="mt-1 text-sm text-slate-500">Showing {name} only · switch module in the sidebar · updates every minute</p>
                </div>

                <div className="space-y-4 p-5 sm:p-6">
                    <ErrorNote error={error} />
                    {isLoading && <p className="text-sm text-slate-500">Loading…</p>}
                    {d && isLaundry && (
                        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                            <Tile label="Bookings today" value={d.today.orders} sub={formatPaise(d.today.revenuePaise)} icon={IndianRupee} tone="emerald" />
                            <Tile
                                label="New pickup requests"
                                value={d.bookings.newRequests}
                                sub={`${d.bookings.open} open in total`}
                                to={can('bookings') ? '/bookings' : undefined}
                                icon={ClipboardList}
                                tone="sky"
                            />
                            <Tile label="Laundry to weigh" value={d.bookings.toWeigh} sub="picked up, not yet weighed" to={can('bookings') ? '/bookings' : undefined} icon={Scale} tone="violet" />
                            <Tile label="Bookings this week" value={d.week.orders} sub={formatPaise(d.week.revenuePaise)} icon={CalendarDays} tone="amber" />
                            <Tile label="App customers" value={d.customers.total} sub={`${d.customers.newThisWeek} joined this week · all modules`} to={user.role === 'admin' && can('customers') ? '/customers' : undefined} icon={Users} tone="cyan" />
                        </div>
                    )}
                    {d && !isLaundry && (
                        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                            <Tile label="Orders today" value={d.today.orders} sub={formatPaise(d.today.revenuePaise)} icon={IndianRupee} tone="emerald" />
                            <Tile
                                label="New orders to accept"
                                value={d.openOrders.needsAction}
                                sub={`${d.openOrders.total} open in total`}
                                to={can('orders') ? '/orders' : undefined}
                                icon={ClipboardList}
                                tone="sky"
                            />
                            <Tile label="Orders this week" value={d.week.orders} sub={formatPaise(d.week.revenuePaise)} icon={CalendarDays} tone="violet" />
                            <Tile
                                label="Low or out of stock"
                                value={d.catalogue.lowStockVariants}
                                sub="variants at or below their alert level"
                                to={can('inventory') ? '/inventory' : undefined}
                                icon={TriangleAlert}
                                tone="rose"
                            />
                            <Tile
                                label="Products"
                                value={catalogue?.active ?? 0}
                                sub={`${catalogue?.outOfStock ?? 0} out of stock · ${(catalogue?.products ?? 0) - (catalogue?.active ?? 0)} hidden`}
                                to={can('catalog') ? '/products' : undefined}
                                icon={Boxes}
                                tone="amber"
                            />
                            <Tile label="App customers" value={d.customers.total} sub={`${d.customers.newThisWeek} joined this week · all modules`} to={user.role === 'admin' && can('customers') ? '/customers' : undefined} icon={Users} tone="cyan" />
                        </div>
                    )}
                </div>
            </section>

            {d && (
                <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
                    <WeekChart daily={d.week.daily} noun={isLaundry ? 'bookings' : 'orders'} />
                    <Panel title={isLaundry ? 'Open bookings' : 'Open orders'} sub="By status">
                        {isLaundry ? (
                            <OpenByStatus counts={d.bookings.byStatus} labels={BOOKING_LABELS} to={can('bookings') ? '/bookings' : undefined} />
                        ) : (
                            <OpenByStatus counts={d.openOrders.byStatus} labels={STATUS_LABELS} to={can('orders') ? '/orders' : undefined} />
                        )}
                    </Panel>
                </div>
            )}
        </div>
    );
}
