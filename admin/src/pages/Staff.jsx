import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../auth/AuthProvider.jsx';
import { api, errorMessage } from '../lib/api.js';
import { BUSINESS_MODULES, NAV_ITEMS, PERMISSION_ACTIONS } from '../nav.js';

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
                        {PERMISSION_ACTIONS.map((a) => (
                            <th key={a} className="px-2 py-1 font-medium capitalize">{a}</th>
                        ))}
                    </tr>
                </thead>
                <tbody>
                    {NAV_ITEMS.map(({ section, label }) => (
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

function CreateStaffForm({ onDone }) {
    const { can } = useAuth();
    const queryClient = useQueryClient();
    const [form, setForm] = useState(EMPTY_FORM);
    const set = (patch) => setForm((f) => ({ ...f, ...patch }));

    const mutation = useMutation({
        mutationFn: (body) => api.post('/admin/staff', body),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['staff'] });
            onDone();
        }
    });

    const submit = (e) => {
        e.preventDefault();
        const permissions = Object.fromEntries(Object.entries(form.permissions).filter(([, a]) => a.length));
        mutation.mutate({ ...form, phone: form.phone || undefined, permissions });
    };

    return (
        <form onSubmit={submit} className="card space-y-4">
            <h2 className="text-lg font-semibold">New staff member</h2>
            {mutation.error && (
                <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
                    {errorMessage(mutation.error)}
                </p>
            )}

            <div className="grid gap-4 sm:grid-cols-2">
                <div>
                    <label className="label" htmlFor="s-name">Name</label>
                    <input id="s-name" className="input" value={form.name} onChange={(e) => set({ name: e.target.value })} required />
                </div>
                <div>
                    <label className="label" htmlFor="s-email">Email</label>
                    <input id="s-email" type="email" className="input" value={form.email} onChange={(e) => set({ email: e.target.value })} required />
                </div>
                <div>
                    <label className="label" htmlFor="s-phone">Phone (optional)</label>
                    <input id="s-phone" className="input" value={form.phone} onChange={(e) => set({ phone: e.target.value })} />
                </div>
                <div>
                    <label className="label" htmlFor="s-password">Temporary password</label>
                    <input
                        id="s-password"
                        type="password"
                        className="input"
                        minLength={10}
                        autoComplete="new-password"
                        value={form.password}
                        onChange={(e) => set({ password: e.target.value })}
                        required
                    />
                </div>
                <div>
                    <label className="label" htmlFor="s-role">Role</label>
                    <select id="s-role" className="input" value={form.role} onChange={(e) => set({ role: e.target.value })}>
                        <option value="ops">Operations / vendor</option>
                        <option value="admin">Admin</option>
                    </select>
                </div>
            </div>

            {form.role === 'ops' && (
                <fieldset>
                    <legend className="label">Modules</legend>
                    <div className="flex flex-wrap gap-4">
                        {BUSINESS_MODULES.map((m) => (
                            <label key={m.id} className="flex items-center gap-2 text-sm">
                                <input
                                    type="checkbox"
                                    checked={form.modules.includes(m.id)}
                                    onChange={() =>
                                        set({
                                            modules: form.modules.includes(m.id)
                                                ? form.modules.filter((x) => x !== m.id)
                                                : [...form.modules, m.id]
                                        })
                                    }
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
            </div>

            <div className="flex justify-end gap-2">
                <button type="button" className="btn-ghost" onClick={onDone}>Cancel</button>
                <button type="submit" className="btn-primary" disabled={mutation.isPending}>
                    {mutation.isPending ? 'Creating…' : 'Create'}
                </button>
            </div>
        </form>
    );
}

export default function Staff() {
    const { can, user } = useAuth();
    const queryClient = useQueryClient();
    const [creating, setCreating] = useState(false);

    const { data: staff = [], isLoading, error } = useQuery({
        queryKey: ['staff'],
        queryFn: () => api.get('/admin/staff').then((r) => r.data.data)
    });

    const toggleActive = useMutation({
        mutationFn: ({ id, isActive }) => api.patch(`/admin/staff/${id}`, { isActive }),
        onSuccess: () => queryClient.invalidateQueries({ queryKey: ['staff'] })
    });

    return (
        <div className="space-y-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                    <h1 className="text-2xl font-semibold">Staff & roles</h1>
                    <p className="text-sm text-slate-500">Admins and the operations / vendor users who fulfil orders.</p>
                </div>
                {can('staff', 'create') && !creating && (
                    <button type="button" className="btn-primary" onClick={() => setCreating(true)}>Add staff</button>
                )}
            </div>

            {creating && <CreateStaffForm onDone={() => setCreating(false)} />}
            {toggleActive.error && (
                <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">{errorMessage(toggleActive.error)}</p>
            )}

            <div className="card overflow-x-auto p-0">
                <table className="w-full text-sm">
                    <thead className="bg-slate-50 text-left text-slate-500">
                        <tr>
                            <th className="px-4 py-3 font-medium">Name</th>
                            <th className="px-4 py-3 font-medium">Email</th>
                            <th className="px-4 py-3 font-medium">Role</th>
                            <th className="px-4 py-3 font-medium">Modules</th>
                            <th className="px-4 py-3 font-medium">Status</th>
                            <th className="px-4 py-3" />
                        </tr>
                    </thead>
                    <tbody>
                        {isLoading && (
                            <tr><td colSpan={6} className="px-4 py-6 text-center text-slate-500">Loading…</td></tr>
                        )}
                        {error && (
                            <tr><td colSpan={6} className="px-4 py-6 text-center text-red-600">{errorMessage(error)}</td></tr>
                        )}
                        {staff.map((s) => (
                            <tr key={s.id} className="border-t border-slate-100">
                                <td className="px-4 py-3 font-medium">{s.name}</td>
                                <td className="px-4 py-3 text-slate-600">{s.email}</td>
                                <td className="px-4 py-3">
                                    {s.isSuperAdmin ? 'Super admin' : s.role === 'ops' ? 'Operations' : 'Admin'}
                                </td>
                                <td className="px-4 py-3 text-slate-600">{s.modules.join(', ') || '—'}</td>
                                <td className="px-4 py-3">
                                    <span className={`rounded-full px-2 py-0.5 text-xs ${s.isActive ? 'bg-brand-50 text-brand-700' : 'bg-slate-100 text-slate-500'}`}>
                                        {s.isActive ? 'Active' : 'Disabled'}
                                    </span>
                                </td>
                                <td className="px-4 py-3 text-right">
                                    {can('staff', 'update') && !s.isSuperAdmin && s.id !== user.id && (
                                        <button
                                            type="button"
                                            className="btn-ghost"
                                            disabled={toggleActive.isPending}
                                            onClick={() => toggleActive.mutate({ id: s.id, isActive: !s.isActive })}
                                        >
                                            {s.isActive ? 'Disable' : 'Enable'}
                                        </button>
                                    )}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
