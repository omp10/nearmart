import { useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { api } from '../lib/api.js';
import { BOOKING_LABELS, BOOKING_TONES, formatQty } from '../lib/bookings.js';
import { formatPaise } from '../lib/money.js';
import { Badge, ErrorNote, Pager, useDebounced } from '../components/ui.jsx';

const FILTERS = [
    ['active', 'Active'],
    ['placed', 'New'],
    ['pickup_scheduled', 'Pickup scheduled'],
    ['picked_up', 'To weigh'],
    ['processing', 'Processing'],
    ['ready', 'Ready'],
    ['out_for_return', 'Out for return'],
    ['completed', 'Completed'],
    ['cancelled', 'Cancelled'],
    ['', 'All']
];
const ACTIVE = ['placed', 'pickup_scheduled', 'picked_up', 'weighed', 'processing', 'ready', 'out_for_return'];

export default function Bookings() {
    const [status, setStatus] = useState('active');
    const [q, setQ] = useState('');
    const [pickupDate, setPickupDate] = useState('');
    const [page, setPage] = useState(1);
    const search = useDebounced(q);
    const params = { page, limit: 25, ...(status ? { status } : {}), ...(search ? { q: search } : {}), ...(pickupDate ? { pickupDate } : {}) };

    const { data, isLoading, error } = useQuery({
        queryKey: ['bookings', params],
        queryFn: () => api.get('/admin/laundry/bookings', { params }).then((r) => r.data.data),
        placeholderData: keepPreviousData,
        refetchInterval: 30_000
    });
    const counts = data?.statusCounts ?? {};
    const pick = (fn) => (v) => {
        fn(v);
        setPage(1);
    };

    return (
        <div className="space-y-6">
            <div>
                <h1 className="text-2xl font-semibold">Laundry bookings</h1>
                <p className="text-sm text-slate-500">Pickup, weigh, process and return. Refreshes every 30 seconds.</p>
            </div>

            <div className="flex flex-wrap gap-1" role="tablist" aria-label="Booking status">
                {FILTERS.map(([value, label]) => {
                    const n = value === 'active' ? ACTIVE.reduce((sum, s) => sum + (counts[s] ?? 0), 0) : value ? counts[value] : null;
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
                <input className="input" placeholder="Booking number, phone or name" aria-label="Search bookings" value={q} onChange={(e) => pick(setQ)(e.target.value)} />
                <input type="date" className="input" aria-label="Pickup date" value={pickupDate} onChange={(e) => pick(setPickupDate)(e.target.value)} />
            </div>

            <ErrorNote error={error} />

            <div className="card overflow-x-auto p-0">
                <table className="w-full text-sm">
                    <thead className="bg-slate-50 text-left text-slate-500">
                        <tr>
                            <th className="px-4 py-3 font-medium">Booking</th>
                            <th className="px-4 py-3 font-medium">Customer</th>
                            <th className="px-4 py-3 font-medium">Pickup</th>
                            <th className="px-4 py-3 font-medium">Services</th>
                            <th className="px-4 py-3 font-medium">Amount</th>
                            <th className="px-4 py-3 font-medium">Status</th>
                        </tr>
                    </thead>
                    <tbody>
                        {isLoading && <tr><td colSpan={6} className="px-4 py-6 text-center text-slate-500">Loading…</td></tr>}
                        {data?.items.length === 0 && <tr><td colSpan={6} className="px-4 py-6 text-center text-slate-500">No bookings here.</td></tr>}
                        {data?.items.map((b) => (
                            <tr key={b._id} className="border-t border-slate-100 hover:bg-slate-50">
                                <td className="px-4 py-3">
                                    <Link to={`/bookings/${b._id}`} className="font-medium text-brand-700 hover:underline">#{b.bookingNumber}</Link>
                                    <span className="block text-xs text-slate-500">{new Date(b.createdAt).toLocaleDateString('en-IN')}</span>
                                </td>
                                <td className="px-4 py-3">
                                    {b.address?.name || '—'}
                                    <span className="block text-xs text-slate-500">{b.customerPhone} · {b.address?.pincode}</span>
                                </td>
                                <td className="px-4 py-3 text-slate-600">{b.pickupSlot ? `${b.pickupSlot.date} ${b.pickupSlot.label}` : '—'}</td>
                                <td className="px-4 py-3 text-slate-600">
                                    {b.items.map((l) => (
                                        <span key={l.name} className="block">
                                            {l.name}: {formatQty(l.finalQty ?? l.estimatedQty, l.pricingUnit)}{l.finalQty == null && ' (est.)'}
                                        </span>
                                    ))}
                                </td>
                                <td className="px-4 py-3 tabular-nums">
                                    {formatPaise(b.pricing.totalPaise)}
                                    {b.pricing.finalPaise == null && <span className="block text-xs text-slate-500">estimate</span>}
                                    {b.payment.balanceDuePaise > 0 && <span className="block text-xs text-amber-700">due {formatPaise(b.payment.balanceDuePaise)}</span>}
                                </td>
                                <td className="px-4 py-3"><Badge tone={BOOKING_TONES[b.status]}>{BOOKING_LABELS[b.status]}</Badge></td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
            <Pager page={page} pages={data?.pages} onChange={setPage} />
        </div>
    );
}
