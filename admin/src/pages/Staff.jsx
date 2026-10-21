import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../auth/AuthProvider.jsx';
import { api } from '../lib/api.js';
import { BUSINESS_MODULES, PERMISSION_ACTIONS, PERMISSION_SECTIONS } from '../nav.js';
import { Badge, ErrorNote, Modal } from '../components/ui.jsx';

const EMPTY_FORM = { name: '', email: '', phone: '', password: '', role: 'ops', modules: [], permissions: {} };

function PermissionGrid({ value, onChange, grantable }) {
    const toggle = (section, action) => {
        const current = value[section] || [];
        const next = current.includes(action) ? current.filter((a) => a !== action) : [...current, action];
        onChange({ ...value, [section]: next });
    };

    return (
        <div className="overflow-x-auto">
            <table className="w-full text-sm">
                <thead>
                    <tr className="text-left text-slate-500">
                        <th className="py-1 pr-4 font-medium">Section</th>
                        {PERMISSION_ACTIONS.map((a) => <th key={a} className="px-2 py-1 font-medium capitalize">{a}</th>)}
                    </tr>
                </thead>
                <tbody>
                    {PERMISSION_SECTIONS.map(({ section, label }) => (
                        <tr key={section} className="border-t border-slate-100">
                            <td className="py-1.5 pr-4">{label}</td>
                            {PERMISSION_ACTIONS.map((action) => (
                                <td key={action} className="px-2 py-1.5">
                                    <input
                                        type="checkbox"
                                        aria-label={`${label}: ${action}`}
                                        checked={Boolean(value[section]?.includes(action))}
                                        disabled={!grantable(section, action)}
                                        onChange={() => toggle(section, action)}
                                    />
                                </td>
                            ))}
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

/** Create (no `member`) or edit an existing staff member's details and access. */
function StaffForm({ member, onDone }) {
    const { can, user } = useAuth();
    const queryClient = useQueryClient();
    const isEdit = Boolean(member);
    const [form, setForm] = useState(
        member
            ? { name: member.name, email: member.email, phone: member.phone || '', password: '', role: member.role, modules: member.modules, permissions: member.permissions || {} }
            : EMPTY_FORM
    );
    const set = (patch) => setForm((f) => ({ ...f, ...patch }));
    // Ops users may only hand out the modules they have themselves.
    const modules = user.role === 'ops' && !user.isSuperAdmin ? BUSINESS_MODULES.filter((m) => user.modules.includes(m.id)) : BUSINESS_MODULES;

    const save = useMutation({
        mutationFn: (body) => (isEdit ? api.patch(`/admin/staff/${member.id}`, body) : api.post('/admin/staff', body)),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['staff'] });
            onDone();
        }
    });

    const submit = (e) => {
        e.preventDefault();
        const permissions = Object.fromEntries(Object.entries(form.permissions).filter(([, a]) => a?.length));
        const access = { role: form.role, modules: form.role === 'ops' ? form.modules : [], permissions };
        save.mutate(
            isEdit
                ? { name: form.name, phone: form.phone, ...access }
                : { name: form.name, email: form.email, password: form.password, phone: form.phone || undefined, ...access }
        );
    };

    return (
        <form onSubmit={submit} className="space-y-4">
            <ErrorNote error={save.error} />
            <div className="grid gap-4 sm:grid-cols-2">
                <div>
                    <label className="label" htmlFor="s-name">Name</label>
                    <input id="s-name" className="input" value={form.name} onChange={(e) => set({ name: e.target.value })} required maxLength={80} />
                </div>
                <div>
                    <label className="label" htmlFor="s-email">Email</label>
                    <input id="s-email" type="email" className="input" value={form.email} onChange={(e) => set({ email: e.target.value })} required disabled={isEdit} />
                </div>
                <div>
                    <label className="label" htmlFor="s-phone">Phone (optional)</label>
                    <input id="s-phone" className="input" value={form.phone} onChange={(e) => set({ phone: e.target.value })} maxLength={20} />
                </div>
                {!isEdit && (
                    <div>
                        <label className="label" htmlFor="s-password">Temporary password</label>
                        <input id="s-password" type="password" className="input" minLength={10} autoComplete="new-password" value={form.password} onChange={(e) => set({ password: e.target.value })} required />
                    </div>
                )}
                <div>
                    <label className="label" htmlFor="s-role">Role</label>
                    <select id="s-role" className="input" value={form.role} onChange={(e) => set({ role: e.target.value })}>
                        <option value="ops">Operations / vendor</option>
                        {(user.role === 'admin' || user.isSuperAdmin) && <option value="admin">Admin</option>}
                    </select>
                </div>
            </div>

            {form.role === 'ops' && (
                <fieldset>
                    <legend className="label">Modules this person works on</legend>
                    <div className="flex flex-wrap gap-4">
                        {modules.map((m) => (
                            <label key={m.id} className="flex items-center gap-2 text-sm">
                                <input
                                    type="checkbox"
                                    checked={form.modules.includes(m.id)}
                                    onChange={() => set({ modules: form.modules.includes(m.id) ? form.modules.filter((x) => x !== m.id) : [...form.modules, m.id] })}
                                />
                                {m.label}
                            </label>
                        ))}
                    </div>
                </fieldset>
            )}

            <div>
                <div className="label">Permissions</div>
                <PermissionGrid value={form.permissions} onChange={(permissions) => set({ permissions })} grantable={can} />
                {isEdit && <p className="mt-1 text-xs text-slate-500">Changes apply to the API at once; the person's panel shows the new menu after they reload it.</p>}
            </div>

            <div className="flex justify-end gap-2">
                <button type="button" className="btn-ghost" onClick={onDone}>Cancel</button>
                <button type="submit" className="btn-primary" disabled={save.isPending}>{save.isPending ? 'Saving…' : isEdit ? 'Save changes' : 'Create'}</button>
            </div>
        </form>
    );
}

function ResetPasswordForm({ member, onDone }) {
    const [password, setPassword] = useState('');
    const reset = useMutation({ mutationFn: () => api.post(`/admin/staff/${member.id}/reset-password`, { password }), onSuccess: onDone });
    return (
        <form
            className="space-y-4"
            onSubmit={(e) => {
                e.preventDefault();
                reset.mutate();
            }}
        >
            <ErrorNote error={reset.error} />
            <p className="text-sm text-slate-600">
                Sets a new password for {member.name}, unlocks the account if it was locked, and signs them out everywhere. Share the new password with them privately.
            </p>
            <div>
                <label className="label" htmlFor="rp-password">New password</label>
                <input id="rp-password" type="password" className="input" minLength={10} autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
            </div>
            <div className="flex justify-end gap-2">
                <button type="button" className="btn-ghost" onClick={onDone}>Cancel</button>
                <button type="submit" className="btn-primary" disabled={reset.isPending}>{reset.isPending ? 'Saving…' : 'Reset password'}</button>
            </div>
        </form>
    );
}

export default function Staff() {
    const { can, user } = useAuth();
    const queryClient = useQueryClient();
    const [dialog, setDialog] = useState(null); // { type: 'create' | 'edit' | 'password', member? }

    const { data: staff = [], isLoading, error } = useQuery({ queryKey: ['staff'], queryFn: () => api.get('/admin/staff').then((r) => r.data.data) });
    const toggleActive = useMutation({
        mutationFn: ({ id, isActive }) => api.patch(`/admin/staff/${id}`, { isActive }),
        onSuccess: () => queryClient.invalidateQueries({ queryKey: ['staff'] })
    });
    const close = () => {
        setDialog(null);
        queryClient.invalidateQueries({ queryKey: ['staff'] });
    };

    return (
        <div className="space-y-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                    <h1 className="text-2xl font-semibold">Staff & roles</h1>
                    <p className="text-sm text-slate-500">Admins and the operations / vendor users who fulfil orders.</p>
                </div>
                {can('staff', 'create') && <button type="button" className="btn-primary" onClick={() => setDialog({ type: 'create' })}>Add staff</button>}
            </div>

            <ErrorNote error={error || toggleActive.error} />

            <div className="card overflow-x-auto p-0">
                <table className="w-full text-sm">
                    <thead className="bg-slate-50 text-left text-slate-500">
                        <tr>
                            <th className="px-4 py-3 font-medium">Name</th>
                            <th className="px-4 py-3 font-medium">Role</th>
                            <th className="px-4 py-3 font-medium">Modules</th>
                            <th className="px-4 py-3 font-medium">Last sign-in</th>
                            <th className="px-4 py-3 font-medium">Status</th>
                            <th className="px-4 py-3" />
                        </tr>
                    </thead>
                    <tbody>
                        {isLoading && <tr><td colSpan={6} className="px-4 py-6 text-center text-slate-500">Loading…</td></tr>}
                        {staff.map((s) => {
                            const manageable = can('staff', 'update') && !s.isSuperAdmin && s.id !== user.id;
                            return (
                                <tr key={s.id} className="border-t border-slate-100">
                                    <td className="px-4 py-3">
                                        <span className="font-medium">{s.name}</span>
                                        <span className="block text-xs text-slate-500">{s.email}</span>
                                    </td>
                                    <td className="px-4 py-3">{s.isSuperAdmin ? 'Super admin' : s.role === 'ops' ? 'Operations' : 'Admin'}</td>
                                    <td className="px-4 py-3 text-slate-600">{s.role === 'ops' ? s.modules.join(', ') || '—' : 'All'}</td>
                                    <td className="px-4 py-3 text-slate-600">{s.lastLoginAt ? new Date(s.lastLoginAt).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'Never'}</td>
                                    <td className="px-4 py-3">
                                        {s.isActive ? <Badge tone="green">Active</Badge> : <Badge>Disabled</Badge>}
                                        {s.lockedUntil && <span className="ml-1"><Badge tone="red">Locked</Badge></span>}
                                    </td>
                                    <td className="whitespace-nowrap px-4 py-3 text-right">
                                        {manageable && (
                                            <>
                                                <button type="button" className="btn-ghost px-2 py-1" onClick={() => setDialog({ type: 'edit', member: s })}>Edit</button>
                                                <button type="button" className="btn-ghost px-2 py-1" onClick={() => setDialog({ type: 'password', member: s })}>
                                                    {s.lockedUntil ? 'Unlock' : 'Reset password'}
                                                </button>
                                                <button type="button" className="btn-ghost px-2 py-1" disabled={toggleActive.isPending} onClick={() => toggleActive.mutate({ id: s.id, isActive: !s.isActive })}>
                                                    {s.isActive ? 'Disable' : 'Enable'}
                                                </button>
                                            </>
                                        )}
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>

            <Modal open={dialog?.type === 'create' || dialog?.type === 'edit'} title={dialog?.type === 'edit' ? `Edit ${dialog.member.name}` : 'New staff member'} onClose={() => setDialog(null)} wide>
                {(dialog?.type === 'create' || dialog?.type === 'edit') && <StaffForm member={dialog.member} onDone={close} />}
            </Modal>
            <Modal open={dialog?.type === 'password'} title={dialog?.member?.lockedUntil ? `Unlock ${dialog.member.name}` : `Reset password for ${dialog?.member?.name ?? ''}`} onClose={() => setDialog(null)}>
                {dialog?.type === 'password' && <ResetPasswordForm member={dialog.member} onDone={close} />}
            </Modal>
        </div>
    );
}
