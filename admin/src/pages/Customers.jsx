import { useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router';
import { useAuth } from '../auth/AuthProvider.jsx';
import { api } from '../lib/api.js';
import { BOOKING_LABELS } from '../lib/bookings.js';
import { formatPaise } from '../lib/money.js';
import { STATUS_LABELS } from '../lib/orders.js';
import { Badge, ErrorNote, Pager, useDebounced } from '../components/ui.jsx';

const day = (d) => (d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');

export function Customers() {
    const [q, setQ] = useState('');
    const [status, setStatus] = useState('');
    const [page, setPage] = useState(1);
    const search = useDebounced(q);
    const params = { page, limit: 25, ...(search ? { q: search } : {}), ...(status ? { status } : {}) };
    const { data, isLoading, error } = useQuery({
        queryKey: ['customers', params],
        queryFn: () => api.get('/admin/customers', { params }).then((r) => r.data.data),
        placeholderData: keepPreviousData
    });

    return (
        <div className="space-y-6">
            <div>
                <h1 className="text-2xl font-semibold">Customers</h1>
                <p className="text-sm text-slate-500">Orders and spend count product orders, excluding cancelled ones. Laundry bookings are listed on each customer's page.</p>
            </div>
            <div className="grid gap-3 sm:grid-cols-[1fr_12rem]">
                <input className="input" placeholder="Phone, name or email" aria-label="Search customers" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
                <select className="input" aria-label="Status" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
                    <option value="">All</option>
                    <option value="active">Active</option>
                    <option value="inactive">Deactivated</option>
                </select>
            </div>
            <ErrorNote error={error} />
            <div className="card overflow-x-auto p-0">
                <table className="w-full text-sm">
                    <thead className="bg-slate-50 text-left text-slate-500">
                        <tr>
                            <th className="px-4 py-3 font-medium">Customer</th>
                            <th className="px-4 py-3 font-medium">Joined</th>
                            <th className="px-4 py-3 text-right font-medium">Orders</th>
                            <th className="px-4 py-3 text-right font-medium">Spent</th>
                            <th className="px-4 py-3 font-medium">Last order</th>
                            <th className="px-4 py-3 font-medium">Status</th>
                        </tr>
                    </thead>
                    <tbody>
                        {isLoading && <tr><td colSpan={6} className="px-4 py-6 text-center text-slate-500">Loading…</td></tr>}
                        {data?.items.length === 0 && <tr><td colSpan={6} className="px-4 py-6 text-center text-slate-500">No customers match.</td></tr>}
                        {data?.items.map((c) => (
                            <tr key={c._id} className="border-t border-slate-100 hover:bg-slate-50">
                                <td className="px-4 py-3">
                                    <Link to={`/customers/${c._id}`} className="font-medium text-brand-700 hover:underline">{c.name || 'No name'}</Link>
                                    <span className="block text-xs text-slate-500">{c.phone}{c.email && ` · ${c.email}`}</span>
                                </td>
                                <td className="px-4 py-3 text-slate-600">{day(c.createdAt)}</td>
                                <td className="px-4 py-3 text-right tabular-nums">{c.orders}</td>
                                <td className="px-4 py-3 text-right tabular-nums">{formatPaise(c.spentPaise)}</td>
                                <td className="px-4 py-3 text-slate-600">{day(c.lastOrderAt)}</td>
                                <td className="px-4 py-3">{c.isActive ? <Badge tone="green">Active</Badge> : <Badge tone="red">Deactivated</Badge>}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
            <Pager page={page} pages={data?.pages} onChange={setPage} />
        </div>
    );
}

export function CustomerDetail() {
    const { id } = useParams();
    const { can } = useAuth();
    const queryClient = useQueryClient();
    const { data: c, isLoading, error } = useQuery({ queryKey: ['customer', id], queryFn: () => api.get(`/admin/customers/${id}`).then((r) => r.data.data) });
    const toggle = useMutation({
        mutationFn: (isActive) => api.patch(`/admin/customers/${id}`, { isActive }),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['customer', id] });
            queryClient.invalidateQueries({ queryKey: ['customers'] });
        }
    });

    if (isLoading) return <p className="text-sm text-slate-500">Loading…</p>;
    if (error) return <ErrorNote error={error} />;

    return (
        <div className="space-y-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                    <Link to="/customers" className="text-sm text-slate-500 hover:underline">← Customers</Link>
                    <h1 className="flex items-center gap-3 text-2xl font-semibold">
                        {c.name || 'No name'}
                        {c.isActive ? <Badge tone="green">Active</Badge> : <Badge tone="red">Deactivated</Badge>}
                    </h1>
                    <p className="text-sm text-slate-500">{c.phone}{c.email && ` · ${c.email}`} · joined {day(c.createdAt)}</p>
                </div>
                {can('customers', 'update') && (
                    <button
                        type="button"
                        className={c.isActive ? 'btn-ghost text-red-600' : 'btn-primary'}
                        disabled={toggle.isPending}
                        onClick={() => (c.isActive ? window.confirm('Deactivate this customer? They are signed out and cannot order.') && toggle.mutate(false) : toggle.mutate(true))}
                    >
                        {c.isActive ? 'Deactivate' : 'Reactivate'}
                    </button>
                )}
            </div>
            <ErrorNote error={toggle.error} />

            <div className="grid gap-4 sm:grid-cols-3">
                <div className="card"><div className="text-sm text-slate-500">Orders</div><div className="text-2xl font-semibold tabular-nums">{c.stats.orders}</div></div>
                <div className="card"><div className="text-sm text-slate-500">Spent</div><div className="text-2xl font-semibold tabular-nums">{formatPaise(c.stats.spentPaise)}</div></div>
                <div className="card"><div className="text-sm text-slate-500">Laundry bookings</div><div className="text-2xl font-semibold tabular-nums">{c.bookings.length}</div></div>
            </div>

            <div className="grid gap-6 lg:grid-cols-2">
                <section className="card overflow-x-auto p-0">
                    <h2 className="px-4 pt-4 font-semibold">Orders</h2>
                    <table className="mt-2 w-full text-sm">
                        <tbody>
                            {c.orders.length === 0 && <tr><td className="px-4 py-4 text-slate-500">No orders yet.</td></tr>}
                            {c.orders.map((o) => (
                                <tr key={o._id} className="border-t border-slate-100">
                                    <td className="px-4 py-2"><Link to={`/orders/${o._id}`} className="text-brand-700 hover:underline">#{o.orderNumber}</Link><span className="block text-xs text-slate-500">{day(o.createdAt)} · {o.module}</span></td>
                                    <td className="px-4 py-2 text-slate-600">{STATUS_LABELS[o.status]}</td>
                                    <td className="px-4 py-2 text-right tabular-nums">{formatPaise(o.pricing.totalPaise)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </section>
                <section className="space-y-6">
                    <div className="card overflow-x-auto p-0">
                        <h2 className="px-4 pt-4 font-semibold">Laundry bookings</h2>
                        <table className="mt-2 w-full text-sm">
                            <tbody>
                                {c.bookings.length === 0 && <tr><td className="px-4 py-4 text-slate-500">No bookings yet.</td></tr>}
                                {c.bookings.map((b) => (
                                    <tr key={b._id} className="border-t border-slate-100">
                                        <td className="px-4 py-2"><Link to={`/bookings/${b._id}`} className="text-brand-700 hover:underline">#{b.bookingNumber}</Link><span className="block text-xs text-slate-500">{day(b.createdAt)}</span></td>
                                        <td className="px-4 py-2 text-slate-600">{BOOKING_LABELS[b.status]}</td>
                                        <td className="px-4 py-2 text-right tabular-nums">{formatPaise(b.pricing.totalPaise)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                    <div className="card text-sm">
                        <h2 className="mb-2 font-semibold">Saved addresses</h2>
                        {c.addresses.length === 0 && <p className="text-slate-500">None.</p>}
                        <ul className="space-y-2">
                            {c.addresses.map((a) => (
                                <li key={a._id}>
                                    <span className="font-medium capitalize">{a.label}</span>{a.isDefault && <span className="ml-2"><Badge>Default</Badge></span>}
                                    <span className="block text-slate-600">{a.line1}{a.line2 && `, ${a.line2}`}, {a.city} {a.pincode}</span>
                                </li>
                            ))}
                        </ul>
                    </div>
                </section>
            </div>
        </div>
    );
}
