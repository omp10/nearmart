import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { useAuth } from '../auth/AuthProvider.jsx';
import { api } from '../lib/api.js';
import { formatPaise } from '../lib/money.js';
import { ErrorNote } from '../components/ui.jsx';

const MODULE_NAMES = { grocery: 'Grocery', produce: 'Vegetables & produce', laundry: 'Laundry', electronics: 'Electrical & electronics' };
const shortDay = (date) => new Date(`${date}T00:00:00`).toLocaleDateString('en-IN', { weekday: 'short' });
const longDay = (date) => new Date(`${date}T00:00:00`).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'short' });

function Tile({ label, value, sub, to }) {
    const body = (
        <>
            <div className="text-sm text-slate-500">{label}</div>
            <div className="mt-1 text-2xl font-semibold tabular-nums text-slate-900">{value}</div>
            {sub && <div className="mt-1 text-xs text-slate-500">{sub}</div>}
        </>
    );
    return to ? (
        <Link to={to} className="card block transition hover:border-brand-500">{body}</Link>
    ) : (
        <div className="card">{body}</div>
    );
}

/**
 * Orders per IST day, one series: thin columns from a shared baseline,
 * today's value labelled on its cap, every value in the tooltip and the
 * screen-reader table.
 */
function WeekChart({ daily }) {
    const [hover, setHover] = useState(null);
    // Two equal steps of a round size (1, 2, 5, 10, 20, 50…) so the midline label is exact.
    const max = Math.max(1, ...daily.map((d) => d.orders));
    const step = [1, 2, 5].flatMap((m) => [1, 10, 100, 1000, 10000].map((p) => m * p)).sort((a, b) => a - b).find((s) => s * 2 >= max) ?? max;
    const top = step * 2;
    const ticks = [top, step, 0];
    const today = daily.at(-1);

    return (
        <section className="card">
            <h2 className="font-semibold">Orders, last 7 days</h2>
            <p className="text-xs text-slate-500">Orders and laundry bookings, excluding cancelled</p>

            <div className="relative mt-4 flex h-48 gap-2">
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
                                            <div>{d.orders} orders · {formatPaise(d.revenuePaise)}</div>
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
                <caption>Orders per day, last 7 days</caption>
                <thead><tr><th>Date</th><th>Orders</th><th>Value</th></tr></thead>
                <tbody>
                    {daily.map((d) => <tr key={d.date}><td>{d.date}</td><td>{d.orders}</td><td>{formatPaise(d.revenuePaise)}</td></tr>)}
                </tbody>
            </table>
            <p className="mt-2 text-xs text-slate-500">Today: {today.orders} · {formatPaise(today.revenuePaise)}</p>
        </section>
    );
}

export default function Dashboard() {
    const { user, can } = useAuth();
    const { data: d, isLoading, error } = useQuery({
        queryKey: ['dashboard'],
        queryFn: () => api.get('/admin/dashboard').then((r) => r.data.data),
        refetchInterval: 60_000
    });

    return (
        <div className="space-y-6">
            <div>
                <h1 className="text-2xl font-semibold">Welcome, {user.name}</h1>
                <p className="text-sm text-slate-500">{user.role === 'ops' ? `Your modules: ${user.modules.map((m) => MODULE_NAMES[m]).join(', ')}` : 'All modules'} · updates every minute</p>
            </div>
            <ErrorNote error={error} />
            {isLoading && <p className="text-sm text-slate-500">Loading…</p>}

            {d && (
                <>
                    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                        <Tile label="Orders today" value={d.today.orders} sub={formatPaise(d.today.revenuePaise)} />
                        <Tile
                            label="New orders to accept"
                            value={d.openOrders.needsAction}
                            sub={`${d.openOrders.total} open in total`}
                            to={can('orders') ? '/orders' : undefined}
                        />
                        {d.bookings ? (
                            <Tile
                                label="Laundry to weigh"
                                value={d.bookings.toWeigh}
                                sub={`${d.bookings.newRequests} new · ${d.bookings.open} open`}
                                to={can('bookings') ? '/bookings' : undefined}
                            />
                        ) : (
                            <Tile label="Orders this week" value={d.week.orders} sub={formatPaise(d.week.revenuePaise)} />
                        )}
                        <Tile
                            label="Low or out of stock"
                            value={d.catalogue.lowStockVariants}
                            sub="variants at or below their alert level"
                            to={can('inventory') ? '/inventory' : undefined}
                        />
                    </div>

                    <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
                        <WeekChart daily={d.week.daily} />
                        <section className="card">
                            <h2 className="font-semibold">By module, last 7 days</h2>
                            <table className="mt-3 w-full text-sm">
                                <thead className="text-left text-xs text-slate-500">
                                    <tr><th className="pb-2 font-medium">Module</th><th className="pb-2 text-right font-medium">Orders</th><th className="pb-2 text-right font-medium">Value</th></tr>
                                </thead>
                                <tbody>
                                    {d.week.byModule.map((m) => (
                                        <tr key={m.module} className="border-t border-slate-100">
                                            <td className="py-2">{MODULE_NAMES[m.module]}</td>
                                            <td className="py-2 text-right tabular-nums">{m.orders}</td>
                                            <td className="py-2 text-right tabular-nums">{formatPaise(m.revenuePaise)}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </section>
                    </div>

                    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                        {d.catalogue.byModule.map((m) => (
                            <Tile key={m.module} label={`${MODULE_NAMES[m.module]} products`} value={m.active} sub={`${m.outOfStock} out of stock · ${m.products - m.active} hidden`} />
                        ))}
                        <Tile label="Customers" value={d.customers.total} sub={`${d.customers.newThisWeek} joined this week`} to={user.role === 'admin' && can('customers') ? '/customers' : undefined} />
                    </div>
                </>
            )}
        </div>
    );
}
