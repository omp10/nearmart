import { useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { useAuth } from '../auth/AuthProvider.jsx';
import { api } from '../lib/api.js';
import { formatPaise, paiseToRupees, rupeesToPaise } from '../lib/money.js';
import {
    DEPOSIT_LABELS, DEPOSIT_MODES, DEPOSIT_TONES, TASK_KIND_LABELS, VEHICLES, VEHICLE_LABELS, age, ago, mapsUrl
} from '../lib/riders.js';
import { BUSINESS_MODULES } from '../nav.js';
import { Badge, ErrorNote, Modal, Pager, useDebounced } from '../components/ui.jsx';
import { CancelTaskModal, OnlineDot, TaskRefLink, TaskStatusBadge, taskNote } from '../components/riders.jsx';

const when = (d) => new Date(d).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const MODULE_LABELS = Object.fromEntries(BUSINESS_MODULES.map((m) => [m.id, m.label]));
const shopsLabel = (modules) => (modules?.length ? modules.map((m) => MODULE_LABELS[m] ?? m).join(', ') : 'All shops');

const TABS = [
    ['riders', 'Riders'],
    ['tasks', 'Live tasks'],
    ['deposits', 'Cash deposits']
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

function LastSeen({ rider }) {
    return (
        <span className="flex items-center gap-2">
            <OnlineDot online={rider.isOnline} />
            <span className={rider.isOnline ? 'text-brand-700' : 'text-slate-500'}>
                {rider.isOnline ? 'Online' : rider.lastSeenAt ? `Last seen ${ago(rider.lastSeenAt)}` : 'Never signed in'}
            </span>
        </span>
    );
}

/** Create (no `rider`) or edit a delivery partner. */
function RiderForm({ rider, onDone }) {
    const queryClient = useQueryClient();
    const isEdit = Boolean(rider);
    const [form, setForm] = useState({
        name: rider?.name ?? '',
        phone: rider?.phone ?? '',
        vehicle: rider?.vehicle ?? 'bike',
        modules: rider?.modules ?? [],
        payout: paiseToRupees(rider?.payoutPerTaskPaise),
        isActive: rider?.isActive ?? true
    });
    const set = (patch) => setForm((f) => ({ ...f, ...patch }));
    const toggleModule = (id) => set({ modules: form.modules.includes(id) ? form.modules.filter((m) => m !== id) : [...form.modules, id] });

    const save = useMutation({
        mutationFn: (body) => (isEdit ? api.patch(`/admin/riders/${rider._id}`, body) : api.post('/admin/riders', body)),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['riders'] });
            queryClient.invalidateQueries({ queryKey: ['rider'] });
            onDone();
        }
    });

    const payoutPaise = rupeesToPaise(form.payout);
    const submit = (e) => {
        e.preventDefault();
        save.mutate({
            name: form.name.trim(),
            phone: form.phone,
            vehicle: form.vehicle,
            modules: form.modules,
            payoutPerTaskPaise: payoutPaise ?? 0,
            isActive: form.isActive
        });
    };

    return (
        <form onSubmit={submit} className="space-y-4">
            <ErrorNote error={save.error} />
            <div className="grid gap-4 sm:grid-cols-2">
                <div>
                    <label className="label" htmlFor="r-name">Name</label>
                    <input id="r-name" className="input" value={form.name} onChange={(e) => set({ name: e.target.value })} required maxLength={80} />
                </div>
                <div>
                    <label className="label" htmlFor="r-phone">Mobile number</label>
                    <input
                        id="r-phone"
                        className="input"
                        inputMode="numeric"
                        pattern="[0-9]{10}"
                        title="10-digit mobile number"
                        placeholder="10 digits"
                        value={form.phone}
                        onChange={(e) => set({ phone: e.target.value.replace(/\D/g, '').slice(0, 10) })}
                        required
                    />
                    <p className="mt-1 text-xs text-slate-500">They sign in to the delivery app with this number.</p>
                </div>
                <div>
                    <label className="label" htmlFor="r-vehicle">Vehicle</label>
                    <select id="r-vehicle" className="input" value={form.vehicle} onChange={(e) => set({ vehicle: e.target.value })}>
                        {VEHICLES.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
                    </select>
                </div>
                <div>
                    <label className="label" htmlFor="r-payout">Payout per delivery (₹)</label>
                    <input
                        id="r-payout"
                        className="input"
                        type="number"
                        min="0"
                        step="0.01"
                        value={form.payout}
                        onChange={(e) => set({ payout: e.target.value })}
                        required
                    />
                </div>
            </div>

            <fieldset>
                <legend className="label">Shops they deliver for</legend>
                <div className="flex flex-wrap gap-4">
                    {BUSINESS_MODULES.map((m) => (
                        <label key={m.id} className="flex items-center gap-2 text-sm">
                            <input type="checkbox" checked={form.modules.includes(m.id)} onChange={() => toggleModule(m.id)} />
                            {m.label}
                        </label>
                    ))}
                </div>
                <p className="mt-1 text-xs text-slate-500">{form.modules.length ? shopsLabel(form.modules) : 'None ticked: all shops.'}</p>
            </fieldset>

            <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={form.isActive} onChange={(e) => set({ isActive: e.target.checked })} />
                Active (can sign in and be assigned work)
            </label>

            <div className="flex justify-end gap-2">
                <button type="button" className="btn-ghost" onClick={onDone}>Cancel</button>
                <button type="submit" className="btn-primary" disabled={save.isPending || Number.isNaN(payoutPaise)}>
                    {save.isPending ? 'Saving…' : isEdit ? 'Save changes' : 'Add delivery partner'}
                </button>
            </div>
        </form>
    );
}

