import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../auth/AuthProvider.jsx';
import { ModuleTabs, useCurrentModule } from '../lib/moduleContext.jsx';
import { api } from '../lib/api.js';
import { Badge, ErrorNote, Modal, useModules } from '../components/ui.jsx';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const KIND_LABELS = { delivery: 'Delivery', pickup: 'Pickup', return: 'Return delivery' };
const kindsFor = (module) => (module === 'laundry' ? ['pickup', 'return'] : ['delivery']);

const daysText = (days) => {
    if (days.length === 7) return 'Every day';
    if (days.join() === '1,2,3,4,5,6') return 'Mon–Sat';
    if (days.join() === '1,2,3,4,5') return 'Mon–Fri';
    return days.map((d) => DAYS[d]).join(', ');
};

const useZones = () =>
    useQuery({ queryKey: ['zones'], queryFn: () => api.get('/admin/zones').then((r) => r.data.data), staleTime: 60_000 });

function RuleForm({ module, rule, onDone }) {
    const queryClient = useQueryClient();
    const { data: zones = [] } = useZones();
    const kinds = kindsFor(module);
    const [form, setForm] = useState({
        kind: rule?.kind ?? kinds[0],
        zone: rule?.zone?._id ?? '',
        daysOfWeek: rule?.daysOfWeek ?? [1, 2, 3, 4, 5, 6],
        start: rule?.start ?? '09:00',
        end: rule?.end ?? '12:00',
        capacity: String(rule?.capacity ?? 20),
        cutoffMinutes: String(rule?.cutoffMinutes ?? 60),
        isActive: rule?.isActive ?? true
    });
    const set = (patch) => setForm((f) => ({ ...f, ...patch }));

    const save = useMutation({
        mutationFn: (body) => (rule?._id ? api.patch(`/admin/slots/rules/${rule._id}`, body) : api.post('/admin/slots/rules', { ...body, module })),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['slot-rules'] });
            queryClient.invalidateQueries({ queryKey: ['slot-preview'] });
            onDone();
        }
    });

    return (
        <form
            className="space-y-4"
            onSubmit={(e) => {
                e.preventDefault();
                save.mutate({
                    ...form,
                    zone: form.zone || null,
                    capacity: Number.parseInt(form.capacity, 10),
                    cutoffMinutes: Number.parseInt(form.cutoffMinutes, 10) || 0
                });
            }}
        >
            <ErrorNote error={save.error} />
            <div className="grid gap-4 sm:grid-cols-2">
                <div>
                    <label className="label" htmlFor="r-kind">Type</label>
                    <select id="r-kind" className="input" value={form.kind} onChange={(e) => set({ kind: e.target.value })}>
                        {kinds.map((k) => <option key={k} value={k}>{KIND_LABELS[k]}</option>)}
                    </select>
                </div>
                <div>
                    <label className="label" htmlFor="r-zone">Applies to</label>
                    <select id="r-zone" className="input" value={form.zone} onChange={(e) => set({ zone: e.target.value })}>
                        <option value="">All service areas</option>
                        {zones.filter((z) => z.modules.includes(module)).map((z) => <option key={z._id} value={z._id}>{z.name} only</option>)}
                    </select>
                </div>
            </div>

            <fieldset>
                <legend className="label">Days</legend>
                <div className="flex flex-wrap gap-1">
                    {DAYS.map((d, i) => {
                        const on = form.daysOfWeek.includes(i);
                        return (
                            <button
                                key={d}
                                type="button"
                                aria-pressed={on}
                                onClick={() => set({ daysOfWeek: on ? form.daysOfWeek.filter((x) => x !== i) : [...form.daysOfWeek, i].sort() })}
                                className={`rounded-md border px-3 py-1.5 text-sm ${on ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-slate-300 text-slate-500'}`}
                            >
                                {d}
                            </button>
                        );
                    })}
                </div>
            </fieldset>

            <div className="grid gap-4 sm:grid-cols-4">
                <div>
                    <label className="label" htmlFor="r-start">From</label>
                    <input id="r-start" type="time" className="input" value={form.start} onChange={(e) => set({ start: e.target.value })} required />
                </div>
                <div>
                    <label className="label" htmlFor="r-end">To</label>
                    <input id="r-end" type="time" className="input" value={form.end} onChange={(e) => set({ end: e.target.value })} required />
                </div>
                <div>
                    <label className="label" htmlFor="r-cap">Capacity</label>
                    <input id="r-cap" type="number" min="1" className="input" value={form.capacity} onChange={(e) => set({ capacity: e.target.value })} required />
                </div>
                <div>
                    <label className="label" htmlFor="r-cut">Cutoff (min)</label>
                    <input id="r-cut" type="number" min="0" className="input" value={form.cutoffMinutes} onChange={(e) => set({ cutoffMinutes: e.target.value })} />
                </div>
            </div>
            <p className="text-xs text-slate-500">Capacity is orders per slot per day. Ordering for a slot closes the cutoff time before it starts.</p>

            <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={form.isActive} onChange={(e) => set({ isActive: e.target.checked })} />
                Active
            </label>
            <div className="flex justify-end gap-2">
                <button type="button" className="btn-ghost" onClick={onDone}>Cancel</button>
                <button type="submit" className="btn-primary" disabled={save.isPending || !form.daysOfWeek.length}>{save.isPending ? 'Saving…' : 'Save'}</button>
            </div>
        </form>
    );
}

