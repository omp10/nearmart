import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router';
import { useAuth } from '../auth/AuthProvider.jsx';
import { api } from '../lib/api.js';
import { useCurrentModule } from '../lib/moduleContext.jsx';
import { BOOKING_ACTIONS, BOOKING_CANCELLABLE, BOOKING_LABELS, BOOKING_TONES, RETURN_SLOT_EDITABLE, formatQty, nextBookingStatus } from '../lib/bookings.js';
import { formatPaise } from '../lib/money.js';
import { PAYMENT_LABELS } from '../lib/orders.js';
import { bookingTaskKind } from '../lib/riders.js';
import { Badge, ErrorNote, Modal } from '../components/ui.jsx';
import { DeliveryCard } from '../components/riders.jsx';

const when = (d) => new Date(d).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

function WeighForm({ booking, onDone }) {
    const [qtys, setQtys] = useState(Object.fromEntries(booking.items.map((l) => [l._id, String(l.estimatedQty)])));
    const [note, setNote] = useState('');
    const weigh = useMutation({
        mutationFn: () =>
            api.post(`/admin/laundry/bookings/${booking._id}/weigh`, {
                lines: booking.items.map((l) => ({ lineId: l._id, finalQty: Number(qtys[l._id]) })),
                note: note || undefined
            }),
        onSuccess: onDone
    });

    // Preview with the same rule as the API: never below the service minimum.
    const lineTotal = (l) => Math.round(Math.max(Number(qtys[l._id]) || 0, l.minQty) * l.ratePaise);
    const total = booking.items.reduce((s, l) => s + lineTotal(l), 0) + booking.pricing.deliveryFeePaise;
    const paid = booking.payment.paidPaise;

    return (
        <form
            className="space-y-4"
            onSubmit={(e) => {
                e.preventDefault();
                weigh.mutate();
            }}
        >
            <ErrorNote error={weigh.error} />
            {booking.items.map((l) => (
                <div key={l._id} className="grid grid-cols-[1fr_8rem_6rem] items-end gap-3">
                    <div>
                        <label className="label" htmlFor={`w-${l._id}`}>{l.name}</label>
                        <p className="text-xs text-slate-500">
                            Estimated {formatQty(l.estimatedQty, l.pricingUnit)} · {formatPaise(l.ratePaise)}/{l.pricingUnit} · min {l.minQty}
                        </p>
                    </div>
                    <input
                        id={`w-${l._id}`}
                        className="input"
                        type="number"
                        min="0"
                        step={l.pricingUnit === 'kg' ? '0.1' : '1'}
                        value={qtys[l._id]}
                        onChange={(e) => setQtys({ ...qtys, [l._id]: e.target.value })}
                        required
                    />
                    <span className="pb-2 text-right text-sm tabular-nums">{formatPaise(lineTotal(l))}</span>
                </div>
            ))}
            <div className="rounded-lg bg-slate-50 p-3 text-sm">
                <div className="flex justify-between"><span>Pickup & return</span><span>{formatPaise(booking.pricing.deliveryFeePaise)}</span></div>
                <div className="flex justify-between font-semibold"><span>Final amount</span><span>{formatPaise(total)}</span></div>
                <div className="flex justify-between text-slate-500"><span>Estimate was</span><span>{formatPaise(booking.pricing.estimatePaise + booking.pricing.deliveryFeePaise)}</span></div>
                {paid > 0 && total < paid && <p className="mt-1 text-amber-700">{formatPaise(paid - total)} will be refunded to the customer.</p>}
                {paid > 0 && total > paid && <p className="mt-1 text-amber-700">{formatPaise(total - paid)} to collect at return.</p>}
                {paid === 0 && <p className="mt-1 text-slate-600">Cash: {formatPaise(total)} to collect at return.</p>}
            </div>
            <div>
                <label className="label" htmlFor="w-note">Note (optional)</label>
                <input id="w-note" className="input" placeholder="e.g. 2 shirts with stains noted" value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} />
            </div>
            <div className="flex justify-end gap-2">
                <button type="button" className="btn-ghost" onClick={onDone}>Cancel</button>
                <button type="submit" className="btn-primary" disabled={weigh.isPending}>{weigh.isPending ? 'Saving…' : 'Confirm and notify customer'}</button>
            </div>
        </form>
    );
}

