import { useEffect, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { api } from '../lib/api.js';
import { LaundryHasItsOwnPages, ModuleTabs, useCurrentModule } from '../lib/moduleContext.jsx';
import { formatPaise } from '../lib/money.js';
import { PAYMENT_LABELS, STATUS_LABELS, STATUS_TONES } from '../lib/orders.js';
import { Badge, ErrorNote, Pager, useDebounced } from '../components/ui.jsx';

const FILTERS = [
    ['open', 'Open'],
    ['placed', 'New'],
    ['accepted', 'Accepted'],
    ['packing', 'Packing'],
    ['ready', 'Ready'],
    ['dispatched', 'Dispatched'],
    ['delivered', 'Delivered'],
    ['cancelled', 'Cancelled'],
    ['pending_payment', 'Awaiting payment'],
    ['', 'All']
];

const when = (d) => new Date(d).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

export default function Orders() {
    const { module } = useCurrentModule();
    const [status, setStatus] = useState('open');
    const [q, setQ] = useState('');
    const [slotDate, setSlotDate] = useState('');
    const [page, setPage] = useState(1);
    const search = useDebounced(q);

    const params = { module, page, limit: 25, ...(status ? { status } : {}), ...(search ? { q: search } : {}), ...(slotDate ? { slotDate } : {}) };
    const { data, isLoading, error } = useQuery({
        queryKey: ['orders', params],
        queryFn: () => api.get('/admin/orders', { params }).then((r) => r.data.data),
        placeholderData: keepPreviousData,
        // New orders arrive while the page is open.
        refetchInterval: 30_000,
        enabled: module !== 'laundry'
    });

    useEffect(() => setPage(1), [module]);
    const counts = data?.statusCounts ?? {};
    const openCount = ['placed', 'accepted', 'packing', 'ready', 'dispatched'].reduce((n, s) => n + (counts[s] ?? 0), 0);

    const pick = (fn) => (v) => {
        fn(v);
        setPage(1);
    };

    // Laundry is the selected module: it has its own pages.
    if (module === 'laundry') {
        return (
            <div className="space-y-6">
                <h1 className="text-2xl font-semibold">Orders</h1>
                <ModuleTabs productOnly />
                <LaundryHasItsOwnPages what="product orders (its pickups are under Laundry bookings)" />
            </div>
        );
    }

    return (
        <div className="space-y-6">
            <div>
                <h1 className="text-2xl font-semibold">Orders</h1>
                <p className="text-sm text-slate-500">Refreshes every 30 seconds.</p>
            </div>

            <ModuleTabs productOnly />

            <div className="flex flex-wrap gap-1" role="tablist" aria-label="Order status">
                {FILTERS.map(([value, label]) => {
                    const n = value === 'open' ? openCount : value ? counts[value] : null;
                    return (
                        <button
                            key={value || 'all'}
                            type="button"
                            role="tab"
                            aria-selected={status === value}
                            onClick={() => pick(setStatus)(value)}
                            className={`rounded-full border px-3 py-1 text-sm ${status === value ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-slate-200 text-slate-600'}`}
                        >
                            {label}
                            {n ? <span className="ml-1 text-xs text-slate-500">{n}</span> : null}
                        </button>
                    );
                })}
            </div>

            <div className="grid gap-3 sm:grid-cols-[1fr_12rem]">
                <input className="input" placeholder="Order number, phone or name" aria-label="Search orders" value={q} onChange={(e) => pick(setQ)(e.target.value)} />
                <input type="date" className="input" aria-label="Delivery date" value={slotDate} onChange={(e) => pick(setSlotDate)(e.target.value)} />
            </div>

            <ErrorNote error={error} />

            <div className="card overflow-x-auto p-0">
                <table className="w-full text-sm">
                    <thead className="bg-slate-50 text-left text-slate-500">
                        <tr>
                            <th className="px-4 py-3 font-medium">Order</th>
                            <th className="px-4 py-3 font-medium">Customer</th>
                            <th className="px-4 py-3 font-medium">Slot</th>
                            <th className="px-4 py-3 font-medium">Items</th>
                            <th className="px-4 py-3 font-medium">Total</th>
                            <th className="px-4 py-3 font-medium">Payment</th>
                            <th className="px-4 py-3 font-medium">Status</th>
                        </tr>
                    </thead>
                    <tbody>
                        {isLoading && <tr><td colSpan={7} className="px-4 py-6 text-center text-slate-500">Loading…</td></tr>}
                        {data?.items.length === 0 && <tr><td colSpan={7} className="px-4 py-6 text-center text-slate-500">No orders here.</td></tr>}
                        {data?.items.map((o) => (
                            <tr key={o._id} className="border-t border-slate-100 hover:bg-slate-50">
                                <td className="px-4 py-3">
                                    <Link to={`/orders/${o._id}`} className="font-medium text-brand-700 hover:underline">#{o.orderNumber}</Link>
                                    <span className="block text-xs text-slate-500">{when(o.createdAt)}</span>
                                </td>
                                <td className="px-4 py-3">
                                    {o.address?.name || '—'}
                                    <span className="block text-xs text-slate-500">{o.customerPhone} · {o.address?.pincode}</span>
                                </td>
                                <td className="px-4 py-3 text-slate-600">{o.slot?.date ? `${o.slot.date} ${o.slot.label}` : 'ASAP'}</td>
                                <td className="px-4 py-3 text-slate-600">
                                    {o.items.reduce((n, l) => n + (l.status === 'ok' ? l.qty : 0), 0)}
                                    {o.items.some((l) => l.status === 'unavailable') && <span className="ml-1 text-xs text-amber-700">(some unavailable)</span>}
                                </td>
                                <td className="px-4 py-3 tabular-nums">{formatPaise(o.pricing.totalPaise)}</td>
                                <td className="px-4 py-3 text-slate-600">
                                    {o.payment.method === 'cod' ? 'Cash' : 'Online'} · {PAYMENT_LABELS[o.payment.status]}
                                </td>
                                <td className="px-4 py-3"><Badge tone={STATUS_TONES[o.status]}>{STATUS_LABELS[o.status]}</Badge></td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
            <Pager page={page} pages={data?.pages} onChange={setPage} />
        </div>
    );
}