function Preview({ module }) {
    const kinds = kindsFor(module);
    const [kind, setKind] = useState(kinds[0]);
    const [zone, setZone] = useState('');
    const { data: zones = [] } = useZones();
    const activeKind = kinds.includes(kind) ? kind : kinds[0];
    const params = { module, kind: activeKind, days: 7, ...(zone ? { zone } : {}) };
    const { data: days = [], error } = useQuery({
        queryKey: ['slot-preview', params],
        queryFn: () => api.get('/admin/slots/preview', { params }).then((r) => r.data.data)
    });

    return (
        <section className="card space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="font-semibold">Next 7 days</h2>
                <div className="flex gap-2">
                    {kinds.length > 1 && (
                        <select className="input w-auto" aria-label="Slot type" value={activeKind} onChange={(e) => setKind(e.target.value)}>
                            {kinds.map((k) => <option key={k} value={k}>{KIND_LABELS[k]}</option>)}
                        </select>
                    )}
                    <select className="input w-auto" aria-label="Service area" value={zone} onChange={(e) => setZone(e.target.value)}>
                        <option value="">Areas without own rules</option>
                        {zones.filter((z) => z.modules.includes(module)).map((z) => <option key={z._id} value={z._id}>{z.name}</option>)}
                    </select>
                </div>
            </div>
            <ErrorNote error={error} />
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {days.map((d) => (
                    <div key={d.date} className="rounded-lg border border-slate-200 p-3">
                        <div className="mb-2 text-sm font-medium">
                            {new Date(`${d.date}T00:00:00`).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })}
                        </div>
                        {d.closed && <Badge tone="red">Closed · {d.closed}</Badge>}
                        {!d.closed && d.slots.length === 0 && <p className="text-xs text-slate-400">No slots</p>}
                        <ul className="space-y-1">
                            {d.slots.map((s) => (
                                <li key={s.id} className="flex items-center justify-between text-xs">
                                    <span className={s.available ? '' : 'text-slate-400'}>{s.label}</span>
                                    <span className={s.booked >= s.capacity ? 'font-medium text-red-600' : 'text-slate-500'}>{s.booked}/{s.capacity}</span>
                                </li>
                            ))}
                        </ul>
                    </div>
                ))}
            </div>
        </section>
    );
}

function Blackouts() {
    const { can, user } = useAuth();
    const queryClient = useQueryClient();
    const { data: modules = [] } = useModules();
    const [form, setForm] = useState({ date: '', module: '', reason: '' });
    const isAdmin = user.role === 'admin';
    const { data: rows = [], error } = useQuery({
        queryKey: ['blackouts'],
        queryFn: () => api.get('/admin/slots/blackouts').then((r) => r.data.data)
    });
    const refresh = () => {
        queryClient.invalidateQueries({ queryKey: ['blackouts'] });
        queryClient.invalidateQueries({ queryKey: ['slot-preview'] });
    };
    const add = useMutation({
        mutationFn: () => api.post('/admin/slots/blackouts', { date: form.date, module: form.module || null, reason: form.reason || undefined }),
        onSuccess: () => {
            setForm({ date: '', module: '', reason: '' });
            refresh();
        }
    });
    const remove = useMutation({ mutationFn: (id) => api.delete(`/admin/slots/blackouts/${id}`), onSuccess: refresh });
    const upcoming = rows.filter((r) => r.date >= new Date().toISOString().slice(0, 10));

    return (
        <section className="card space-y-3">
            <h2 className="font-semibold">Closed dates</h2>
            <ErrorNote error={error || add.error || remove.error} />
            {isAdmin && can('zones', 'create') && (
                <form
                    className="grid gap-3 sm:grid-cols-[10rem_12rem_1fr_auto]"
                    onSubmit={(e) => {
                        e.preventDefault();
                        add.mutate();
                    }}
                >
                    <input type="date" className="input" aria-label="Date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} required />
                    <select className="input" aria-label="Module" value={form.module} onChange={(e) => setForm({ ...form, module: e.target.value })}>
                        <option value="">All modules</option>
                        {modules.map((m) => <option key={m.key} value={m.key}>{m.name}</option>)}
                    </select>
                    <input className="input" placeholder="Reason, e.g. Diwali" aria-label="Reason" value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} maxLength={120} />
                    <button type="submit" className="btn-primary" disabled={add.isPending}>Add</button>
                </form>
            )}
            {upcoming.length === 0 ? (
                <p className="text-sm text-slate-500">No upcoming closed dates.</p>
            ) : (
                <ul className="divide-y divide-slate-100 text-sm">
                    {upcoming.map((b) => (
                        <li key={b._id} className="flex items-center justify-between py-2">
                            <span>
                                <strong>{b.date}</strong> · {b.module ?? 'all modules'}
                                {b.zone && ` · ${b.zone.name}`}
                                {b.reason && <span className="text-slate-500"> · {b.reason}</span>}
                            </span>
                            {isAdmin && can('zones', 'delete') && (
                                <button type="button" className="btn-ghost px-2 py-1 text-red-600" onClick={() => remove.mutate(b._id)}>Remove</button>
                            )}
                        </li>
                    ))}
                </ul>
            )}
        </section>
    );
}

