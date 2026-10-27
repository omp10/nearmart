import { useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import { LogOut } from 'lucide-react';
import { useAuth } from '../auth/AuthProvider.jsx';
import { api, fieldErrors } from '../lib/api.js';
import { formatDateTime } from '../lib/format.js';
import { NOTIFICATIONS_KEY, notificationLink } from '../layout/NotificationBell.jsx';
import { DocumentsManager } from '../components/sellerForms.jsx';
import { ErrorNote, Field, Loading, PageHeader, Pager } from '../components/ui.jsx';

export function Notifications() {
    const { seller } = useAuth();
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const [page, setPage] = useState(1);
    const { data, isLoading, error } = useQuery({
        queryKey: [...NOTIFICATIONS_KEY, 'page', page],
        queryFn: () => api.get('/notifications', { params: { page, limit: 20 } }).then((r) => r.data.data),
        placeholderData: keepPreviousData,
        refetchInterval: 30_000
    });
    const refresh = () => queryClient.invalidateQueries({ queryKey: NOTIFICATIONS_KEY });
    const markAll = useMutation({ mutationFn: () => api.post('/notifications/read-all'), onSuccess: refresh });
    const markOne = useMutation({ mutationFn: (id) => api.post(`/notifications/${id}/read`), onSuccess: refresh });
    const pages = data ? Math.ceil(data.total / data.limit) : 0;

    const open = (n) => {
        if (!n.readAt) markOne.mutate(n._id);
        const to = notificationLink(n, seller);
        if (to) navigate(to);
    };

    return (
        <div className="space-y-5">
            <PageHeader
                title="Notifications"
                subtitle={data ? `${data.unread} unread` : undefined}
                actions={data?.unread > 0 && <button type="button" className="btn-outline" onClick={() => markAll.mutate()} disabled={markAll.isPending}>Mark all read</button>}
            />
            <ErrorNote error={error || markAll.error} />
            {isLoading && <Loading />}
            {data?.items.length === 0 && <div className="card py-10 text-center text-sm text-slate-500">No notifications yet.</div>}
            {data?.items.length > 0 && (
                <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
                    {data.items.map((n) => (
                        <li key={n._id}>
                            <button type="button" className={`flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-slate-50 ${n.readAt ? '' : 'bg-brand-50/50'}`} onClick={() => open(n)}>
                                <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${n.readAt ? 'bg-transparent' : 'bg-brand-600'}`} aria-label={n.readAt ? undefined : 'unread'} />
                                <span className="min-w-0 flex-1">
                                    <span className="block text-sm font-medium text-slate-900">{n.title}</span>
                                    {n.body && <span className="block text-sm text-slate-600">{n.body}</span>}
                                    <span className="block text-xs text-slate-400">{formatDateTime(n.createdAt)}</span>
                                </span>
                            </button>
                        </li>
                    ))}
                </ul>
            )}
            <Pager page={page} pages={pages} onChange={setPage} />
        </div>
    );
}

export function Documents() {
    const { seller } = useAuth();
    return (
        <div className="space-y-5">
            <PageHeader title="Documents" subtitle="Your licences and ID proofs. Only you and Nearmart can see them." />
            <section className="card">
                <DocumentsManager seller={seller} canRemove={false} />
                <p className="mt-3 text-xs text-slate-500">Documents checked during approval can't be removed. Upload a new one if something has changed, and let Nearmart know.</p>
            </section>
        </div>
    );
}

export function Account() {
    const { seller, logout, endSession } = useAuth();
    const navigate = useNavigate();
    const [form, setForm] = useState({ currentPassword: '', newPassword: '', confirm: '' });
    const [localError, setLocalError] = useState('');
    const change = useMutation({
        mutationFn: () => api.post('/auth/seller/change-password', { currentPassword: form.currentPassword, newPassword: form.newPassword }),
        onSuccess: (res) => {
            // The API ends every session after a password change.
            endSession();
            navigate('/login', { replace: true, state: { notice: res.data.message || 'Password changed. Please sign in again.' } });
        }
    });
    const errors = fieldErrors(change.error);

    const onSubmit = (e) => {
        e.preventDefault();
        setLocalError('');
        if (form.newPassword !== form.confirm) return setLocalError('The two new passwords do not match.');
        return change.mutate();
    };

    return (
        <div className="space-y-6">
            <PageHeader title="Password & sign out" />
            <section className="card space-y-1 text-sm">
                <h2 className="mb-2 text-base font-semibold">Your account</h2>
                <p><span className="text-slate-500">Name: </span>{seller.ownerName}</p>
                <p><span className="text-slate-500">Mobile: </span>{seller.phone}</p>
                <p><span className="text-slate-500">Email: </span>{seller.email}</p>
                <p className="pt-1 text-xs text-slate-500">To change your mobile number or email, contact Nearmart support.</p>
            </section>

            <section className="card">
                <h2 className="mb-1 text-base font-semibold">Change password</h2>
                <p className="mb-4 text-sm text-slate-500">You'll be signed out on every device and asked to sign in again.</p>
                <form onSubmit={onSubmit} className="max-w-md space-y-4">
                    <ErrorNote error={localError || change.error} />
                    <Field label="Current password" htmlFor="cp-current" errors={errors} path="currentPassword">
                        <input id="cp-current" type="password" className="input" autoComplete="current-password" value={form.currentPassword} onChange={(e) => setForm({ ...form, currentPassword: e.target.value })} required />
                    </Field>
                    <Field label="New password" htmlFor="cp-new" errors={errors} path="newPassword" hint="At least 10 characters">
                        <input id="cp-new" type="password" className="input" autoComplete="new-password" minLength={10} maxLength={200} value={form.newPassword} onChange={(e) => setForm({ ...form, newPassword: e.target.value })} required />
                    </Field>
                    <Field label="New password again" htmlFor="cp-confirm">
                        <input id="cp-confirm" type="password" className="input" autoComplete="new-password" minLength={10} maxLength={200} value={form.confirm} onChange={(e) => setForm({ ...form, confirm: e.target.value })} required />
                    </Field>
                    <button type="submit" className="btn-primary" disabled={change.isPending}>{change.isPending ? 'Saving…' : 'Change password'}</button>
                </form>
            </section>

            <section className="card flex flex-wrap items-center justify-between gap-3">
                <div>
                    <h2 className="text-base font-semibold">Sign out</h2>
                    <p className="text-sm text-slate-500">Sign out of the seller dashboard on this device.</p>
                </div>
                <button type="button" className="btn-outline text-red-600" onClick={logout}>
                    <LogOut className="h-4 w-4" aria-hidden="true" />
                    Sign out
                </button>
            </section>
        </div>
    );
}
