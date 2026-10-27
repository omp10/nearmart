import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router';
import { useAuth } from '../auth/AuthProvider.jsx';
import { api } from '../lib/api.js';
import { useCurrentModule } from '../lib/moduleContext.jsx';
import { formatPaise } from '../lib/money.js';
import { CANCELLABLE, ITEM_EDITABLE, NEXT_ACTION_LABELS, PAYMENT_LABELS, STATUS_LABELS, STATUS_TONES, nextStatus } from '../lib/orders.js';
import { ORDER_ASSIGNABLE } from '../lib/riders.js';
import { Badge, ErrorNote, Modal } from '../components/ui.jsx';
import { DeliveryCard } from '../components/riders.jsx';

const when = (d) => new Date(d).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

function Row({ label, value, strong = false }) {
    return (
        <div className={`flex justify-between py-1 ${strong ? 'border-t border-slate-200 pt-2 font-semibold' : 'text-slate-600'}`}>
            <span>{label}</span>
            <span className="tabular-nums">{value}</span>
        </div>
    );
}

export default function OrderDetail() {
    const { id } = useParams();
    const { can } = useAuth();
    const queryClient = useQueryClient();
    const [cancelling, setCancelling] = useState(false);
    const [reason, setReason] = useState('');
    const key = ['order', id];

    const { data: order, isLoading, error } = useQuery({
        queryKey: key,
        queryFn: () => api.get(`/admin/orders/${id}`).then((r) => r.data.data)
    });

    // The panel follows the order's module, e.g. when opened from a notification.
    const { setModule } = useCurrentModule();
    useEffect(() => {
        if (order?.module) setModule(order.module);
    }, [order?.module, setModule]);

    // Action responses aren't populated (zone, customer), so refetch rather than merge them in.
    const onDone = () => {
        queryClient.invalidateQueries({ queryKey: key });
        queryClient.invalidateQueries({ queryKey: ['orders'] });
    };
    const advance = useMutation({ mutationFn: (status) => api.post(`/admin/orders/${id}/status`, { status }), onSuccess: onDone });
    const unavailable = useMutation({ mutationFn: (lineId) => api.post(`/admin/orders/${id}/items/${lineId}/unavailable`, {}), onSuccess: onDone });
    const retryRefund = useMutation({ mutationFn: () => api.post(`/admin/orders/${id}/retry-refund`), onSuccess: onDone });
    const cancel = useMutation({
        mutationFn: () => api.post(`/admin/orders/${id}/cancel`, { reason }),
        onSuccess: () => {
            setCancelling(false);
            onDone();
        }
    });

    if (isLoading) return <p className="text-sm text-slate-500">Loading…</p>;
    if (error) return <ErrorNote error={error} />;

    const canUpdate = can('orders', 'update');
    const next = nextStatus(order.status);
    const editableItems = canUpdate && ITEM_EDITABLE.includes(order.status);
    const busy = advance.isPending || unavailable.isPending || cancel.isPending;
    const pr = order.pricing;
    const refundOwed = order.payment.status === 'refund_pending';

    return (
        <div className="space-y-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                    <Link to="/orders" className="text-sm text-slate-500 hover:underline">← Orders</Link>
                    <h1 className="flex items-center gap-3 text-2xl font-semibold">
                        #{order.orderNumber}
                        <Badge tone={STATUS_TONES[order.status]}>{STATUS_LABELS[order.status]}</Badge>
                    </h1>
                    <p className="text-sm text-slate-500">{order.module} · placed {when(order.createdAt)}</p>
                </div>
                {canUpdate && (
                    <div className="flex flex-wrap gap-2">
                        {CANCELLABLE.includes(order.status) && (
                            <button type="button" className="btn-ghost text-red-600" onClick={() => setCancelling(true)} disabled={busy}>Cancel order</button>
                        )}
                        {next && order.status !== 'pending_payment' && (
                            <button type="button" className="btn-primary" onClick={() => advance.mutate(next)} disabled={busy}>
                                {advance.isPending ? 'Saving…' : NEXT_ACTION_LABELS[next]}
                            </button>
                        )}
                    </div>
                )}
            </div>

            <ErrorNote error={advance.error || unavailable.error || retryRefund.error} />
            {order.status === 'pending_payment' && (
                <p className="rounded-lg bg-slate-100 px-3 py-2 text-sm">Waiting for online payment. It is cancelled automatically if not paid by {when(order.paymentDueBy)}.</p>
            )}

            <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
                <section className="card overflow-x-auto p-0">
                    <table className="w-full text-sm">
                        <thead className="bg-slate-50 text-left text-slate-500">
                            <tr>
                                <th className="px-4 py-3 font-medium">Item</th>
                                <th className="px-4 py-3 font-medium">Qty</th>
                                <th className="px-4 py-3 font-medium">Price</th>
                                <th className="px-4 py-3 font-medium">Total</th>
                                {editableItems && <th className="px-4 py-3" />}
                            </tr>
                        </thead>
                        <tbody>
                            {order.items.map((l) => (
                                <tr key={l._id} className={`border-t border-slate-100 ${l.status === 'unavailable' ? 'text-slate-400' : ''}`}>
                                    <td className="px-4 py-3">
                                        <div className="flex items-center gap-3">
                                            {l.image ? <img src={l.image} alt="" className="h-10 w-10 rounded object-cover" /> : <div className="h-10 w-10 rounded bg-slate-100" />}
                                            <div>
                                                <span className={l.status === 'unavailable' ? 'line-through' : 'font-medium'}>{l.name}</span>
                                                <span className="block text-xs">{l.variantLabel}{l.sku && ` · ${l.sku}`}</span>
                                                {l.status === 'unavailable' && <Badge tone="red">Unavailable</Badge>}
                                            </div>
                                        </div>
                                    </td>
                                    <td className="px-4 py-3 tabular-nums">{l.qty}</td>
                                    <td className="px-4 py-3 tabular-nums">{formatPaise(l.unitPricePaise)}</td>
                                    <td className="px-4 py-3 tabular-nums">{formatPaise(l.lineTotalPaise)}</td>
                                    {editableItems && (
                                        <td className="px-4 py-3 text-right">
                                            {l.status === 'ok' && (
                                                <button
                                                    type="button"
                                                    className="btn-ghost px-2 py-1 text-amber-700"
                                                    disabled={busy}
                                                    onClick={() => window.confirm(`Mark ${l.name} (${l.variantLabel}) unavailable? The customer is told and the total is reduced.`) && unavailable.mutate(l._id)}
                                                >
                                                    Unavailable
                                                </button>
                                            )}
                                        </td>
                                    )}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                    <div className="space-y-0.5 border-t border-slate-100 px-4 py-3 text-sm">
                        <Row label="Subtotal" value={formatPaise(pr.subtotalPaise)} />
                        {pr.discountPaise > 0 && <Row label={`Coupon ${order.coupon?.code ?? ''}`} value={`−${formatPaise(pr.discountPaise)}`} />}
                        <Row label="Delivery" value={pr.deliveryFeePaise ? formatPaise(pr.deliveryFeePaise) : 'Free'} />
                        <Row label="Total" value={formatPaise(pr.totalPaise)} strong />
                        <p className="text-xs text-slate-400">Includes GST {formatPaise(pr.taxPaise)}</p>
                        {order.originalTotalPaise !== pr.totalPaise && (
                            <p className="text-xs text-amber-700">Was {formatPaise(order.originalTotalPaise)} at checkout</p>
                        )}
                    </div>
                </section>

                <div className="space-y-6">
                    <section className="card space-y-1 text-sm">
                        <h2 className="mb-2 font-semibold">Delivery</h2>
                        <p className="font-medium">{order.address.name || order.user?.name || 'Customer'}</p>
                        <p>{order.customerPhone}</p>
                        <p className="text-slate-600">
                            {order.address.line1}
                            {order.address.line2 && `, ${order.address.line2}`}
                            {order.address.landmark && ` (near ${order.address.landmark})`}
                            <br />
                            {order.address.city}, {order.address.state} {order.address.pincode}
                        </p>
                        <p className="pt-2">
                            <span className="text-slate-500">Slot: </span>
                            {order.slot?.date ? `${order.slot.date}, ${order.slot.label}` : 'As soon as possible'}
                        </p>
                        <p><span className="text-slate-500">Area: </span>{order.zone?.name}</p>
                        {order.notes && <p className="rounded bg-amber-50 p-2 text-amber-800">Note: {order.notes}</p>}
                    </section>

                    <DeliveryCard
                        refId={order._id}
                        module={order.module}
                        kind={ORDER_ASSIGNABLE.includes(order.status) ? 'order_delivery' : null}
                        canAssign={canUpdate}
                        onChanged={onDone}
                    />

                    <section className="card space-y-1 text-sm">
                        <h2 className="mb-2 font-semibold">Payment</h2>
                        <p>{order.payment.method === 'cod' ? 'Cash on delivery' : 'Online (Razorpay)'} · {PAYMENT_LABELS[order.payment.status]}</p>
                        {order.paymentRecord?.gatewayPaymentId && <p className="text-xs text-slate-500">{order.paymentRecord.gatewayPaymentId}</p>}
                        {order.payment.refundPendingPaise > 0 && <p className="text-amber-700">Refund in progress: {formatPaise(order.payment.refundPendingPaise)}</p>}
                        {order.paymentRecord?.refundedPaise > 0 && <p>Refunded: {formatPaise(order.paymentRecord.refundedPaise)}</p>}
                        {refundOwed && canUpdate && (
                            <button type="button" className="btn-ghost mt-2 px-2 py-1" onClick={() => retryRefund.mutate()} disabled={retryRefund.isPending}>
                                Retry refund
                            </button>
                        )}
                    </section>

                    <section className="card text-sm">
                        <h2 className="mb-2 font-semibold">History</h2>
                        <ol className="space-y-2">
                            {order.statusHistory.map((h, i) => (
                                <li key={i} className="border-l-2 border-slate-200 pl-3">
                                    <span className="font-medium">{STATUS_LABELS[h.status]}</span>
                                    <span className="block text-xs text-slate-500">{when(h.at)} · {h.by?.kind}</span>
                                    {h.note && <span className="block text-xs text-slate-600">{h.note}</span>}
                                </li>
                            ))}
                        </ol>
                        {order.cancelReason && <p className="mt-2 text-red-700">Cancelled: {order.cancelReason}</p>}
                    </section>
                </div>
            </div>

            <Modal open={cancelling} title={`Cancel #${order.orderNumber}`} onClose={() => setCancelling(false)}>
                <form
                    className="space-y-4"
                    onSubmit={(e) => {
                        e.preventDefault();
                        cancel.mutate();
                    }}
                >
                    <ErrorNote error={cancel.error} />
                    <p className="text-sm text-slate-600">
                        Stock and the delivery slot are released.
                        {order.payment.method === 'online' && order.payment.status === 'paid' && ' The online payment is refunded in full.'}
                    </p>
                    <div>
                        <label className="label" htmlFor="cancel-reason">Reason (shown to the customer)</label>
                        <input id="cancel-reason" className="input" value={reason} onChange={(e) => setReason(e.target.value)} required minLength={3} maxLength={300} />
                    </div>
                    <div className="flex justify-end gap-2">
                        <button type="button" className="btn-ghost" onClick={() => setCancelling(false)}>Keep order</button>
                        <button type="submit" className="btn bg-red-600 text-white hover:bg-red-700" disabled={cancel.isPending}>{cancel.isPending ? 'Cancelling…' : 'Cancel order'}</button>
                    </div>
                </form>
            </Modal>
        </div>
    );
}
