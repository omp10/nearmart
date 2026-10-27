import { useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router';
import { Printer } from 'lucide-react';
import { useAuth } from '../auth/AuthProvider.jsx';
import { api } from '../lib/api.js';
import { formatDate } from '../lib/format.js';
import { formatPaise } from '../lib/money.js';
import { PAYOUT_MODES, PAYOUT_STATUS } from '../components/money.jsx';
import { Badge, ErrorNote, Loading, Notice, PageHeader, Pager } from '../components/ui.jsx';

export function Payouts() {
    const navigate = useNavigate();
    const [page, setPage] = useState(1);
    const { data, isLoading, error } = useQuery({
        queryKey: ['payouts', page],
        queryFn: () => api.get('/seller/payouts', { params: { page, limit: 20 } }).then((r) => r.data.data),
        placeholderData: keepPreviousData
    });

    return (
        <div className="space-y-5">
            <PageHeader title="Payouts" subtitle="Money Nearmart has sent, or is sending, to your bank account or UPI." />
            <Notice tone="blue">
                Nearmart bundles your delivered orders into a payout once their hold period is over. Each payout has a statement listing its orders.
                See <Link to="/commission" className="font-medium underline">Commission</Link> for how it works.
            </Notice>
            <ErrorNote error={error} />
            {isLoading && <Loading />}
            {data?.items.length === 0 && <div className="card py-10 text-center text-sm text-slate-500">No payouts yet. Your first one comes after your first delivered orders clear the hold period.</div>}

            {data?.items.length > 0 && (
                <>
                    <ul className="space-y-2 md:hidden">
                        {data.items.map((p) => (
                            <li key={p._id}>
                                <Link to={`/payouts/${p._id}`} className="card block p-3">
                                    <div className="flex items-center justify-between gap-2">
                                        <span className="font-medium">{p.number}</span>
                                        <span className="font-semibold tabular-nums">{formatPaise(p.netPaise)}</span>
                                    </div>
                                    <p className="text-xs text-slate-500">{p.orderCount} orders · {p.status === 'paid' ? `paid ${formatDate(p.paidAt)}` : `created ${formatDate(p.createdAt)}`}</p>
                                    <div className="mt-1"><Badge tone={PAYOUT_STATUS[p.status]?.tone}>{PAYOUT_STATUS[p.status]?.label}</Badge></div>
                                </Link>
                            </li>
                        ))}
                    </ul>
                    <div className="card hidden overflow-x-auto p-0 md:block">
                        <table className="w-full text-sm">
                            <thead className="text-left">
                                <tr>
                                    <th className="px-4 py-3">Payout</th>
                                    <th className="px-4 py-3">Created</th>
                                    <th className="px-4 py-3 text-right">Orders</th>
                                    <th className="px-4 py-3 text-right">Item value</th>
                                    <th className="px-4 py-3 text-right">Commission + fees</th>
                                    <th className="px-4 py-3 text-right">Amount</th>
                                    <th className="px-4 py-3">Status</th>
                                </tr>
                            </thead>
                            <tbody>
                                {data.items.map((p) => (
                                    <tr key={p._id} className="cursor-pointer border-t border-slate-100" onClick={() => navigate(`/payouts/${p._id}`)}>
                                        <td className="px-4 py-3"><Link to={`/payouts/${p._id}`} className="font-medium hover:underline" onClick={(e) => e.stopPropagation()}>{p.number}</Link></td>
                                        <td className="whitespace-nowrap px-4 py-3 text-slate-600">{formatDate(p.createdAt)}</td>
                                        <td className="px-4 py-3 text-right tabular-nums">{p.orderCount}</td>
                                        <td className="px-4 py-3 text-right tabular-nums">{formatPaise(p.grossPaise)}</td>
                                        <td className="px-4 py-3 text-right tabular-nums text-slate-600">−{formatPaise(p.commissionPaise + p.feePaise)}</td>
                                        <td className="px-4 py-3 text-right font-semibold tabular-nums">{formatPaise(p.netPaise)}</td>
                                        <td className="px-4 py-3">
                                            <Badge tone={PAYOUT_STATUS[p.status]?.tone}>{PAYOUT_STATUS[p.status]?.label}</Badge>
                                            {p.paidAt && <span className="block text-xs text-slate-500">{formatDate(p.paidAt)}</span>}
                                        </td>
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

function Line({ label, value, strong }) {
    return (
        <div className={`flex justify-between gap-3 py-1 ${strong ? 'border-t border-slate-200 pt-2 text-base font-semibold text-slate-900' : 'text-slate-600'}`}>
            <span>{label}</span>
            <span className="tabular-nums">{value}</span>
        </div>
    );
}

/** A payout statement: totals, how it was paid, and every order in it. */
export function PayoutDetail() {
    const { id } = useParams();
    const { seller } = useAuth();
    const { data: p, isLoading, error } = useQuery({
        queryKey: ['payout', id],
        queryFn: () => api.get(`/seller/payouts/${id}`).then((r) => r.data.data)
    });

    if (isLoading) return <Loading />;
    if (error) {
        return (
            <div className="space-y-3">
                <Link to="/payouts" className="text-sm text-slate-500 hover:underline">← Payouts</Link>
                <ErrorNote error={error} />
            </div>
        );
    }

    return (
        <div className="space-y-6">
            <PageHeader
                back={<Link to="/payouts" className="text-sm text-slate-500 hover:underline print:hidden">← Payouts</Link>}
                title={`Payout ${p.number}`}
                subtitle={`${seller.businessName} · orders delivered up to ${formatDate(p.periodTo)}`}
                actions={
                    <button type="button" className="btn-outline print:hidden" onClick={() => window.print()}>
                        <Printer className="h-4 w-4" aria-hidden="true" />
                        Print statement
                    </button>
                }
            />

            <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
                <section className="card space-y-0.5 text-sm">
                    <h2 className="mb-2 font-semibold">Summary</h2>
                    <Line label={`Item value (${p.orderCount} orders)`} value={formatPaise(p.grossPaise)} />
                    <Line label="Nearmart commission" value={`−${formatPaise(p.commissionPaise)}`} />
                    <Line label="Fixed fees" value={`−${formatPaise(p.feePaise)}`} />
                    <Line label="Amount to you" value={formatPaise(p.netPaise)} strong />
                </section>
                <section className="card space-y-1 text-sm">
                    <h2 className="mb-2 font-semibold">Status</h2>
                    <Badge tone={PAYOUT_STATUS[p.status]?.tone}>{PAYOUT_STATUS[p.status]?.label}</Badge>
                    <p className="text-slate-600">Created {formatDate(p.createdAt)}</p>
                    {p.status === 'paid' && (
                        <>
                            <p>Paid on {formatDate(p.paidAt)}{p.mode && ` by ${PAYOUT_MODES[p.mode] ?? p.mode}`}</p>
                            {p.reference && <p className="break-all text-slate-600">Reference: {p.reference}</p>}
                        </>
                    )}
                    {p.status === 'pending' && <p className="text-slate-600">Nearmart is sending this payment.</p>}
                    {p.status === 'cancelled' && <p className="text-slate-600">This payout was cancelled. Its orders go into your next payout.</p>}
                    {p.note && <p className="text-slate-600">Note: {p.note}</p>}
                </section>
            </div>

            <section className="card overflow-x-auto p-0">
                <h2 className="px-4 pt-4 pb-2 font-semibold">Orders in this payout</h2>
                <table className="w-full min-w-[640px] text-sm">
                    <thead className="text-left">
                        <tr>
                            <th className="px-4 py-3">Order</th>
                            <th className="px-4 py-3">Delivered</th>
                            <th className="px-4 py-3 text-right">Item value</th>
                            <th className="px-4 py-3 text-right">Commission</th>
                            <th className="px-4 py-3 text-right">Fee</th>
                            <th className="px-4 py-3 text-right">You earn</th>
                        </tr>
                    </thead>
                    <tbody>
                        {p.orders.map((o) => (
                            <tr key={o._id} className="border-t border-slate-100">
                                <td className="px-4 py-3"><Link to={`/orders/${o._id}`} className="font-medium hover:underline">#{o.orderNumber}</Link></td>
                                <td className="whitespace-nowrap px-4 py-3 text-slate-600">{formatDate(o.deliveredAt)}</td>
                                <td className="px-4 py-3 text-right tabular-nums">{formatPaise(o.grossPaise)}</td>
                                <td className="px-4 py-3 text-right tabular-nums text-slate-600">−{formatPaise(o.commissionPaise)} <span className="text-xs text-slate-400">({o.commissionPercent}%)</span></td>
                                <td className="px-4 py-3 text-right tabular-nums text-slate-600">{o.feePaise ? `−${formatPaise(o.feePaise)}` : '—'}</td>
                                <td className="px-4 py-3 text-right font-semibold tabular-nums">{formatPaise(o.netPaise)}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </section>
        </div>
    );
}