function ReturnSlotForm({ booking, onDone }) {
    const params = { module: 'laundry', kind: 'return', zone: booking.zone?._id ?? booking.zone, days: 7 };
    const { data: days = [], error } = useQuery({
        queryKey: ['slot-preview', params],
        queryFn: () => api.get('/admin/slots/preview', { params }).then((r) => r.data.data)
    });
    const save = useMutation({ mutationFn: (slotId) => api.post(`/admin/laundry/bookings/${booking._id}/return-slot`, { slotId }), onSuccess: onDone });
    const open = days.filter((d) => !d.closed && d.slots.some((s) => s.available));

    return (
        <div className="space-y-3">
            <ErrorNote error={error || save.error} />
            {open.length === 0 && <p className="text-sm text-slate-500">No return slots available in the next 7 days. Add return slot rules on the Slots page.</p>}
            {open.map((d) => (
                <div key={d.date}>
                    <p className="mb-1 text-sm font-medium">{new Date(`${d.date}T00:00:00`).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })}</p>
                    <div className="flex flex-wrap gap-2">
                        {d.slots.filter((s) => s.available).map((s) => (
                            <button
                                key={s.id}
                                type="button"
                                disabled={save.isPending}
                                onClick={() => save.mutate(s.id)}
                                className={`rounded-md border px-3 py-1.5 text-sm ${booking.returnSlot?.id === s.id ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-slate-300'}`}
                            >
                                {s.label} <span className="text-xs text-slate-500">{s.capacity - s.booked} left</span>
                            </button>
                        ))}
                    </div>
                </div>
            ))}
        </div>
    );
}

