import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router';
import { Bike, CheckCircle2, Clock, MapPin, PackageCheck, StickyNote } from 'lucide-react';
import { api } from '../lib/api.js';
import { formatDateTime } from '../lib/format.js';
import { formatPaise } from '../lib/money.js';
import { CANCELLABLE, ITEM_EDITABLE, NEXT_ACTION_LABELS, PAYMENT_LABELS, STATUS_LABELS, STATUS_TONES, nextStatus } from '../lib/orders.js';
import { shopLabel } from '../lib/shops.js';
import { Badge, ErrorNote, Loading, Modal, Notice } from '../components/ui.jsx';

const BY = { user: 'Customer', staff: 'Nearmart', rider: 'Delivery partner', seller: 'You', system: 'Automatic' };

/** What the seller should do next, in plain words. */
const GUIDANCE = {
    placed: 'Check you have every item, then accept the order.',
    accepted: 'Start packing when you begin picking the items.',
    packing: 'Mark it ready once the bag is packed and sealed.',
    ready: 'Packed and waiting. A delivery partner will collect it from your shop.',
    dispatched: 'On its way to the customer.',
    delivered: 'Delivered. It will show in your earnings.',
    cancelled: 'This order was cancelled.'
};

/** The seller's share: items supplied less commission and fee (mirrors settlementOf in payout.service.js). */
const settlement = (order) => {
    const gross = order.items.filter((l) => l.status === 'ok').reduce((s, l) => s + l.lineTotalPaise, 0);
    const commission = Math.round((gross * (order.seller?.commissionPercent ?? 0)) / 100);
    const fee = Math.min(order.seller?.fixedFeePaise ?? 0, gross - commission);
    return { gross, commission, fee, net: gross - commission - fee };
};

function Row({ label, value, strong = false }) {
    return (
        <div className={`flex justify-between gap-3 py-1 ${strong ? 'border-t border-slate-200 pt-2 font-semibold text-slate-900' : 'text-slate-600'}`}>
            <span>{label}</span>
            <span className="tabular-nums">{value}</span>
        </div>
    );
}

