import { useEffect, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Link, useLocation } from 'react-router';
import { api } from '../lib/api.js';
import { firstOfMonth, formatDate, isoDay } from '../lib/format.js';
import { formatPaise, formatSignedPaise } from '../lib/money.js';
import { BalanceGrid } from '../components/money.jsx';
import { Badge, DateRange, ErrorNote, Loading, PageHeader, Pager } from '../components/ui.jsx';

/** Credits and debits Nearmart made to the balance (GET /seller/adjustments). */
function Adjustments() {
    const [page, setPage] = useState(1);
    const location = useLocation();
    const { data, isLoading, error } = useQuery({
        queryKey: ['adjustments', page],
        queryFn: () => api.get('/seller/adjustments', { params: { page, limit: 20 } }).then((r) => r.data.data),
        placeholderData: keepPreviousData
    });

    // Opened from an adjustment notification: scroll here once the list is in.
    useEffect(() => {
        if (location.hash === '#adjustments' && data) document.getElementById('adjustments')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, [location.hash, data]);

    return (
        <section id="adjustments" className="scroll-mt-24 space-y-3">
            <div>
                <h2 className="text-lg font-semibold">Adjustments</h2>
                <p className="text-sm text-slate-500">Credits and deductions Nearmart made to your balance, for example for a damaged item or a goodwill refund. Pending ones go into your next payout.</p>
            </div>
            <ErrorNote error={error} />
            {isLoading && <Loading />}
            {data?.items.length === 0 && <div className="card py-6 text-center text-sm text-slate-500">No adjustments so far.</div>}
            {data?.items.length > 0 && (
                <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
                    {data.items.map((a) => (
                        <li key={a._id} className="flex flex-wrap items-start gap-3 px-4 py-3">
                            <div className="min-w-0 flex-1">
                                <p className="text-sm font-medium text-slate-900">{a.reason || (a.amountPaise < 0 ? 'Deduction' : 'Credit')}</p>
                                <p className="text-xs text-slate-500">
                                    {formatDate(a.createdAt)}
                                    {a.order?.orderNumber && (
                                        <>
                                            {' · '}
                                            <Link to={`/orders/${a.order._id}`} className="hover:underline">Order #{a.order.orderNumber}</Link>
                                        </>
                                    )}
                                </p>
                            </div>
                            <div className="text-right">
                                <p className={`font-semibold tabular-nums ${a.amountPaise < 0 ? 'text-red-700' : 'text-brand-700'}`}>{formatSignedPaise(a.amountPaise)}</p>
                                {a.payout ? (
                                    <Link to={`/payouts/${a.payout}`}><Badge tone="green">Settled in a payout</Badge></Link>
                                ) : (
                                    <Badge tone="amber">Pending: next payout</Badge>
                                )}
                            </div>
                        </li>
                    ))}
                </ul>
            )}
            <Pager page={page} pages={data?.pages} onChange={setPage} />
        </section>
    );
}

function Total({ label, value, tone = '', sign = '' }) {
    return (
        <div className="rounded-lg border border-slate-100 bg-white p-3">
            <p className="text-xs font-medium text-slate-500">{label}</p>
            <p className={`mt-0.5 text-lg font-semibold tabular-nums ${tone}`}>{sign}{value}</p>
        </div>
    );
}

const PRESETS = [
    { label: 'This month', range: () => ({ from: firstOfMonth(), to: isoDay() }) },
    {
        label: 'Last month',
        range: () => {
            const now = new Date();
            const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
            const end = new Date(now.getFullYear(), now.getMonth(), 0);
            return { from: isoDay(start), to: isoDay(end) };
        }
    },
    { label: 'All time', range: () => ({ from: '', to: '' }) }
];

export default function Earnings() {
    const [range, setRange] = useState(() => PRESETS[0].range());
    const [page, setPage] = useState(1);
    const params = { page, limit: 20, from: range.from || undefined, to: range.to || undefined };
    const { data, isLoading, error } = useQuery({
        queryKey: ['earnings', params],
        queryFn: () => api.get('/seller/earnings', { params }).then((r) => r.data.data),
        placeholderData: keepPreviousData
    });
    const pick = (r) => {
        setRange(r);
        setPage(1);
    };
    const t = data?.totals;

    return (
        <div className="space-y-6">
            <PageHeader title="Earnings" subtitle="What you earned on delivered orders: item value minus Nearmart's commission and fee, and any coupon discounts you funded." />

            {data?.balance && (
                <section className="card">
                    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                        <h2 className="font-semibold">Your balance</h2>
                        <Link to="/payouts" className="text-sm text-brand-700 hover:underline">See payouts</Link>
                    </div>
                    <BalanceGrid balance={data.balance} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" />
                </section>
            )}

            <section className="space-y-4">
                <div className="flex flex-wrap items-end justify-between gap-3">
                    <DateRange from={range.from} to={range.to} onChange={pick} />
                    <div className="flex flex-wrap gap-1">
                        {PRESETS.map((p) => {
                            const r = p.range();
                            const active = r.from === range.from && r.to === range.to;
                            return (
                                <button key={p.label} type="button" className={`rounded-full border px-3 py-1 text-xs font-medium ${active ? 'border-brand-700 bg-brand-700 text-white' : 'border-slate-200 bg-white text-slate-600'}`} onClick={() => pick(r)}>
                                    {p.label}
                                </button>
                            );
                        })}
                    </div>
                </div>

                <ErrorNote error={error} />
                {isLoading && <Loading />}

                {t && (
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
                        <Total label="Delivered orders" value={t.orders} />
                        <Total label="Item value" value={formatPaise(t.grossPaise)} />
                        <Total label="Commission" value={formatPaise(t.commissionPaise)} sign="−" tone="text-slate-600" />
                        <Total label="Fixed fees" value={formatPaise(t.feePaise)} sign="−" tone="text-slate-600" />
                        <Total label="Your coupon discounts" value={formatPaise(t.sellerDiscountPaise ?? 0)} sign="−" tone="text-slate-600" />
                        <div className="col-span-2 rounded-lg border border-brand-200 bg-brand-50 p-3 sm:col-span-1">
                            <p className="text-xs font-medium text-brand-700">You earned</p>
                            <p className="mt-0.5 text-xl font-semibold tabular-nums text-brand-800">{formatPaise(t.netPaise)}</p>
                        </div>
                    </div>
                )}

                {data?.items.length === 0 && <div className="card py-10 text-center text-sm text-slate-500">No delivered orders in these dates.</div>}

                {data?.items.length > 0 && (
                    <>
                        <ul className="space-y-2 md:hidden">
                            {data.items.map((o) => (
                                <li key={o._id}>
                                    <Link to={`/orders/${o._id}`} className="card block p-3">
                                        <div className="flex items-center justify-between gap-2">
                                            <span className="font-medium">#{o.orderNumber}</span>
                                            <span className="font-semibold tabular-nums text-brand-800">{formatPaise(o.netPaise)}</span>
                                        </div>
                                        <p className="text-xs text-slate-500">
                                            Delivered {formatDate(o.deliveredAt)} · items {formatPaise(o.grossPaise)} − commission {formatPaise(o.commissionPaise)}
                                            {o.feePaise > 0 && ` − fee ${formatPaise(o.feePaise)}`}
                                            {o.sellerDiscountPaise > 0 && ` − your coupon ${formatPaise(o.sellerDiscountPaise)}`}
                                        </p>
                                        <div className="mt-1">{o.payout ? <Badge tone="green">In a payout</Badge> : <Badge>Not paid out yet</Badge>}</div>
                                    </Link>
                                </li>
                            ))}
                        </ul>
                        <div className="card hidden overflow-x-auto p-0 md:block">
                            <table className="w-full text-sm">
                                <thead className="text-left">
                                    <tr>
                                        <th className="px-4 py-3">Order</th>
                                        <th className="px-4 py-3">Delivered</th>
                                        <th className="px-4 py-3 text-right">Item value</th>
                                        <th className="px-4 py-3 text-right">Commission</th>
                                        <th className="px-4 py-3 text-right">Fee</th>
                                        <th className="px-4 py-3 text-right" title="Coupon discounts funded by you">Your coupon</th>
                                        <th className="px-4 py-3 text-right">You earn</th>
                                        <th className="px-4 py-3">Payout</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {data.items.map((o) => (
                                        <tr key={o._id} className="border-t border-slate-100">
                                            <td className="px-4 py-3"><Link to={`/orders/${o._id}`} className="font-medium hover:underline">#{o.orderNumber}</Link></td>
                                            <td className="whitespace-nowrap px-4 py-3 text-slate-600">{formatDate(o.deliveredAt)}</td>
                                            <td className="px-4 py-3 text-right tabular-nums">{formatPaise(o.grossPaise)}</td>
                                            <td className="px-4 py-3 text-right tabular-nums text-slate-600">
                                                −{formatPaise(o.commissionPaise)}
                                                <span className="block text-xs text-slate-400">{o.commissionPercent}%</span>
                                            </td>
                                            <td className="px-4 py-3 text-right tabular-nums text-slate-600">{o.feePaise ? `−${formatPaise(o.feePaise)}` : '—'}</td>
                                            <td className="px-4 py-3 text-right tabular-nums text-slate-600">{o.sellerDiscountPaise ? `−${formatPaise(o.sellerDiscountPaise)}` : '—'}</td>
                                            <td className="px-4 py-3 text-right font-semibold tabular-nums">{formatPaise(o.netPaise)}</td>
                                            <td className="px-4 py-3">{o.payout ? <Badge tone="green">In a payout</Badge> : <Badge>Not yet</Badge>}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </>
                )}
                <Pager page={page} pages={data?.pages} onChange={setPage} />
            </section>

            <Adjustments />
        </div>
    );
}
