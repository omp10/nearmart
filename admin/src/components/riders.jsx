import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router';
import { api } from '../lib/api.js';
import { formatPaise } from '../lib/money.js';
import { TASK_KIND_LABELS, TASK_STATUS_LABELS, TASK_STATUS_TONES, ago, isActiveTask, refPath } from '../lib/riders.js';
import { Badge, ErrorNote, Modal } from './ui.jsx';

export function OnlineDot({ online }) {
    return (
        <span
            className={`inline-block h-2 w-2 shrink-0 rounded-full ${online ? 'bg-brand-500' : 'bg-slate-300'}`}
            title={online ? 'Online' : 'Offline'}
            aria-label={online ? 'Online' : 'Offline'}
            role="img"
        />
    );
}

export function TaskStatusBadge({ status }) {
    return <Badge tone={TASK_STATUS_TONES[status]}>{TASK_STATUS_LABELS[status] ?? status}</Badge>;
}

/** Asks for a reason, then cancels the task. `task` null keeps it closed. */
export function CancelTaskModal({ task, onClose, onDone }) {
    const [reason, setReason] = useState('');
    const cancel = useMutation({
        mutationFn: () => api.post(`/admin/riders/tasks/${task._id}/cancel`, { reason }),
        onSuccess: () => {
            setReason('');
            onDone?.();
            onClose();
        }
    });

    return (
        <Modal open={Boolean(task)} title="Cancel assignment" onClose={onClose}>
            {task && (
                <form
                    className="space-y-4"
                    onSubmit={(e) => {
                        e.preventDefault();
                        cancel.mutate();
                    }}
                >
                    <ErrorNote error={cancel.error} />
                    <p className="text-sm text-slate-600">
                        {task.rider?.name} is taken off this {TASK_KIND_LABELS[task.kind]?.toLowerCase()} for #{task.ref?.number}. You can assign someone else afterwards.
                    </p>
                    <div>
                        <label className="label" htmlFor="task-cancel-reason">Reason</label>
                        <input id="task-cancel-reason" className="input" value={reason} onChange={(e) => setReason(e.target.value)} required minLength={3} maxLength={300} />
                    </div>
                    <div className="flex justify-end gap-2">
                        <button type="button" className="btn-ghost" onClick={onClose}>Keep assignment</button>
                        <button type="submit" className="btn bg-red-600 text-white hover:bg-red-700" disabled={cancel.isPending}>
                            {cancel.isPending ? 'Cancelling…' : 'Cancel assignment'}
                        </button>
                    </div>
                </form>
            )}
        </Modal>
    );
}

/** Why a task ended badly: the partner's fail reason, else the last timeline note (e.g. a cancel reason). */
export const taskNote = (t) =>
    [t.failReason, t.failNote].filter(Boolean).join(' — ') || (t.status !== 'completed' ? t.timeline?.at(-1)?.note : '') || '';

const when = (d) => new Date(d).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

/**
 * The "Delivery partner" card on an order or booking: who is on it now, or a
 * picker to assign someone, plus earlier attempts.
 *
 * `kind` is the task to create (null when the record's status allows none);
 * `module` narrows the picker to partners who work for that shop.
 */