export default function Slots() {
    const { can } = useAuth();
    const queryClient = useQueryClient();
    const { module } = useCurrentModule();
    const [editing, setEditing] = useState(null);
    const { data: rules = [], isLoading, error } = useQuery({
        queryKey: ['slot-rules', module],
        queryFn: () => api.get('/admin/slots/rules', { params: { module } }).then((r) => r.data.data)
    });
    const refresh = () => {
        queryClient.invalidateQueries({ queryKey: ['slot-rules'] });
        queryClient.invalidateQueries({ queryKey: ['slot-preview'] });
    };
    const toggle = useMutation({ mutationFn: (r) => api.patch(`/admin/slots/rules/${r._id}`, { isActive: !r.isActive }), onSuccess: refresh });
    const remove = useMutation({ mutationFn: (id) => api.delete(`/admin/slots/rules/${id}`), onSuccess: refresh });

    return (
        <div className="space-y-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                    <h1 className="text-2xl font-semibold">Delivery & pickup slots</h1>
                    <p className="text-sm text-slate-500">Weekly time windows customers choose from at checkout.</p>
                </div>
                {can('zones', 'create') && <button type="button" className="btn-primary" onClick={() => setEditing({})}>Add slot rule</button>}
            </div>

            <ModuleTabs />
            <ErrorNote error={error || toggle.error || remove.error} />

            <div className="card overflow-x-auto p-0">
                <table className="w-full text-sm">
                    <thead className="bg-slate-50 text-left text-slate-500">
                        <tr>
                            <th className="px-4 py-3 font-medium">Type</th>
                            <th className="px-4 py-3 font-medium">Days</th>
                            <th className="px-4 py-3 font-medium">Time</th>
                            <th className="px-4 py-3 font-medium">Capacity</th>
                            <th className="px-4 py-3 font-medium">Cutoff</th>
                            <th className="px-4 py-3 font-medium">Area</th>
                            <th className="px-4 py-3 font-medium">Status</th>
                            <th className="px-4 py-3" />
                        </tr>
                    </thead>
                    <tbody>
                        {isLoading && <tr><td colSpan={8} className="px-4 py-6 text-center text-slate-500">Loading…</td></tr>}
                        {!isLoading && rules.length === 0 && (
                            <tr><td colSpan={8} className="px-4 py-6 text-center text-slate-500">No slots yet for this module.</td></tr>
                        )}
                        {rules.map((r) => (
                            <tr key={r._id} className="border-t border-slate-100">
                                <td className="px-4 py-3">{KIND_LABELS[r.kind]}</td>
                                <td className="px-4 py-3">{daysText(r.daysOfWeek)}</td>
                                <td className="px-4 py-3 tabular-nums">{r.start}–{r.end}</td>
                                <td className="px-4 py-3">{r.capacity}</td>
                                <td className="px-4 py-3 text-slate-600">{r.cutoffMinutes} min</td>
                                <td className="px-4 py-3 text-slate-600">{r.zone?.name ?? 'All'}</td>
                                <td className="px-4 py-3">{r.isActive ? <Badge tone="green">On</Badge> : <Badge>Off</Badge>}</td>
                                <td className="whitespace-nowrap px-4 py-3 text-right">
                                    {can('zones', 'update') && (
                                        <>
                                            <button type="button" className="btn-ghost px-2 py-1" onClick={() => toggle.mutate(r)}>{r.isActive ? 'Turn off' : 'Turn on'}</button>
                                            <button type="button" className="btn-ghost px-2 py-1" onClick={() => setEditing(r)}>Edit</button>
                                        </>
                                    )}
                                    {can('zones', 'delete') && (
                                        <button type="button" className="btn-ghost px-2 py-1 text-red-600" onClick={() => window.confirm('Delete this slot rule?') && remove.mutate(r._id)}>Delete</button>
                                    )}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            <Preview module={module} />
            <Blackouts />

            <Modal open={Boolean(editing)} title={editing?._id ? 'Edit slot rule' : 'New slot rule'} onClose={() => setEditing(null)} wide>
                {editing && <RuleForm module={module} rule={editing._id ? editing : null} onDone={() => setEditing(null)} />}
            </Modal>
        </div>
    );
}