export default function OrderDetail() {
    const { id } = useParams();
    const queryClient = useQueryClient();
    const [cancelling, setCancelling] = useState(false);
    const [reason, setReason] = useState('');
    const [unavailableLine, setUnavailableLine] = useState(null);
    const [note, setNote] = useState('');
    const key = ['order', id];

    const { data: order, isLoading, error } = useQuery({
        queryKey: key,
        queryFn: () => api.get(`/seller/orders/${id}`).then((r) => r.data.data),
        refetchInterval: 30_000
    });

    // Every action returns the order as the seller sees it.
    const onDone = (res) => {
        queryClient.setQueryData(key, res.data.data);
        queryClient.invalidateQueries({ queryKey: ['orders'] });
        queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    };
    const advance = useMutation({ mutationFn: (status) => api.post(`/seller/orders/${id}/status`, { status }), onSuccess: onDone });
    const unavailable = useMutation({
        mutationFn: ({ lineId, note: n }) => api.post(`/seller/orders/${id}/items/${lineId}/unavailable`, n ? { note: n } : {}),
        onSuccess: (res) => {
            onDone(res);
            setUnavailableLine(null);
            setNote('');
        }
    });
    const cancel = useMutation({
        mutationFn: () => api.post(`/seller/orders/${id}/cancel`, { reason }),
        onSuccess: (res) => {
            onDone(res);
            setCancelling(false);
        }
    });

    if (isLoading) return <Loading />;
    if (error) {
        return (
            <div className="space-y-3">
                <Link to="/orders" className="text-sm text-slate-500 hover:underline">← Orders</Link>
                <ErrorNote error={error} />
            </div>
        );
    }

    const next = nextStatus(order.status);
    const editableItems = ITEM_EDITABLE.includes(order.status);
    const busy = advance.isPending || unavailable.isPending || cancel.isPending;
    const money = settlement(order);
    const okCount = order.items.filter((l) => l.status === 'ok').length;

    const actions = (
        <>
            {CANCELLABLE.includes(order.status) && (
                <button type="button" className="btn-ghost text-red-600" onClick={() => setCancelling(true)} disabled={busy}>Cancel order</button>
            )}
            {next && (
                <button type="button" className="btn-primary px-5" onClick={() => advance.mutate(next)} disabled={busy}>
                    <PackageCheck className="h-4 w-4" aria-hidden="true" />
                    {advance.isPending ? 'Saving…' : NEXT_ACTION_LABELS[next]}
                </button>
            )}
        </>
    );

    return (
        <div className="space-y-6 pb-20 md:pb-0">
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                    <Link to="/orders" className="text-sm text-slate-500 hover:underline">← Orders</Link>
                    <h1 className="flex flex-wrap items-center gap-3 text-2xl font-semibold">
                        #{order.orderNumber}
                        <Badge tone={STATUS_TONES[order.status]}>{STATUS_LABELS[order.status]}</Badge>
                    </h1>
                    <p className="text-sm text-slate-500">{shopLabel(order.module)} · placed {formatDateTime(order.createdAt)}</p>
                </div>
                <div className="hidden flex-wrap gap-2 md:flex">{actions}</div>
            </div>

            <Notice tone={order.status === 'placed' ? 'amber' : order.status === 'cancelled' ? 'slate' : 'green'} icon={order.status === 'ready' || order.status === 'dispatched' ? Bike : order.status === 'delivered' ? CheckCircle2 : Clock}>
                {GUIDANCE[order.status]}
                {order.status === 'cancelled' && order.cancelReason && <span className="block">Reason: {order.cancelReason}</span>}
            </Notice>

            <ErrorNote error={advance.error || unavailable.error} />

            <div className="grid gap-6 xl:grid-cols-[1fr_20rem]">
                <section className="card p-0">
                    <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
                        <h2 className="font-semibold">Items to pack</h2>
                        <span className="text-sm text-slate-500">{okCount} of {order.items.length}</span>
                    </div>
                    <ul className="divide-y divide-slate-100">
                        {order.items.map((l) => {
                            const gone = l.status === 'unavailable';
                            return (
                                <li key={l._id} className={`flex flex-wrap items-center gap-3 px-4 py-3 ${gone ? 'text-slate-400' : ''}`}>
                                    {l.image ? <img src={l.image} alt="" className="h-12 w-12 shrink-0 rounded-lg border border-slate-100 object-cover" /> : <div className="h-12 w-12 shrink-0 rounded-lg bg-slate-100" />}
                                    <div className="min-w-0 flex-1">
                                        <p className={gone ? 'line-through' : 'font-medium text-slate-900'}>{l.name}</p>
                                        <p className="text-xs">{l.variantLabel}{l.sku && ` · SKU ${l.sku}`}</p>
                                        <p className="text-xs text-slate-500">{formatPaise(l.unitPricePaise)} each</p>
                                        {gone && <Badge tone="red">Unavailable</Badge>}
                                    </div>
                                    <div className="text-right">
                                        <p className={`text-lg font-semibold tabular-nums ${gone ? '' : 'text-slate-900'}`}>× {l.qty}</p>
                                        <p className="text-xs tabular-nums">{formatPaise(l.lineTotalPaise)}</p>
                                    </div>
                                    {editableItems && !gone && (
                                        <button type="button" className="btn-ghost w-full justify-end px-2 py-1 text-xs text-amber-700 sm:w-auto" disabled={busy} onClick={() => setUnavailableLine(l)}>
                                            Out of stock?
                                        </button>
                                    )}
                                </li>
                            );
                        })}
                    </ul>
                    <div className="space-y-0.5 border-t border-slate-100 px-4 py-3 text-sm">
                        <Row label="Item value" value={formatPaise(money.gross)} />
                        <Row label={`Nearmart commission (${order.seller?.commissionPercent ?? 0}%)`} value={`−${formatPaise(money.commission)}`} />
                        {money.fee > 0 && <Row label="Fixed fee" value={`−${formatPaise(money.fee)}`} />}
                        <Row label="Your earning" value={formatPaise(money.net)} strong />
                        <p className="pt-1 text-xs text-slate-400">Paid to you after delivery. Delivery fee and coupons are handled by Nearmart.</p>
                    </div>
                </section>

                <div className="space-y-6">
                    <section className="card space-y-2 text-sm">
                        <h2 className="font-semibold">Delivery</h2>
                        <p className="flex items-start gap-2">
                            <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
                            <span>
                                <span className="font-medium">{order.address?.name || 'Customer'}</span>
                                <span className="block text-slate-600">{[order.address?.city, order.address?.pincode].filter(Boolean).join(' ')}</span>
                            </span>
                        </p>
                        <p className="flex items-start gap-2">
                            <Clock className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
                            <span>{order.slot?.date ? `${order.slot.date}, ${order.slot.label}` : 'As soon as possible'}</span>
                        </p>
                        {order.notes && (
                            <p className="flex items-start gap-2 rounded-lg bg-amber-50 p-2 text-amber-900">
                                <StickyNote className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                                <span>Customer note: {order.notes}</span>
                            </p>
                        )}
                        <p className="text-xs text-slate-500">A Nearmart delivery partner picks up from your shop and delivers to the customer.</p>
                    </section>

                    <section className="card space-y-1 text-sm">
                        <h2 className="mb-1 font-semibold">Payment</h2>
                        <p>{order.payment?.method === 'cod' ? 'Cash on delivery (collected by the delivery partner)' : 'Paid online'}</p>
                        <p className="text-slate-500">{PAYMENT_LABELS[order.payment?.status] ?? order.payment?.status}</p>
                    </section>

                    <section className="card text-sm">
                        <h2 className="mb-2 font-semibold">History</h2>
                        <ol className="space-y-2">
                            {order.statusHistory?.map((h, i) => (
                                <li key={i} className="border-l-2 border-slate-200 pl-3">
                                    <span className="font-medium">{STATUS_LABELS[h.status] ?? h.status}</span>
                                    <span className="block text-xs text-slate-500">{formatDateTime(h.at)}{h.by?.kind && ` · ${BY[h.by.kind] ?? h.by.kind}`}</span>
                                    {h.note && <span className="block text-xs text-slate-600">{h.note}</span>}
                                </li>
                            ))}
                        </ol>
                    </section>
                </div>
            </div>

            {/* Phones: the next step stays under the thumb. */}
            {(next || CANCELLABLE.includes(order.status)) && (
                <div className="fixed inset-x-0 bottom-0 z-10 flex justify-end gap-2 border-t border-slate-200 bg-white/95 p-3 backdrop-blur md:hidden">{actions}</div>
            )}

            <Modal open={Boolean(unavailableLine)} title="Item not available?" onClose={() => setUnavailableLine(null)}>
                {unavailableLine && (
                    <form
                        className="space-y-4"
                        onSubmit={(e) => {
                            e.preventDefault();
                            unavailable.mutate({ lineId: unavailableLine._id, note: note.trim() });
                        }}
                    >
                        <ErrorNote error={unavailable.error} />
                        <p className="text-sm text-slate-600">
                            <strong>{unavailableLine.name}</strong> ({unavailableLine.variantLabel}) × {unavailableLine.qty} will be removed from this order. The customer is told and pays less.
                            {okCount === 1 && ' This is the last item, so the whole order will be cancelled.'}
                        </p>
                        <div>
                            <label className="label" htmlFor="unavail-note">Note (optional)</label>
                            <input id="unavail-note" className="input" placeholder="e.g. Sold out today" value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} />
                        </div>
                        <div className="flex justify-end gap-2">
                            <button type="button" className="btn-ghost" onClick={() => setUnavailableLine(null)}>Keep item</button>
                            <button type="submit" className="btn bg-amber-600 text-white hover:bg-amber-700" disabled={unavailable.isPending}>{unavailable.isPending ? 'Saving…' : 'Mark unavailable'}</button>
                        </div>
                    </form>
                )}
            </Modal>

            <Modal open={cancelling} title={`Cancel #${order.orderNumber}?`} onClose={() => setCancelling(false)}>
                <form
                    className="space-y-4"
                    onSubmit={(e) => {
                        e.preventDefault();
                        cancel.mutate();
                    }}
                >
                    <ErrorNote error={cancel.error} />
                    <p className="text-sm text-slate-600">The customer is told and any online payment is refunded. Please cancel only if you really can't fulfil the order.</p>
                    <div>
                        <label className="label" htmlFor="cancel-reason">Reason (the customer sees this)</label>
                        <input id="cancel-reason" className="input" placeholder="e.g. Shop closed due to power cut" value={reason} onChange={(e) => setReason(e.target.value)} required minLength={3} maxLength={300} />
                    </div>
                    <div className="flex justify-end gap-2">
                        <button type="button" className="btn-ghost" onClick={() => setCancelling(false)}>Keep order</button>
                        <button type="submit" className="btn-danger" disabled={cancel.isPending}>{cancel.isPending ? 'Cancelling…' : 'Cancel order'}</button>
                    </div>
                </form>
            </Modal>
        </div>
    );
}