export function DeliveryCard({ refId, module, kind, canAssign, onChanged }) {
    const queryClient = useQueryClient();
    const [riderId, setRiderId] = useState('');
    const [cancelling, setCancelling] = useState(null);

    const taskParams = { refId, status: 'all', limit: 20 };
    const tasks = useQuery({
        queryKey: ['rider-tasks', taskParams],
        queryFn: () => api.get('/admin/riders/tasks', { params: taskParams }).then((r) => r.data.data),
        // The partner moves the task along from the app.
        refetchInterval: 30_000
    });
    const all = [...(tasks.data?.items ?? [])].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    const active = all.find(isActiveTask);
    const past = all.filter((t) => t !== active);
    const showPicker = !active && canAssign && Boolean(kind) && tasks.isSuccess;

    const riderParams = { status: 'active', limit: 100 };
    const riders = useQuery({
        queryKey: ['riders', riderParams],
        queryFn: () => api.get('/admin/riders', { params: riderParams }).then((r) => r.data.data),
        enabled: showPicker
    });
    const choices = (riders.data?.items ?? [])
        .filter((r) => !module || !r.modules?.length || r.modules.includes(module))
        .sort((a, b) => Number(b.isOnline) - Number(a.isOnline) || a.name.localeCompare(b.name));
    const online = choices.filter((r) => r.isOnline);
    const offline = choices.filter((r) => !r.isOnline);
    const selected = choices.find((r) => r._id === riderId);

    const refresh = () => {
        queryClient.invalidateQueries({ queryKey: ['rider-tasks'] });
        queryClient.invalidateQueries({ queryKey: ['riders'] });
        onChanged?.();
    };
    const assign = useMutation({
        mutationFn: () => api.post('/admin/riders/tasks', { kind, refId, riderId }),
        onSuccess: () => {
            setRiderId('');
            refresh();
        }
    });

    // Nothing to show: no say over delivery partners, or nothing assignable and no history.
    if (tasks.error?.response?.status === 403) return null;
    if (tasks.isSuccess && !all.length && !showPicker) return null;

    const label = (r) =>`${r.name} · ${r.phone}${r.activeTasks ? ` · ${r.activeTasks} on hand` : ''}`;

    return (
        <section className="card space-y-2 text-sm">
            <h2 className="mb-2 font-semibold">Delivery partner</h2>
            <ErrorNote error={tasks.error} />
            {tasks.isLoading && <p className="text-slate-500">Loading…</p>}

            {active && (
                <div className="space-y-1">
                    <p className="flex items-center gap-2">
                        <span className="font-medium">{active.rider?.name}</span>
                        <TaskStatusBadge status={active.status} />
                    </p>
                    <p>
                        <a href={`tel:${active.rider?.phone}`} className="text-brand-700 hover:underline">{active.rider?.phone}</a>
                        <span className="text-slate-500"> · {TASK_KIND_LABELS[active.kind]}</span>
                    </p>
                    <p className="text-xs text-slate-500">
                        Assigned {ago(active.createdAt)}
                        {active.updatedAt && active.updatedAt !== active.createdAt && ` · updated ${ago(active.updatedAt)}`}
                        {active.status === 'offered' && active.offerExpiresAt && ` · offer ends ${when(active.offerExpiresAt)}`}
                    </p>
                    {active.payment?.collectPaise > 0 && <p className="text-amber-700">To collect: {formatPaise(active.payment.collectPaise)}</p>}
                    {canAssign && (
                        <button type="button" className="btn-ghost mt-1 px-2 py-1 text-red-600" onClick={() => setCancelling(active)}>Cancel assignment</button>
                    )}
                </div>
            )}

            {!active && tasks.isSuccess && !showPicker && <p className="text-slate-500">No delivery partner on this now.</p>}

            {showPicker && (
                <form
                    className="space-y-2"
                    onSubmit={(e) => {
                        e.preventDefault();
                        assign.mutate();
                    }}
                >
                    <ErrorNote error={riders.error || assign.error} />
                    <label className="label" htmlFor={`assign-${refId}`}>Assign {TASK_KIND_LABELS[kind].toLowerCase()} to</label>
                    <div className="flex items-center gap-2">
                        {selected && <OnlineDot online={selected.isOnline} />}
                        <select id={`assign-${refId}`} className="input" value={riderId} onChange={(e) => setRiderId(e.target.value)} required>
                            <option value="">{riders.isLoading ? 'Loading…' : choices.length ? 'Choose a delivery partner' : 'No active delivery partners'}</option>
                            {online.length > 0 && (
                                <optgroup label="Online now">
                                    {online.map((r) => <option key={r._id} value={r._id}>{label(r)}</option>)}
                                </optgroup>
                            )}
                            {offline.length > 0 && (
                                <optgroup label="Offline">
                                    {offline.map((r) => <option key={r._id} value={r._id}>{label(r)}</option>)}
                                </optgroup>
                            )}
                        </select>
                    </div>
                    <button type="submit" className="btn-primary w-full" disabled={!riderId || assign.isPending}>
                        {assign.isPending ? 'Assigning…' : 'Assign delivery partner'}
                    </button>
                </form>
            )}

            {past.length > 0 && (
                <div className="border-t border-slate-100 pt-2">
                    <p className="mb-1 text-xs font-medium text-slate-500">Earlier</p>
                    <ol className="space-y-1.5">
                        {past.map((t) => (
                            <li key={t._id} className="border-l-2 border-slate-200 pl-3">
                                <span className="font-medium">{t.rider?.name}</span> <TaskStatusBadge status={t.status} />
                                <span className="block text-xs text-slate-500">{TASK_KIND_LABELS[t.kind]} · {when(t.updatedAt || t.createdAt)}</span>
                                {taskNote(t) && <span className="block text-xs text-slate-600">{taskNote(t)}</span>}
                            </li>
                        ))}
                    </ol>
                </div>
            )}

            <CancelTaskModal task={cancelling} onClose={() => setCancelling(null)} onDone={refresh} />
        </section>
    );
}

/** Link to the order or booking a task is for. */
export function TaskRefLink({ task }) {
    return <Link to={refPath(task.ref)} className="font-medium text-brand-700 hover:underline">#{task.ref?.number}</Link>;
}