export default function BookingDetail() {
    const { id } = useParams();
    const { can } = useAuth();
    const queryClient = useQueryClient();
    const [dialog, setDialog] = useState(null); // 'weigh' | 'return' | 'cancel'
    const [reason, setReason] = useState('');
    const key = ['booking', id];

    const { data: b, isLoading, error } = useQuery({
        queryKey: key,
        queryFn: () => api.get(`/admin/laundry/bookings/${id}`).then((r) => r.data.data)
    });

    // Bookings are laundry's; the panel follows, e.g. when opened from a notification.
    const { setModule } = useCurrentModule();
    useEffect(() => setModule('laundry'), [setModule]);
    const refresh = () => {
        setDialog(null);
        queryClient.invalidateQueries({ queryKey: key });
        queryClient.invalidateQueries({ queryKey: ['bookings'] });
    };
    const advance = useMutation({ mutationFn: (status) => api.post(`/admin/laundry/bookings/${id}/status`, { status }), onSuccess: refresh });
    const cancel = useMutation({ mutationFn: () => api.post(`/admin/laundry/bookings/${id}/cancel`, { reason }), onSuccess: refresh });
    const retry = useMutation({ mutationFn: () => api.post(`/admin/laundry/bookings/${id}/retry-refund`), onSuccess: refresh });

    if (isLoading) return <p className="text-sm text-slate-500">Loading…</p>;
    if (error) return <ErrorNote error={error} />;

    const canUpdate = can('bookings', 'update');
    const next = nextBookingStatus(b.status);
    const weighed = b.pricing.finalPaise != null;

    return (
        <div className="space-y-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                    <Link to="/bookings" className="text-sm text-slate-500 hover:underline">← Laundry bookings</Link>
                    <h1 className="flex items-center gap-3 text-2xl font-semibold">
                        #{b.bookingNumber}
                        <Badge tone={BOOKING_TONES[b.status]}>{BOOKING_LABELS[b.status]}</Badge>
                    </h1>
                    <p className="text-sm text-slate-500">Booked {when(b.createdAt)}</p>
                </div>
                {canUpdate && (
                    <div className="flex flex-wrap gap-2">
                        {BOOKING_CANCELLABLE.includes(b.status) && (
                            <button type="button" className="btn-ghost text-red-600" onClick={() => setDialog('cancel')}>Cancel booking</button>
                        )}
                        {RETURN_SLOT_EDITABLE.includes(b.status) && (
                            <button type="button" className="btn-ghost" onClick={() => setDialog('return')}>{b.returnSlot?.id ? 'Change return slot' : 'Schedule return'}</button>
                        )}
                        {b.status === 'picked_up' && (
                            <button type="button" className="btn-primary" onClick={() => setDialog('weigh')}>Confirm weight</button>
                        )}
                        {next && b.status !== 'pending_payment' && (
                            <button type="button" className="btn-primary" onClick={() => advance.mutate(next)} disabled={advance.isPending}>
                                {advance.isPending ? 'Saving…' : BOOKING_ACTIONS[next]}
                            </button>
                        )}
                    </div>
                )}
            </div>

            <ErrorNote error={advance.error || retry.error} />

            <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
                <section className="card overflow-x-auto p-0">
                    <table className="w-full text-sm">
                        <thead className="bg-slate-50 text-left text-slate-500">
                            <tr>
                                <th className="px-4 py-3 font-medium">Service</th>
                                <th className="px-4 py-3 font-medium">Rate</th>
                                <th className="px-4 py-3 font-medium">Estimated</th>
                                <th className="px-4 py-3 font-medium">Weighed</th>
                                <th className="px-4 py-3 font-medium">Amount</th>
                            </tr>
                        </thead>
                        <tbody>
                            {b.items.map((l) => (
                                <tr key={l._id} className="border-t border-slate-100">
                                    <td className="px-4 py-3 font-medium">{l.name}</td>
                                    <td className="px-4 py-3 tabular-nums">{formatPaise(l.ratePaise)}/{l.pricingUnit}</td>
                                    <td className="px-4 py-3">{formatQty(l.estimatedQty, l.pricingUnit)}</td>
                                    <td className="px-4 py-3">{formatQty(l.finalQty, l.pricingUnit)}</td>
                                    <td className="px-4 py-3 tabular-nums">{formatPaise(l.finalPaise ?? l.estimatePaise)}{l.finalPaise == null && <span className="text-xs text-slate-500"> est.</span>}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                    <div className="space-y-1 border-t border-slate-100 px-4 py-3 text-sm">
                        <div className="flex justify-between text-slate-600"><span>Pickup & return</span><span>{b.pricing.deliveryFeePaise ? formatPaise(b.pricing.deliveryFeePaise) : 'Free'}</span></div>
                        <div className="flex justify-between border-t border-slate-200 pt-2 font-semibold">
                            <span>{weighed ? 'Final amount' : 'Estimate'}</span>
                            <span>{formatPaise(b.pricing.totalPaise)}</span>
                        </div>
                        {weighed && <p className="text-xs text-slate-500">Estimate was {formatPaise(b.pricing.estimatePaise + b.pricing.deliveryFeePaise)} · includes GST {formatPaise(b.pricing.taxPaise)}</p>}
                    </div>
                    {(b.instructions || b.pickupNotes) && (
                        <div className="space-y-1 border-t border-slate-100 px-4 py-3 text-sm">
                            {b.instructions && <p className="rounded bg-amber-50 p-2 text-amber-800">Care: {b.instructions}</p>}
                            {b.pickupNotes && <p className="text-slate-600">Pickup note: {b.pickupNotes}</p>}
                        </div>
                    )}
                </section>

                <div className="space-y-6">
                    <section className="card space-y-1 text-sm">
                        <h2 className="mb-2 font-semibold">Pickup & return</h2>
                        <p className="font-medium">{b.address.name || b.user?.name || 'Customer'} · {b.customerPhone}</p>
                        <p className="text-slate-600">
                            {b.address.line1}{b.address.line2 && `, ${b.address.line2}`}{b.address.landmark && ` (near ${b.address.landmark})`}
                            <br />
                            {b.address.city} {b.address.pincode}
                        </p>
                        <p className="pt-2"><span className="text-slate-500">Pickup: </span>{b.pickupSlot ? `${b.pickupSlot.date}, ${b.pickupSlot.label}` : '—'}</p>
                        <p><span className="text-slate-500">Return: </span>{b.returnSlot?.id ? `${b.returnSlot.date}, ${b.returnSlot.label}` : 'Not scheduled'}</p>
                        <p><span className="text-slate-500">Area: </span>{b.zone?.name}</p>
                    </section>

                    <DeliveryCard
                        refId={b._id}
                        module="laundry"
                        kind={bookingTaskKind(b.status)}
                        canAssign={canUpdate}
                        onChanged={() => {
                            queryClient.invalidateQueries({ queryKey: key });
                            queryClient.invalidateQueries({ queryKey: ['bookings'] });
                        }}
                    />

                    <section className="card space-y-1 text-sm">
                        <h2 className="mb-2 font-semibold">Payment</h2>
                        <p>{b.payment.method === 'cod' ? 'Cash at return' : 'Prepaid online'} · {PAYMENT_LABELS[b.payment.status]}</p>
                        {b.payment.paidPaise > 0 && <p>Paid online: {formatPaise(b.payment.paidPaise)}</p>}
                        {b.payment.balanceDuePaise > 0 && <p className="font-medium text-amber-700">To collect at return: {formatPaise(b.payment.balanceDuePaise)}</p>}
                        {b.payment.refundPendingPaise > 0 && <p className="text-amber-700">Refund in progress: {formatPaise(b.payment.refundPendingPaise)}</p>}
                        {b.payment.status === 'refund_pending' && canUpdate && (
                            <button type="button" className="btn-ghost mt-2 px-2 py-1" onClick={() => retry.mutate()} disabled={retry.isPending}>Retry refund</button>
                        )}
                    </section>

                    <section className="card text-sm">
                        <h2 className="mb-2 font-semibold">History</h2>
                        <ol className="space-y-2">
                            {b.statusHistory.map((h, i) => (
                                <li key={i} className="border-l-2 border-slate-200 pl-3">
                                    <span className="font-medium">{BOOKING_LABELS[h.status]}</span>
                                    <span className="block text-xs text-slate-500">{when(h.at)} · {h.by?.kind}</span>
                                    {h.note && <span className="block text-xs text-slate-600">{h.note}</span>}
                                </li>
                            ))}
                        </ol>
                        {b.cancelReason && <p className="mt-2 text-red-700">Cancelled: {b.cancelReason}</p>}
                    </section>
                </div>
            </div>

            <Modal open={dialog === 'weigh'} title="Confirm weight" onClose={() => setDialog(null)} wide>
                {dialog === 'weigh' && <WeighForm booking={b} onDone={refresh} />}
            </Modal>
            <Modal open={dialog === 'return'} title="Schedule return" onClose={() => setDialog(null)}>
                {dialog === 'return' && <ReturnSlotForm booking={b} onDone={refresh} />}
            </Modal>
            <Modal open={dialog === 'cancel'} title={`Cancel #${b.bookingNumber}`} onClose={() => setDialog(null)}>
                <form
                    className="space-y-4"
                    onSubmit={(e) => {
                        e.preventDefault();
                        cancel.mutate();
                    }}
                >
                    <ErrorNote error={cancel.error} />
                    <p className="text-sm text-slate-600">The pickup slot is released.{b.payment.paidPaise > 0 && ' The online payment is refunded in full.'}</p>
                    <div>
                        <label className="label" htmlFor="b-reason">Reason (shown to the customer)</label>
                        <input id="b-reason" className="input" value={reason} onChange={(e) => setReason(e.target.value)} required minLength={3} maxLength={300} />
                    </div>
                    <div className="flex justify-end gap-2">
                        <button type="button" className="btn-ghost" onClick={() => setDialog(null)}>Keep booking</button>
                        <button type="submit" className="btn bg-red-600 text-white hover:bg-red-700" disabled={cancel.isPending}>Cancel booking</button>
                    </div>
                </form>
            </Modal>
        </div>
    );
}