function RidersTab() {
    const { can } = useAuth();
    const navigate = useNavigate();
    const [q, setQ] = useState('');
    const [status, setStatus] = useState('');
    const [page, setPage] = useState(1);
    const [adding, setAdding] = useState(false);
    const search = useDebounced(q);

    const params = { page, limit: 25, ...(status ? { status } : {}), ...(search ? { q: search } : {}) };
    const { data, isLoading, error } = useQuery({
        queryKey: ['riders', params],
        queryFn: () => api.get('/admin/riders', { params }).then((r) => r.data.data),
        placeholderData: keepPreviousData,
        refetchInterval: 60_000
    });

    return (
        <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <Pills
                    label="Partner status"
                    value={status}
                    onChange={(v) => {
                        setStatus(v);
                        setPage(1);
                    }}
                    options={[['', 'All'], ['online', 'Online'], ['active', 'Active'], ['inactive', 'Inactive']]}
                />
                {can('riders', 'create') && <button type="button" className="btn-primary" onClick={() => setAdding(true)}>Add delivery partner</button>}
            </div>
            <input
                className="input"
                placeholder="Name or phone"
                aria-label="Search delivery partners"
                value={q}
                onChange={(e) => {
                    setQ(e.target.value);
                    setPage(1);
                }}
            />

            <ErrorNote error={error} />

            <div className="card overflow-x-auto p-0">
                <table className="w-full text-sm">
                    <thead className="bg-slate-50 text-left text-slate-500">
                        <tr>
                            <th className="px-4 py-3 font-medium">Name</th>
                            <th className="px-4 py-3 font-medium">Vehicle</th>
                            <th className="px-4 py-3 font-medium">Shops</th>
                            <th className="px-4 py-3 font-medium">Seen</th>
                            <th className="px-4 py-3 font-medium">Active tasks</th>
                            <th className="px-4 py-3 font-medium">Cash in hand</th>
                            <th className="px-4 py-3 font-medium">Status</th>
                        </tr>
                    </thead>
                    <tbody>
                        {isLoading && <tr><td colSpan={7} className="px-4 py-6 text-center text-slate-500">Loading…</td></tr>}
                        {data?.items.length === 0 && <tr><td colSpan={7} className="px-4 py-6 text-center text-slate-500">No delivery partners here.</td></tr>}
                        {data?.items.map((r) => (
                            <tr
                                key={r._id}
                                className="cursor-pointer border-t border-slate-100 hover:bg-slate-50"
                                onClick={() => navigate(`/riders/${r._id}`)}
                            >
                                <td className="px-4 py-3">
                                    <Link to={`/riders/${r._id}`} className="font-medium text-brand-700 hover:underline" onClick={(e) => e.stopPropagation()}>{r.name}</Link>
                                    <span className="block text-xs text-slate-500">{r.phone}</span>
                                </td>
                                <td className="px-4 py-3 text-slate-600">{VEHICLE_LABELS[r.vehicle] ?? r.vehicle}</td>
                                <td className="px-4 py-3 text-slate-600">{shopsLabel(r.modules)}</td>
                                <td className="whitespace-nowrap px-4 py-3"><LastSeen rider={r} /></td>
                                <td className="px-4 py-3 tabular-nums">{r.activeTasks || '—'}</td>
                                <td className={`px-4 py-3 tabular-nums ${r.cashInHandPaise > 0 ? 'font-medium text-amber-700' : ''}`}>{formatPaise(r.cashInHandPaise)}</td>
                                <td className="px-4 py-3">{r.isActive ? <Badge tone="green">Active</Badge> : <Badge>Inactive</Badge>}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
            <Pager page={page} pages={data?.pages} onChange={setPage} />

            <Modal open={adding} title="New delivery partner" onClose={() => setAdding(false)} wide>
                {adding && <RiderForm onDone={() => setAdding(false)} />}
            </Modal>
        </div>
    );
}

function TasksTab() {
    const { can } = useAuth();
    const queryClient = useQueryClient();
    const [page, setPage] = useState(1);
    const [cancelling, setCancelling] = useState(null);

    const params = { status: 'active', page, limit: 50 };
    const { data, isLoading, error } = useQuery({
        queryKey: ['rider-tasks', params],
        queryFn: () => api.get('/admin/riders/tasks', { params }).then((r) => r.data.data),
        placeholderData: keepPreviousData,
        refetchInterval: 15_000
    });

    return (
        <div className="space-y-4">
            <p className="text-sm text-slate-500">Deliveries, pickups and returns in progress. Refreshes every 15 seconds.</p>
            <ErrorNote error={error} />
            <div className="card overflow-x-auto p-0">
                <table className="w-full text-sm">
                    <thead className="bg-slate-50 text-left text-slate-500">
                        <tr>
                            <th className="px-4 py-3 font-medium">Task</th>
                            <th className="px-4 py-3 font-medium">For</th>
                            <th className="px-4 py-3 font-medium">Partner</th>
                            <th className="px-4 py-3 font-medium">Status</th>
                            <th className="px-4 py-3 font-medium">To collect</th>
                            <th className="px-4 py-3 font-medium">Age</th>
                            <th className="px-4 py-3" />
                        </tr>
                    </thead>
                    <tbody>
                        {isLoading && <tr><td colSpan={7} className="px-4 py-6 text-center text-slate-500">Loading…</td></tr>}
                        {data?.items.length === 0 && <tr><td colSpan={7} className="px-4 py-6 text-center text-slate-500">Nothing on the road right now.</td></tr>}
                        {data?.items.map((t) => (
                            <tr key={t._id} className="border-t border-slate-100 hover:bg-slate-50">
                                <td className="px-4 py-3">
                                    <Badge tone={t.kind === 'order_delivery' ? 'green' : 'slate'}>{TASK_KIND_LABELS[t.kind] ?? t.kind}</Badge>
                                    <span className="block text-xs text-slate-500">{MODULE_LABELS[t.module] ?? t.module}</span>
                                </td>
                                <td className="px-4 py-3">
                                    <TaskRefLink task={t} />
                                    <span className="block text-xs text-slate-500">{t.drop?.name}</span>
                                </td>
                                <td className="px-4 py-3">
                                    {t.rider ? <Link to={`/riders/${t.rider._id}`} className="hover:underline">{t.rider.name}</Link> : '—'}
                                    <span className="block text-xs text-slate-500">{t.rider?.phone}</span>
                                </td>
                                <td className="px-4 py-3"><TaskStatusBadge status={t.status} /></td>
                                <td className="px-4 py-3 tabular-nums">{t.payment?.collectPaise ? formatPaise(t.payment.collectPaise) : '—'}</td>
                                <td className="whitespace-nowrap px-4 py-3 text-slate-600" title={when(t.createdAt)}>{age(t.createdAt)}</td>
                                <td className="px-4 py-3 text-right">
                                    {can('riders', 'update') && (
                                        <button type="button" className="btn-ghost px-2 py-1 text-red-600" onClick={() => setCancelling(t)}>Cancel</button>
                                    )}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
            <Pager page={page} pages={data?.pages} onChange={setPage} />
            <CancelTaskModal
                task={cancelling}
                onClose={() => setCancelling(null)}
                onDone={() => {
                    queryClient.invalidateQueries({ queryKey: ['rider-tasks'] });
                    queryClient.invalidateQueries({ queryKey: ['riders'] });
                }}
            />
        </div>
    );
}

function DepositsTab() {
    const { can } = useAuth();
    const queryClient = useQueryClient();
    const [status, setStatus] = useState('pending');
    const [page, setPage] = useState(1);

    const params = { page, limit: 25, ...(status ? { status } : {}) };
    const { data, isLoading, error } = useQuery({
        queryKey: ['rider-deposits', params],
        queryFn: () => api.get('/admin/riders/deposits', { params }).then((r) => r.data.data),
        placeholderData: keepPreviousData,
        refetchInterval: 60_000
    });
    const decide = useMutation({
        mutationFn: ({ id, action }) => api.post(`/admin/riders/deposits/${id}/${action}`),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['rider-deposits'] });
            queryClient.invalidateQueries({ queryKey: ['riders'] });
            queryClient.invalidateQueries({ queryKey: ['rider'] });
        }
    });
    const canDecide = can('riders', 'update');

    return (
        <div className="space-y-4">
            <Pills
                label="Deposit status"
                value={status}
                onChange={(v) => {
                    setStatus(v);
                    setPage(1);
                }}
                options={[['pending', 'Pending'], ['confirmed', 'Confirmed'], ['rejected', 'Rejected'], ['', 'All']]}
            />
            <p className="text-sm text-slate-500">Cash collected on delivery that partners say they have paid in. Confirm once it reaches the account or the till.</p>
            <ErrorNote error={error || decide.error} />
            <div className="card overflow-x-auto p-0">
                <table className="w-full text-sm">
                    <thead className="bg-slate-50 text-left text-slate-500">
                        <tr>
                            <th className="px-4 py-3 font-medium">Partner</th>
                            <th className="px-4 py-3 font-medium">Amount</th>
                            <th className="px-4 py-3 font-medium">Paid by</th>
                            <th className="px-4 py-3 font-medium">Submitted</th>
                            <th className="px-4 py-3 font-medium">Status</th>
                            <th className="px-4 py-3" />
                        </tr>
                    </thead>
                    <tbody>
                        {isLoading && <tr><td colSpan={6} className="px-4 py-6 text-center text-slate-500">Loading…</td></tr>}
                        {data?.items.length === 0 && <tr><td colSpan={6} className="px-4 py-6 text-center text-slate-500">No deposits here.</td></tr>}
                        {data?.items.map((d) => (
                            <tr key={d._id} className="border-t border-slate-100 hover:bg-slate-50">
                                <td className="px-4 py-3">
                                    {d.rider ? <Link to={`/riders/${d.rider._id}`} className="font-medium hover:underline">{d.rider.name}</Link> : '—'}
                                    <span className="block text-xs text-slate-500">{d.rider?.phone}</span>
                                </td>
                                <td className="px-4 py-3 font-medium tabular-nums">{formatPaise(d.amountPaise)}</td>
                                <td className="px-4 py-3 text-slate-600">
                                    {DEPOSIT_MODES[d.mode] ?? d.mode}
                                    {d.reference && <span className="block text-xs text-slate-500">Ref {d.reference}</span>}
                                </td>
                                <td className="px-4 py-3 text-slate-600">{when(d.createdAt)}</td>
                                <td className="px-4 py-3">
                                    <Badge tone={DEPOSIT_TONES[d.status]}>{DEPOSIT_LABELS[d.status] ?? d.status}</Badge>
                                    {d.decidedAt && <span className="block text-xs text-slate-500">{when(d.decidedAt)}</span>}
                                </td>
                                <td className="whitespace-nowrap px-4 py-3 text-right">
                                    {canDecide && d.status === 'pending' && (
                                        <>
                                            <button
                                                type="button"
                                                className="btn-ghost px-2 py-1 text-red-600"
                                                disabled={decide.isPending}
                                                onClick={() =>
                                                    window.confirm(`Reject ${formatPaise(d.amountPaise)} from ${d.rider?.name}? It stays in their cash in hand.`) &&
                                                    decide.mutate({ id: d._id, action: 'reject' })
                                                }
                                            >
                                                Reject
                                            </button>
                                            <button
                                                type="button"
                                                className="btn-primary px-3 py-1"
                                                disabled={decide.isPending}
                                                onClick={() => decide.mutate({ id: d._id, action: 'confirm' })}
                                            >
                                                Confirm
                                            </button>
                                        </>
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

export function Riders() {
    const [searchParams, setSearchParams] = useSearchParams();
    const tab = TABS.some(([t]) => t === searchParams.get('tab')) ? searchParams.get('tab') : 'riders';

    return (
        <div className="space-y-6">
            <div>
                <h1 className="text-2xl font-semibold">Delivery partners</h1>
                <p className="text-sm text-slate-500">Riders who deliver orders and pick up and return laundry, what they are doing now, and the cash they hold.</p>
            </div>

            <div className="flex flex-wrap gap-1 rounded-lg bg-slate-100 p-1" role="tablist" aria-label="Delivery partners">
                {TABS.map(([value, label]) => (
                    <button
                        key={value}
                        type="button"
                        role="tab"
                        aria-selected={tab === value}
                        onClick={() => setSearchParams(value === 'riders' ? {} : { tab: value }, { replace: true })}
                        className={`rounded-md px-3 py-1.5 text-sm font-medium ${tab === value ? 'bg-white shadow-sm' : 'text-slate-600'}`}
                    >
                        {label}
                    </button>
                ))}
            </div>

            {tab === 'riders' && <RidersTab />}
            {tab === 'tasks' && <TasksTab />}
            {tab === 'deposits' && <DepositsTab />}
        </div>
    );
}

function Stat({ label, value }) {
    return (
        <div className="card">
            <p className="text-xs text-slate-500">{label}</p>
            <p className="mt-1 text-xl font-semibold tabular-nums">{value}</p>
        </div>
    );
}

export function RiderDetail() {
    const { id } = useParams();
    const { can } = useAuth();
    const queryClient = useQueryClient();
    const [editing, setEditing] = useState(false);
    const key = ['rider', id];

    const { data: rider, isLoading, error } = useQuery({
        queryKey: key,
        queryFn: () => api.get(`/admin/riders/${id}`).then((r) => r.data.data),
        refetchInterval: 30_000
    });
    const toggleActive = useMutation({
        mutationFn: (isActive) => api.patch(`/admin/riders/${id}`, { isActive }),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: key });
            queryClient.invalidateQueries({ queryKey: ['riders'] });
        }
    });

    if (isLoading) return <p className="text-sm text-slate-500">Loading…</p>;
    if (error) return <ErrorNote error={error} />;

    const canUpdate = can('riders', 'update');
    const loc = rider.lastLocation;

    return (
        <div className="space-y-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                    <Link to="/riders" className="text-sm text-slate-500 hover:underline">← Delivery partners</Link>
                    <h1 className="flex items-center gap-3 text-2xl font-semibold">
                        {rider.name}
                        {rider.isActive ? <Badge tone="green">Active</Badge> : <Badge>Inactive</Badge>}
                    </h1>
                    <p className="text-sm text-slate-500">
                        <a href={`tel:${rider.phone}`} className="hover:underline">{rider.phone}</a> · {VEHICLE_LABELS[rider.vehicle] ?? rider.vehicle} · joined {when(rider.createdAt)}
                    </p>
                </div>
                {canUpdate && (
                    <div className="flex flex-wrap gap-2">
                        <button
                            type="button"
                            className={`btn-ghost ${rider.isActive ? 'text-red-600' : ''}`}
                            disabled={toggleActive.isPending}
                            onClick={() =>
                                (!rider.isActive || window.confirm(`Deactivate ${rider.name}? They are signed out of the delivery app and can't be assigned work.`)) &&
                                toggleActive.mutate(!rider.isActive)
                            }
                        >
                            {rider.isActive ? 'Deactivate' : 'Reactivate'}
                        </button>
                        <button type="button" className="btn-primary" onClick={() => setEditing(true)}>Edit</button>
                    </div>
                )}
            </div>

            <ErrorNote error={toggleActive.error} />

            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <Stat label="Completed today" value={rider.today?.completed ?? 0} />
                <Stat label="Earned today" value={formatPaise(rider.today?.earningsPaise ?? 0)} />
                <Stat label="Active tasks" value={rider.activeTasks ?? 0} />
                <Stat label="Cash in hand" value={formatPaise(rider.cashInHandPaise)} />
            </div>

            <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
                <section className="card overflow-x-auto p-0">
                    <h2 className="px-4 pt-4 pb-2 font-semibold">Recent tasks</h2>
                    <table className="w-full text-sm">
                        <thead className="bg-slate-50 text-left text-slate-500">
                            <tr>
                                <th className="px-4 py-3 font-medium">Task</th>
                                <th className="px-4 py-3 font-medium">For</th>
                                <th className="px-4 py-3 font-medium">Status</th>
                                <th className="px-4 py-3 font-medium">Collected</th>
                                <th className="px-4 py-3 font-medium">Payout</th>
                                <th className="px-4 py-3 font-medium">When</th>
                            </tr>
                        </thead>
                        <tbody>
                            {!rider.recentTasks?.length && <tr><td colSpan={6} className="px-4 py-6 text-center text-slate-500">No tasks yet.</td></tr>}
                            {rider.recentTasks?.map((t) => (
                                <tr key={t._id} className="border-t border-slate-100">
                                    <td className="px-4 py-3">{TASK_KIND_LABELS[t.kind] ?? t.kind}</td>
                                    <td className="px-4 py-3">
                                        <TaskRefLink task={t} />
                                        <span className="block text-xs text-slate-500">{t.drop?.name}</span>
                                    </td>
                                    <td className="px-4 py-3">
                                        <TaskStatusBadge status={t.status} />
                                        {taskNote(t) && <span className="block text-xs text-slate-600">{taskNote(t)}</span>}
                                    </td>
                                    <td className="px-4 py-3 tabular-nums">
                                        {t.collected?.paise ? `${formatPaise(t.collected.paise)}${t.collected.mode ? ` · ${t.collected.mode.toUpperCase()}` : ''}` : '—'}
                                    </td>
                                    <td className="px-4 py-3 tabular-nums">{formatPaise(t.payoutPaise)}</td>
                                    <td className="px-4 py-3 text-slate-600">{when(t.createdAt)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </section>

                <div className="space-y-6">
                    <section className="card space-y-1 text-sm">
                        <h2 className="mb-2 font-semibold">Now</h2>
                        <LastSeen rider={rider} />
                        {loc ? (
                            <p className="pt-1">
                                <a href={mapsUrl(loc)} target="_blank" rel="noreferrer" className="font-medium text-brand-700 hover:underline">Open last location in Google Maps</a>
                                <span className="block text-xs text-slate-500">Reported {ago(loc.at)}</span>
                            </p>
                        ) : (
                            <p className="text-slate-500">No location reported yet.</p>
                        )}
                    </section>
                    <section className="card space-y-1 text-sm">
                        <h2 className="mb-2 font-semibold">Work</h2>
                        <p><span className="text-slate-500">Shops: </span>{shopsLabel(rider.modules)}</p>
                        <p><span className="text-slate-500">Payout per delivery: </span>{formatPaise(rider.payoutPerTaskPaise)}</p>
                    </section>
                </div>
            </div>

            <Modal open={editing} title={`Edit ${rider.name}`} onClose={() => setEditing(false)} wide>
                {editing && <RiderForm rider={rider} onDone={() => setEditing(false)} />}
            </Modal>
        </div>
    );
}
