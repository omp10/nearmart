import { useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { ChevronRight, RefreshCw, Search } from 'lucide-react';
import { api } from '../lib/api.js';
import { formatDateTime } from '../lib/format.js';
import { formatPaise } from '../lib/money.js';
import { OPEN_STATUSES, ORDER_TABS, STATUS_LABELS, STATUS_TONES } from '../lib/orders.js';
import { shopLabel } from '../lib/shops.js';
import { Badge, DateRange, ErrorNote, PageHeader, Pager, useDebounced } from '../components/ui.jsx';

const itemCount = (o) => o.items.filter((l) => l.status === 'ok').reduce((n, l) => n + l.qty, 0);
const slotText = (o) => (o.slot?.date ? `${o.slot.date}, ${o.slot.label}` : 'As soon as possible');

export default function Orders() {
    const navigate = useNavigate();
    const [search, setSearch] = useSearchParams();
    const status = search.get('status') || 'open';
    const [q, setQ] = useState('');
    const [range, setRange] = useState({ from: '', to: '' });
    const [page, setPage] = useState(1);
    const debouncedQ = useDebounced(q.trim());

    const params = { status, page, limit: 20, q: debouncedQ || undefined, from: range.from || undefined, to: range.to || undefined };
    const { data, isLoading, error, isFetching, refetch, dataUpdatedAt } = useQuery({
        queryKey: ['orders', 'list', params],
        queryFn: () => api.get('/seller/orders', { params }).then((r) => r.data.data),
        placeholderData: keepPreviousData,
        refetchInterval: 30_000,
        refetchIntervalInBackground: true
    });

    const counts = data?.statusCounts ?? {};
    const countFor = (key) => (key === 'open' ? OPEN_STATUSES.reduce((n, s) => n + (counts[s] ?? 0), 0) : counts[key] ?? 0);
    const pickTab = (key) => {
        setSearch(key === 'open' ? {} : { status: key }, { replace: true });
        setPage(1);
    };

    return (
        <div className="space-y-5">
            <PageHeader
                title="Orders"
                subtitle={dataUpdatedAt ? `Updates every 30 seconds · last checked ${new Date(dataUpdatedAt).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}` : 'Updates every 30 seconds'}
                actions={
                    <button type="button" className="btn-outline" onClick={() => refetch()} disabled={isFetching}>
                        <RefreshCw className={`h-4 w-4 ${isFetching ? 'animate-spin' : ''}`} aria-hidden="true" />
                        Refresh
                    </button>
                }
            />

            <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
                <div className="flex w-max gap-1 rounded-xl border border-slate-200 bg-white p-1" role="tablist" aria-label="Order status">
                    {ORDER_TABS.map((t) => {
                        const n = countFor(t.key);
                        const active = status === t.key;
                        return (
                            <button
                                key={t.key}
                                type="button"
                                role="tab"
                                aria-selected={active}
                                onClick={() => pickTab(t.key)}
                                className={`flex items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium transition ${active ? 'bg-brand-700 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-100'}`}
                            >
                                {t.label}
                                {n > 0 && (
                                    <span className={`rounded-full px-1.5 text-[11px] leading-5 ${active ? 'bg-white/20' : t.key === 'placed' ? 'bg-red-600 text-white' : 'bg-slate-100 text-slate-600'}`}>{n}</span>
                                )}
                            </button>
                        );
                    })}
                </div>
            </div>

            <div className="flex flex-wrap items-end gap-3">
                <div className="relative min-w-56 flex-1">
                    <label className="label text-xs" htmlFor="order-search">Order number</label>
                    <Search className="pointer-events-none absolute bottom-2.5 left-3 h-4 w-4 text-slate-400" aria-hidden="true" />
                    <input id="order-search" type="search" className="input pl-9" placeholder="Search by order number" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
                </div>
                <DateRange from={range.from} to={range.to} onChange={(r) => { setRange(r); setPage(1); }} />
            </div>

            <ErrorNote error={error} />

            {isLoading && <p className="text-sm text-slate-500">Loading…</p>}
            {data?.items.length === 0 && (
                <div className="card py-10 text-center text-sm text-slate-500">
                    {status === 'open' ? 'No open orders right now. New orders show up here automatically.' : 'No orders match.'}
                </div>
            )}

            {data?.items.length > 0 && (
                <>
                    {/* Phones: one card per order. */}
                    <ul className="space-y-3 md:hidden">
                        {data.items.map((o) => (
                            <li key={o._id}>
                                <Link to={`/orders/${o._id}`} className={`card block p-4 ${o.status === 'placed' ? 'border-red-200' : ''}`}>
                                    <div className="flex items-center justify-between gap-2">
                                        <span className="font-semibold">#{o.orderNumber}</span>
                                        <Badge tone={STATUS_TONES[o.status]}>{STATUS_LABELS[o.status]}</Badge>
                                    </div>
                                    <p className="mt-1 text-sm text-slate-600">
                                        {itemCount(o)} item{itemCount(o) === 1 ? '' : 's'} · {formatPaise(o.pricing.subtotalPaise)} · {o.payment.method === 'cod' ? 'Cash on delivery' : 'Paid online'}
                                    </p>
                                    <p className="text-xs text-slate-500">{o.address?.name} · {o.address?.pincode}</p>
                                    <p className="mt-1 flex items-center justify-between text-xs text-slate-500">
                                        <span>Slot: {slotText(o)}</span>
                                        <ChevronRight className="h-4 w-4" aria-hidden="true" />
                                    </p>
                                </Link>
                            </li>
                        ))}
                    </ul>

                    <div className="card hidden overflow-x-auto p-0 md:block">
                        <table className="w-full text-sm">
                            <thead className="text-left">
                                <tr>
                                    <th className="px-4 py-3">Order</th>
                                    <th className="px-4 py-3">Placed</th>
                                    <th className="px-4 py-3">Items</th>
                                    <th className="px-4 py-3">Value</th>
                                    <th className="px-4 py-3">Customer area</th>
                                    <th className="px-4 py-3">Slot</th>
                                    <th className="px-4 py-3">Status</th>
                                </tr>
                            </thead>
                            <tbody>
                                {data.items.map((o) => (
                                    <tr key={o._id} className="cursor-pointer border-t border-slate-100" onClick={() => navigate(`/orders/${o._id}`)}>
                                        <td className="px-4 py-3">
                                            <Link to={`/orders/${o._id}`} className="font-semibold text-slate-900 hover:underline" onClick={(e) => e.stopPropagation()}>#{o.orderNumber}</Link>
                                            <span className="block text-xs text-slate-500">{shopLabel(o.module)}</span>
                                        </td>
                                        <td className="whitespace-nowrap px-4 py-3 text-slate-600">{formatDateTime(o.createdAt)}</td>
                                        <td className="px-4 py-3">
                                            <span className="tabular-nums">{itemCount(o)}</span>
                                            <span className="block max-w-56 truncate text-xs text-slate-500">{o.items.map((l) => l.name).join(', ')}</span>
                                        </td>
                                        <td className="px-4 py-3 tabular-nums">
                                            {formatPaise(o.pricing.subtotalPaise)}
                                            <span className="block text-xs text-slate-500">{o.payment.method === 'cod' ? 'Cash on delivery' : 'Paid online'}</span>
                                        </td>
                                        <td className="px-4 py-3">
                                            {o.address?.name}
                                            <span className="block text-xs text-slate-500">{o.address?.pincode}</span>
                                        </td>
                                        <td className="px-4 py-3 text-slate-600">{slotText(o)}</td>
                                        <td className="px-4 py-3"><Badge tone={STATUS_TONES[o.status]}>{STATUS_LABELS[o.status]}</Badge></td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </>
            )}
            <Pager page={page} pages={data?.pages} onChange={setPage} />
        </div>
    );
}
