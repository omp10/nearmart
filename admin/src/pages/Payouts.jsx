import { useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { useAuth } from '../auth/AuthProvider.jsx';
import { api } from '../lib/api.js';
import { formatPaise } from '../lib/money.js';
import { PAYOUT_MODES, PAYOUT_MODE_LABELS, PAYOUT_STATUS_LABELS, PAYOUT_STATUS_TONES, SELLER_STATUS_LABELS, downloadText, toCsv } from '../lib/sellers.js';
import { BUSINESS_MODULES } from '../nav.js';
import { Badge, ErrorNote, Modal, Pager } from '../components/ui.jsx';

const when = (d) => (d ? new Date(d).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');
const day = (d) => (d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
const MODULE_LABELS = Object.fromEntries(BUSINESS_MODULES.map((m) => [m.id, m.label]));

const TABS = [
    ['balances', 'Balances'],
    ['payouts', 'Payouts'],
    ['report', 'Commission report']
];

/** Pill filters, as on the Orders page. */
function Pills({ options, value, onChange, label }) {
    return (
        <div className="flex flex-wrap gap-1" role="tablist" aria-label={label}>
            {options.map(([v, text]) => (
                <button
                    key={v || 'all'}
                    type="button"
                    role="tab"
                    aria-selected={value === v}
                    onClick={() => onChange(v)}
                    className={`rounded-full border px-3 py-1 text-sm ${value === v ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-slate-200 text-slate-600'}`}
                >
                    {text}
                </button>
            ))}
        </div>
    );
}

/** Per-order settlement rows: gross, commission, fee, seller-funded coupon and what the seller gets. */
function StatementTable({ orders, empty }) {
    return (
        <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-slate-500">
                <tr>
                    <th className="px-4 py-3 font-medium">Order</th>
                    <th className="px-4 py-3 font-medium">Delivered</th>
                    <th className="px-4 py-3 text-right font-medium">Items</th>
                    <th className="px-4 py-3 text-right font-medium">Commission</th>
                    <th className="px-4 py-3 text-right font-medium">Fee</th>
                    <th className="px-4 py-3 text-right font-medium" title="Coupon discounts the seller pays">Seller coupon</th>
                    <th className="px-4 py-3 text-right font-medium">Seller gets</th>
                </tr>
            </thead>
            <tbody>
                {!orders?.length && <tr><td colSpan={7} className="px-4 py-6 text-center text-slate-500">{empty}</td></tr>}
                {orders?.map((o) => (
                    <tr key={o._id} className="border-t border-slate-100">
                        <td className="px-4 py-3">
                            <Link to={`/orders/${o._id}`} className="font-medium text-brand-700 hover:underline">#{o.orderNumber}</Link>
                            <span className="block text-xs text-slate-500">{MODULE_LABELS[o.module] ?? o.module} · {o.payment?.method === 'cod' ? 'Cash' : 'Online'}</span>
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-slate-600">{day(o.deliveredAt ?? o.createdAt)}</td>
                        <td className="px-4 py-3 text-right tabular-nums">{formatPaise(o.grossPaise)}</td>
                        <td className="px-4 py-3 text-right tabular-nums text-slate-600">
                            −{formatPaise(o.commissionPaise)}
                            <span className="block text-xs text-slate-400">{o.commissionPercent}%</span>
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums text-slate-600">{o.feePaise ? `−${formatPaise(o.feePaise)}` : '—'}</td>
                        <td className="px-4 py-3 text-right tabular-nums text-slate-600">{o.sellerDiscountPaise ? `−${formatPaise(o.sellerDiscountPaise)}` : '—'}</td>
                        <td className="px-4 py-3 text-right font-medium tabular-nums">{formatPaise(o.netPaise)}</td>
                    </tr>
                ))}
            </tbody>
        </table>
    );
}

/** A seller's delivered orders with what they earned on each. */
function EarningsView({ seller }) {
    const [page, setPage] = useState(1);
    const { data, isLoading, error } = useQuery({
        queryKey: ['seller-earnings', seller._id, page],
        queryFn: () => api.get(`/admin/payouts/sellers/${seller._id}/earnings`, { params: { page, limit: 20 } }).then((r) => r.data.data),
        placeholderData: keepPreviousData
    });

    if (isLoading) return <p className="text-sm text-slate-500">Loading…</p>;
    if (error) return <ErrorNote error={error} />;

    const t = data.totals;
    return (
        <div className="space-y-4">
            <p className="text-sm text-slate-600">
                {t.orders} delivered orders · items {formatPaise(t.grossPaise)} · commission {formatPaise(t.commissionPaise)} · fees {formatPaise(t.feePaise)} ·{' '}
                {t.sellerDiscountPaise > 0 && <>seller-funded coupons {formatPaise(t.sellerDiscountPaise)} ·{' '}</>}
                <span className="font-medium text-slate-800">seller earned {formatPaise(t.netPaise)}</span>
            </p>
            <div className="max-h-[60vh] overflow-auto rounded-lg border border-slate-100">
                <StatementTable orders={data.items} empty="No delivered orders yet." />
            </div>
            <Pager page={page} pages={data.pages} onChange={setPage} />
        </div>
    );
}

function BalancesTab() {
    const { can } = useAuth();
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const [earnings, setEarnings] = useState(null);

    const { data, isLoading, error } = useQuery({
        queryKey: ['payout-balances'],
        queryFn: () => api.get('/admin/payouts/balances').then((r) => r.data.data),
        refetchInterval: 60_000
    });
    const create = useMutation({
        mutationFn: (sellerId) => api.post('/admin/payouts', { sellerId }),
        onSuccess: (res) => {
            queryClient.invalidateQueries({ queryKey: ['payout-balances'] });
            queryClient.invalidateQueries({ queryKey: ['payouts'] });
            navigate(`/payouts/${res.data.data._id}`);
        }
    });
    const canCreate = can('payouts', 'create');
    const totals = (data ?? []).reduce((t, r) => ({ payable: t.payable + r.payablePaise, onHold: t.onHold + r.onHoldPaise, inPayout: t.inPayout + r.inPayoutPaise }), { payable: 0, onHold: 0, inPayout: 0 });

    return (
        <div className="space-y-4">
            <p className="text-sm text-slate-500">
                What each seller is owed for delivered orders, after commission. Orders become payable once the hold period after delivery ends.
                {data && ` In all: ${formatPaise(totals.payable)} payable, ${formatPaise(totals.onHold)} on hold, ${formatPaise(totals.inPayout)} waiting to be paid.`}
            </p>
            <ErrorNote error={error || create.error} />
            <div className="card overflow-x-auto p-0">
                <table className="w-full text-sm">
                    <thead className="bg-slate-50 text-left text-slate-500">
                        <tr>
                            <th className="px-4 py-3 font-medium">Seller</th>
                            <th className="px-4 py-3 text-right font-medium">Payable</th>
                            <th className="px-4 py-3 text-right font-medium" title="Credits and debits waiting for the next payout (already in Payable)">Adjustments</th>
                            <th className="px-4 py-3 text-right font-medium">On hold</th>
                            <th className="px-4 py-3 text-right font-medium">In payout</th>
                            <th className="px-4 py-3 text-right font-medium">Paid</th>
                            <th className="px-4 py-3" />
                        </tr>
                    </thead>
                    <tbody>
                        {isLoading && <tr><td colSpan={7} className="px-4 py-6 text-center text-slate-500">Loading…</td></tr>}
                        {data?.length === 0 && <tr><td colSpan={7} className="px-4 py-6 text-center text-slate-500">No approved sellers yet.</td></tr>}
                        {data?.map((r) => (
                            <tr key={r.seller._id} className="border-t border-slate-100 hover:bg-slate-50">
                                <td className="px-4 py-3">
                                    {can('sellers') ? (
                                        <Link to={`/sellers/${r.seller._id}`} className="font-medium text-brand-700 hover:underline">{r.seller.businessName}</Link>
                                    ) : (
                                        <span className="font-medium">{r.seller.businessName}</span>
                                    )}
                                    {r.seller.status !== 'approved' && <span className="ml-2"><Badge tone="red">{SELLER_STATUS_LABELS[r.seller.status] ?? r.seller.status}</Badge></span>}
                                    {!r.seller.hasBank && <span className="block text-xs text-amber-700">No bank account or UPI ID on file</span>}
                                </td>
                                <td className={`px-4 py-3 text-right tabular-nums ${r.payablePaise > 0 ? 'font-medium' : 'text-slate-400'}`}>
                                    {formatPaise(r.payablePaise)}
                                    {r.payableOrders > 0 && <span className="block text-xs font-normal text-slate-500">{r.payableOrders} orders</span>}
                                </td>
                                <td className={`px-4 py-3 text-right tabular-nums ${r.adjustmentsPaise < 0 ? 'text-red-700' : r.adjustmentsPaise > 0 ? 'text-brand-700' : 'text-slate-400'}`}>
                                    {r.adjustmentsPaise ? `${r.adjustmentsPaise < 0 ? '−' : '+'}${formatPaise(Math.abs(r.adjustmentsPaise))}` : '—'}
                                </td>
                                <td className="px-4 py-3 text-right tabular-nums text-slate-600">{formatPaise(r.onHoldPaise)}</td>
                                <td className={`px-4 py-3 text-right tabular-nums ${r.inPayoutPaise > 0 ? 'text-amber-700' : 'text-slate-600'}`}>{formatPaise(r.inPayoutPaise)}</td>
                                <td className="px-4 py-3 text-right tabular-nums text-slate-600">{formatPaise(r.paidPaise)}</td>
                                <td className="whitespace-nowrap px-4 py-3 text-right">
                                    <button type="button" className="btn-ghost px-2 py-1" onClick={() => setEarnings(r.seller)}>Earnings</button>
                                    {canCreate && r.payablePaise > 0 && (
                                        <button
                                            type="button"
                                            className="btn-primary ml-2 px-3 py-1"
                                            disabled={create.isPending}
                                            onClick={() =>
                                                window.confirm(
                                                    `Create a payout of ${formatPaise(r.payablePaise)} for ${r.seller.businessName}?${r.seller.hasBank ? '' : '\n\nThey have no bank account or UPI ID on file yet.'}`
                                                ) && create.mutate(r.seller._id)
                                            }
                                        >
                                            Create payout
                                        </button>
                                    )}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            <Modal open={Boolean(earnings)} title={earnings ? `${earnings.businessName}: earnings` : ''} onClose={() => setEarnings(null)} wide>
                {earnings && <EarningsView seller={earnings} />}
            </Modal>
        </div>
    );
}

function PayoutsTab() {
    const navigate = useNavigate();
    const [status, setStatus] = useState('pending');
    const [page, setPage] = useState(1);

    const params = { page, limit: 25, ...(status ? { status } : {}) };
    const { data, isLoading, error } = useQuery({
        queryKey: ['payouts', params],
        queryFn: () => api.get('/admin/payouts', { params }).then((r) => r.data.data),
        placeholderData: keepPreviousData
    });

    return (
        <div className="space-y-4">
            <Pills
                label="Payout status"
                value={status}
                onChange={(v) => {
                    setStatus(v);
                    setPage(1);
                }}
                options={[['pending', 'To pay'], ['paid', 'Paid'], ['cancelled', 'Cancelled'], ['', 'All']]}
            />
            <ErrorNote error={error} />
            <div className="card overflow-x-auto p-0">
                <table className="w-full text-sm">
                    <thead className="bg-slate-50 text-left text-slate-500">
                        <tr>
                            <th className="px-4 py-3 font-medium">Payout</th>
                            <th className="px-4 py-3 font-medium">Seller</th>
                            <th className="px-4 py-3 text-right font-medium">Orders</th>
                            <th className="px-4 py-3 text-right font-medium">Amount</th>
                            <th className="px-4 py-3 font-medium">Created</th>
                            <th className="px-4 py-3 font-medium">Status</th>
                        </tr>
                    </thead>
                    <tbody>
                        {isLoading && <tr><td colSpan={6} className="px-4 py-6 text-center text-slate-500">Loading…</td></tr>}
                        {data?.items.length === 0 && <tr><td colSpan={6} className="px-4 py-6 text-center text-slate-500">No payouts here.</td></tr>}
                        {data?.items.map((p) => (
                            <tr key={p._id} className="cursor-pointer border-t border-slate-100 hover:bg-slate-50" onClick={() => navigate(`/payouts/${p._id}`)}>
                                <td className="px-4 py-3">
                                    <Link to={`/payouts/${p._id}`} className="font-medium text-brand-700 hover:underline" onClick={(e) => e.stopPropagation()}>{p.number}</Link>
                                    <span className="block text-xs text-slate-500">Up to {day(p.periodTo)}</span>
                                </td>
                                <td className="px-4 py-3">{p.seller?.businessName ?? '—'}</td>
                                <td className="px-4 py-3 text-right tabular-nums">{p.orderCount}</td>
                                <td className="px-4 py-3 text-right font-medium tabular-nums">{formatPaise(p.netPaise)}</td>
                                <td className="whitespace-nowrap px-4 py-3 text-slate-600">{when(p.createdAt)}</td>
                                <td className="px-4 py-3">
                                    <Badge tone={PAYOUT_STATUS_TONES[p.status]}>{PAYOUT_STATUS_LABELS[p.status] ?? p.status}</Badge>
                                    {p.status === 'paid' && (
                                        <span className="block text-xs text-slate-500">
                                            {PAYOUT_MODE_LABELS[p.mode] ?? p.mode}{p.reference && ` · ${p.reference}`}
                                        </span>
                                    )}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
            <Pager page={page} pages={data?.pages} onChange={setPage} />
        </div>
    );
}

/** YYYY-MM-DD of a date in India time. */
const istDay = (d = new Date()) => new Date(d.getTime() + 330 * 60_000).toISOString().slice(0, 10);
const monthStart = () => `${istDay().slice(0, 8)}01`;
const rupees = (paise) => ((paise ?? 0) / 100).toFixed(2);

function SummaryCard({ label, value, hint }) {
    return (
        <div className="card">
            <p className="text-xs text-slate-500">{label}</p>
            <p className="text-xl font-semibold tabular-nums">{value}</p>
            {hint && <p className="text-xs text-slate-500">{hint}</p>}
        </div>
    );
}

/** What Nearmart earned from sellers in a date range, per seller, with a CSV export. */
function ReportTab() {
    const { can } = useAuth();
    const [range, setRange] = useState(() => ({ from: monthStart(), to: istDay() }));
    const params = { ...(range.from ? { from: range.from } : {}), ...(range.to ? { to: range.to } : {}) };
    const badRange = range.from && range.to && range.from > range.to;
    const { data, isLoading, isFetching, error } = useQuery({
        queryKey: ['commission-report', params],
        queryFn: () => api.get('/admin/payouts/report', { params }).then((r) => r.data.data),
        placeholderData: keepPreviousData,
        enabled: !badRange
    });
    const t = data?.totals;

    const download = () => {
        const header = ['Seller', 'Seller ID', 'Shops (orders)', 'Orders', 'Items sold (Rs)', 'Commission (Rs)', 'Fixed fees (Rs)', 'Seller-funded coupons (Rs)', 'Seller earned (Rs)'];
        const shops = (byModule) => Object.entries(byModule ?? {}).map(([m, n]) => `${MODULE_LABELS[m] ?? m} ${n}`).join('; ');
        const rows = data.sellers.map((r) => [r.name, r.sellerId, shops(r.byModule), r.orders, rupees(r.grossPaise), rupees(r.commissionPaise), rupees(r.feePaise), rupees(r.sellerDiscountPaise), rupees(r.netPaise)]);
        const totalRow = ['All sellers', '', '', t.orders, rupees(t.grossPaise), rupees(t.commissionPaise), rupees(t.feePaise), rupees(t.sellerDiscountPaise), rupees(t.netPaise)];
        const extra = [[], ['Nearmart own sales', '', '', data.nearmart.orders, rupees(data.nearmart.salesPaise)], ['Delivery fees', '', '', '', rupees(data.deliveryFeesPaise)]];
        downloadText(`nearmart-commission-${range.from || 'start'}-to-${range.to || 'today'}.csv`, toCsv([header, ...rows, totalRow, ...extra]));
    };

    return (
        <div className="space-y-4">
            <div className="flex flex-wrap items-end gap-3">
                <div>
                    <label className="label" htmlFor="report-from">From</label>
                    <input id="report-from" className="input" type="date" value={range.from} max={range.to || undefined} onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))} />
                </div>
                <div>
                    <label className="label" htmlFor="report-to">To</label>
                    <input id="report-to" className="input" type="date" value={range.to} min={range.from || undefined} onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))} />
                </div>
                <button type="button" className="btn-ghost" onClick={() => setRange({ from: monthStart(), to: istDay() })}>This month</button>
                <button type="button" className="btn-ghost border border-slate-200 sm:ml-auto" disabled={!data || badRange} onClick={download}>Download CSV</button>
            </div>
            <p className="text-sm text-slate-500">Delivered orders in this range (India time), by delivery date. Rates are the ones fixed on each order.</p>
            <ErrorNote error={badRange ? 'The start date is after the end date.' : error} />
            {isLoading && <p className="text-sm text-slate-500">Loading…</p>}
            {data && (
                <div className={`space-y-4 ${isFetching ? 'opacity-60' : ''}`}>
                    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                        <SummaryCard label="Commission + fees earned" value={formatPaise(t.commissionPaise + t.feePaise)} hint={`${formatPaise(t.commissionPaise)} commission · ${formatPaise(t.feePaise)} fees`} />
                        <SummaryCard label="Seller sales" value={formatPaise(t.grossPaise)} hint={`${t.orders} orders · sellers earned ${formatPaise(t.netPaise)}`} />
                        <SummaryCard label="Nearmart's own sales" value={formatPaise(data.nearmart.salesPaise)} hint={`${data.nearmart.orders} orders`} />
                        <SummaryCard label="Delivery fees" value={formatPaise(data.deliveryFeesPaise)} hint="All delivered orders" />
                    </div>
                    <div className="card overflow-x-auto p-0">
                        <table className="w-full text-sm">
                            <thead className="bg-slate-50 text-left text-slate-500">
                                <tr>
                                    <th className="px-4 py-3 font-medium">Seller</th>
                                    <th className="px-4 py-3 text-right font-medium">Orders</th>
                                    <th className="px-4 py-3 text-right font-medium">Items sold</th>
                                    <th className="px-4 py-3 text-right font-medium">Commission</th>
                                    <th className="px-4 py-3 text-right font-medium">Fees</th>
                                    <th className="px-4 py-3 text-right font-medium">Seller coupons</th>
                                    <th className="px-4 py-3 text-right font-medium">Seller earned</th>
                                </tr>
                            </thead>
                            <tbody>
                                {!data.sellers.length && <tr><td colSpan={7} className="px-4 py-6 text-center text-slate-500">No delivered seller orders in this range.</td></tr>}
                                {data.sellers.map((r) => (
                                    <tr key={r.sellerId} className="border-t border-slate-100">
                                        <td className="px-4 py-3">
                                            {can('sellers') ? <Link to={`/sellers/${r.sellerId}`} className="font-medium text-brand-700 hover:underline">{r.name || 'Seller'}</Link> : <span className="font-medium">{r.name || 'Seller'}</span>}
                                            <span className="block text-xs text-slate-500">{Object.entries(r.byModule ?? {}).map(([m, n]) => `${MODULE_LABELS[m] ?? m} ${n}`).join(' · ')}</span>
                                        </td>
                                        <td className="px-4 py-3 text-right tabular-nums">{r.orders}</td>
                                        <td className="px-4 py-3 text-right tabular-nums">{formatPaise(r.grossPaise)}</td>
                                        <td className="px-4 py-3 text-right font-medium tabular-nums">{formatPaise(r.commissionPaise)}</td>
                                        <td className="px-4 py-3 text-right tabular-nums text-slate-600">{formatPaise(r.feePaise)}</td>
                                        <td className="px-4 py-3 text-right tabular-nums text-slate-600">{r.sellerDiscountPaise ? formatPaise(r.sellerDiscountPaise) : '—'}</td>
                                        <td className="px-4 py-3 text-right tabular-nums">{formatPaise(r.netPaise)}</td>
                                    </tr>
                                ))}
                            </tbody>
                            {data.sellers.length > 1 && (
                                <tfoot>
                                    <tr className="border-t border-slate-200 font-semibold">
                                        <td className="px-4 py-3">All sellers</td>
                                        <td className="px-4 py-3 text-right tabular-nums">{t.orders}</td>
                                        <td className="px-4 py-3 text-right tabular-nums">{formatPaise(t.grossPaise)}</td>
                                        <td className="px-4 py-3 text-right tabular-nums">{formatPaise(t.commissionPaise)}</td>
                                        <td className="px-4 py-3 text-right tabular-nums">{formatPaise(t.feePaise)}</td>
                                        <td className="px-4 py-3 text-right tabular-nums">{formatPaise(t.sellerDiscountPaise)}</td>
                                        <td className="px-4 py-3 text-right tabular-nums">{formatPaise(t.netPaise)}</td>
                                    </tr>
                                </tfoot>
                            )}
                        </table>
                    </div>
                </div>
            )}
        </div>
    );
}

export function Payouts() {
    const [searchParams, setSearchParams] = useSearchParams();
    const tab = TABS.some(([t]) => t === searchParams.get('tab')) ? searchParams.get('tab') : 'balances';

    return (
        <div className="space-y-6">
            <div>
                <h1 className="text-2xl font-semibold">Seller payouts</h1>
                <p className="text-sm text-slate-500">Money owed to marketplace sellers for delivered orders, and the payouts made to them.</p>
            </div>

            <div className="flex flex-wrap gap-1 rounded-lg bg-slate-100 p-1" role="tablist" aria-label="Seller payouts">
                {TABS.map(([value, label]) => (
                    <button
                        key={value}
                        type="button"
                        role="tab"
                        aria-selected={tab === value}
                        onClick={() => setSearchParams(value === 'balances' ? {} : { tab: value }, { replace: true })}
                        className={`rounded-md px-3 py-1.5 text-sm font-medium ${tab === value ? 'bg-white shadow-sm' : 'text-slate-600'}`}
                    >
                        {label}
                    </button>
                ))}
            </div>

            {tab === 'balances' && <BalancesTab />}
            {tab === 'payouts' && <PayoutsTab />}
            {tab === 'report' && <ReportTab />}
        </div>
    );
}

// ─── Detail ───

function Row({ label, value, strong = false }) {
    return (
        <div className={`flex justify-between py-1 ${strong ? 'border-t border-slate-200 pt-2 font-semibold' : 'text-slate-600'}`}>
            <span>{label}</span>
            <span className="tabular-nums">{value}</span>
        </div>
    );
}

function MarkPaidForm({ payout, onDone }) {
    const queryClient = useQueryClient();
    const bank = payout.bank ?? {};
    const [form, setForm] = useState({ mode: bank.accountNumber ? 'bank' : bank.upiId ? 'upi' : 'bank', reference: '', note: '' });
    const set = (patch) => setForm((f) => ({ ...f, ...patch }));
    const paid = useMutation({
        mutationFn: () =>
            api.post(`/admin/payouts/${payout._id}/paid`, {
                mode: form.mode,
                ...(form.reference.trim() ? { reference: form.reference.trim() } : {}),
                ...(form.note.trim() ? { note: form.note.trim() } : {})
            }),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['payout', payout._id] });
            queryClient.invalidateQueries({ queryKey: ['payouts'] });
            queryClient.invalidateQueries({ queryKey: ['payout-balances'] });
            onDone();
        }
    });

    return (
        <form
            className="space-y-4"
            onSubmit={(e) => {
                e.preventDefault();
                paid.mutate();
            }}
        >
            <ErrorNote error={paid.error} />
            <p className="text-sm text-slate-600">
                Record that {formatPaise(payout.netPaise)} has been sent to {payout.seller?.businessName}. The seller is notified.
            </p>
            <div className="grid gap-4 sm:grid-cols-2">
                <div>
                    <label className="label" htmlFor="paid-mode">Paid by</label>
                    <select id="paid-mode" className="input" value={form.mode} onChange={(e) => set({ mode: e.target.value })}>
                        {PAYOUT_MODES.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
                    </select>
                </div>
                <div>
                    <label className="label" htmlFor="paid-ref">Reference (UTR or transaction ID)</label>
                    <input id="paid-ref" className="input" value={form.reference} onChange={(e) => set({ reference: e.target.value })} maxLength={120} />
                </div>
            </div>
            <div>
                <label className="label" htmlFor="paid-note">Note (optional)</label>
                <input id="paid-note" className="input" value={form.note} onChange={(e) => set({ note: e.target.value })} maxLength={300} />
            </div>
            <div className="flex justify-end gap-2">
                <button type="button" className="btn-ghost" onClick={onDone}>Cancel</button>
                <button type="submit" className="btn-primary" disabled={paid.isPending}>{paid.isPending ? 'Saving…' : 'Mark paid'}</button>
            </div>
        </form>
    );
}

export function PayoutDetail() {
    const { id } = useParams();
    const { can } = useAuth();
    const queryClient = useQueryClient();
    const [paying, setPaying] = useState(false);
    const key = ['payout', id];

    const { data: payout, isLoading, error } = useQuery({
        queryKey: key,
        queryFn: () => api.get(`/admin/payouts/${id}`).then((r) => r.data.data)
    });
    const cancel = useMutation({
        mutationFn: () => api.post(`/admin/payouts/${id}/cancel`),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: key });
            queryClient.invalidateQueries({ queryKey: ['payouts'] });
            queryClient.invalidateQueries({ queryKey: ['payout-balances'] });
        }
    });

    if (isLoading) return <p className="text-sm text-slate-500">Loading…</p>;
    if (error) return <ErrorNote error={error} />;

    const canUpdate = can('payouts', 'update') && payout.status === 'pending';
    // The bank details copied onto the payout when it was made, not the seller's current ones.
    const bank = payout.bank ?? {};
    const hasBank = Boolean(bank.accountNumber || bank.upiId);
    const adjustments = payout.adjustments ?? [];
    const signed = (paise) => `${paise < 0 ? '−' : '+'}${formatPaise(Math.abs(paise))}`;

    return (
        <div className="space-y-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                    <Link to="/payouts?tab=payouts" className="text-sm text-slate-500 hover:underline">← Payouts</Link>
                    <h1 className="flex items-center gap-3 text-2xl font-semibold">
                        {payout.number}
                        <Badge tone={PAYOUT_STATUS_TONES[payout.status]}>{PAYOUT_STATUS_LABELS[payout.status] ?? payout.status}</Badge>
                    </h1>
                    <p className="text-sm text-slate-500">
                        {payout.seller && can('sellers') ? (
                            <Link to={`/sellers/${payout.seller._id}`} className="hover:underline">{payout.seller.businessName}</Link>
                        ) : (
                            payout.seller?.businessName
                        )}{' '}
                        · orders delivered up to {day(payout.periodTo)} · created {when(payout.createdAt)}
                    </p>
                </div>
                {canUpdate && (
                    <div className="flex flex-wrap gap-2">
                        <button
                            type="button"
                            className="btn-ghost text-red-600"
                            disabled={cancel.isPending}
                            onClick={() => window.confirm(`Cancel ${payout.number}? Its orders go back to payable and can be included in the next payout.`) && cancel.mutate()}
                        >
                            {cancel.isPending ? 'Cancelling…' : 'Cancel payout'}
                        </button>
                        <button type="button" className="btn-primary" onClick={() => setPaying(true)}>Mark paid</button>
                    </div>
                )}
            </div>

            <ErrorNote error={cancel.error} />

            <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
                <section className="card overflow-x-auto p-0">
                    <h2 className="px-4 pt-4 pb-2 font-semibold">Statement</h2>
                    <StatementTable orders={payout.orders} empty="No orders in this payout." />
                    <div className="space-y-0.5 border-t border-slate-100 px-4 py-3 text-sm">
                        <Row label={`Items sold (${payout.orderCount} orders)`} value={formatPaise(payout.grossPaise)} />
                        <Row label="Commission" value={`−${formatPaise(payout.commissionPaise)}`} />
                        {payout.feePaise > 0 && <Row label="Fixed fees" value={`−${formatPaise(payout.feePaise)}`} />}
                        {payout.sellerDiscountPaise > 0 && <Row label="Seller-funded coupons" value={`−${formatPaise(payout.sellerDiscountPaise)}`} />}
                        {(payout.adjustmentsPaise || adjustments.length > 0) && (
                            <Row label={`Adjustments (${adjustments.length})`} value={signed(payout.adjustmentsPaise ?? 0)} />
                        )}
                        <Row label="To pay the seller" value={formatPaise(payout.netPaise)} strong />
                    </div>
                    {adjustments.length > 0 && (
                        <div className="border-t border-slate-100">
                            <h3 className="px-4 pt-3 pb-1 text-sm font-semibold">Adjustments</h3>
                            <ul className="divide-y divide-slate-100 px-4 pb-3 text-sm">
                                {adjustments.map((a) => (
                                    <li key={a._id} className="flex justify-between gap-3 py-2">
                                        <span>
                                            {a.reason}
                                            <span className="block text-xs text-slate-500">
                                                {when(a.createdAt)}
                                                {a.order && (
                                                    <>
                                                        {' · '}
                                                        <Link to={`/orders/${a.order._id ?? a.order}`} className="hover:underline">{a.order.orderNumber ? `#${a.order.orderNumber}` : 'Order'}</Link>
                                                    </>
                                                )}
                                            </span>
                                        </span>
                                        <span className={`whitespace-nowrap font-medium tabular-nums ${a.amountPaise < 0 ? 'text-red-700' : 'text-brand-700'}`}>{signed(a.amountPaise)}</span>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}
                </section>

                <div className="space-y-6">
                    <section className="card space-y-1 text-sm">
                        <h2 className="font-semibold">Pay to (saved when this payout was made)</h2>
                        <p className="mb-2 text-xs text-slate-500">A later change to the seller's bank details doesn't affect this payout.</p>
                        {!hasBank && (
                            <p className="rounded bg-amber-50 p-2 text-amber-800">
                                No bank account or UPI ID was saved on this payout. Ask the seller to add one in their dashboard, then cancel this payout and create a new one.
                            </p>
                        )}
                        {bank.accountNumber && (
                            <>
                                <p><span className="text-slate-500">Account name: </span>{bank.accountName || '—'}</p>
                                <p><span className="text-slate-500">Account number: </span><span className="tabular-nums">{bank.accountNumber}</span></p>
                                <p><span className="text-slate-500">IFSC: </span>{bank.ifsc || '—'}</p>
                            </>
                        )}
                        {bank.upiId && <p><span className="text-slate-500">UPI: </span>{bank.upiId}</p>}
                    </section>

                    {payout.status === 'paid' && (
                        <section className="card space-y-1 text-sm">
                            <h2 className="mb-2 font-semibold">Payment</h2>
                            <p><span className="text-slate-500">Paid: </span>{when(payout.paidAt)}</p>
                            <p><span className="text-slate-500">By: </span>{PAYOUT_MODE_LABELS[payout.mode] ?? payout.mode}</p>
                            {payout.reference && <p><span className="text-slate-500">Reference: </span>{payout.reference}</p>}
                            {payout.note && <p className="text-slate-600">{payout.note}</p>}
                        </section>
                    )}
                    {payout.status === 'cancelled' && (
                        <p className="rounded-lg bg-slate-100 px-3 py-2 text-sm">Cancelled. Its orders went back to the seller's payable balance.</p>
                    )}
                </div>
            </div>

            <Modal open={paying} title={`Mark ${payout.number} paid`} onClose={() => setPaying(false)}>
                {paying && <MarkPaidForm payout={payout} onDone={() => setPaying(false)} />}
            </Modal>
        </div>
    );
}
