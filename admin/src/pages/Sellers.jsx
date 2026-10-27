import { useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { useAuth } from '../auth/AuthProvider.jsx';
import { api, errorMessage } from '../lib/api.js';
import { formatPaise, paiseToRupees, rupeesToPaise } from '../lib/money.js';
import { ago, mapsUrl } from '../lib/riders.js';
import {
    DOCUMENT_LABELS, MODULE_REQUEST_LABELS, MODULE_REQUEST_TONES, SELLER_MODULES, SELLER_STATUS_LABELS, SELLER_STATUS_TONES, commissionText
} from '../lib/sellers.js';
import { BUSINESS_MODULES } from '../nav.js';
import { Badge, ErrorNote, Modal, Pager, useDebounced } from '../components/ui.jsx';

const when = (d) => (d ? new Date(d).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');
const MODULE_LABELS = Object.fromEntries(BUSINESS_MODULES.map((m) => [m.id, m.label]));
const moduleLabel = (key) => MODULE_LABELS[key] ?? key;
const commission = (c) => commissionText(c, formatPaise);

const TABS = [
    ['submitted', 'Pending review'],
    ['approved', 'Approved'],
    ['rejected', 'Rejected'],
    ['suspended', 'Suspended'],
    ['draft', 'Draft'],
    ['all', 'All']
];

function useSellerConfig() {
    return useQuery({
        queryKey: ['seller-config'],
        queryFn: () => api.get('/admin/sellers/config').then((r) => r.data.data),
        staleTime: 5 * 60_000
    });
}

/** Form text for a commission override: blank = the module default (null). */
const overrideToForm = (c) => ({ percent: c?.percent == null ? '' : String(c.percent), fee: paiseToRupees(c?.fixedFeePaise) });
const formToOverride = (form) => ({
    percent: form.percent === '' ? null : Number(form.percent),
    fixedFeePaise: rupeesToPaise(form.fee)
});
const overrideInvalid = (o) => Number.isNaN(o.percent) || Number.isNaN(o.fixedFeePaise) || (o.percent != null && (o.percent < 0 || o.percent > 100));

/** Percent and fixed-fee inputs for a seller's own rate; blank fields fall back to the module default. */
function OverrideFields({ form, onChange, idPrefix }) {
    return (
        <div className="grid gap-4 sm:grid-cols-2">
            <div>
                <label className="label" htmlFor={`${idPrefix}-percent`}>Commission (%)</label>
                <input
                    id={`${idPrefix}-percent`}
                    className="input"
                    type="number"
                    min="0"
                    max="100"
                    step="0.01"
                    placeholder="Module default"
                    value={form.percent}
                    onChange={(e) => onChange({ ...form, percent: e.target.value })}
                />
            </div>
            <div>
                <label className="label" htmlFor={`${idPrefix}-fee`}>Fixed fee per order (₹)</label>
                <input
                    id={`${idPrefix}-fee`}
                    className="input"
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder="Module default"
                    value={form.fee}
                    onChange={(e) => onChange({ ...form, fee: e.target.value })}
                />
            </div>
        </div>
    );
}

function DefaultsHint({ config, modules = SELLER_MODULES }) {
    if (!config) return null;
    return (
        <p className="text-xs text-slate-500">
            Leave blank to use the shop default: {modules.map((m) => `${moduleLabel(m)} ${commission(config.commission[m])}`).join(' · ')}.
        </p>
    );
}

/** Default commission per shop and the payout hold period. */
function CommissionSettingsForm({ onDone }) {
    const queryClient = useQueryClient();
    const { data: config, isLoading, error } = useSellerConfig();
    const [form, setForm] = useState(null);
    const values =
        form ??
        (config && {
            hold: String(config.payoutHoldDays),
            ...Object.fromEntries(SELLER_MODULES.map((m) => [m, { percent: String(config.commission[m]?.percent ?? 0), fee: paiseToRupees(config.commission[m]?.fixedFeePaise ?? 0) }]))
        });
    const set = (patch) => setForm({ ...values, ...patch });

    const save = useMutation({
        mutationFn: (body) => api.put('/admin/sellers/config', body),
        onSuccess: (res) => {
            queryClient.setQueryData(['seller-config'], res.data.data);
            queryClient.invalidateQueries({ queryKey: ['seller'] });
            onDone();
        }
    });

    if (isLoading) return <p className="text-sm text-slate-500">Loading…</p>;
    if (error) return <ErrorNote error={error} />;

    const body = {
        commission: Object.fromEntries(SELLER_MODULES.map((m) => [m, { percent: Number(values[m].percent), fixedFeePaise: rupeesToPaise(values[m].fee) ?? 0 }])),
        payoutHoldDays: Number(values.hold)
    };
    const invalid = Object.values(body.commission).some((c) => Number.isNaN(c.percent) || Number.isNaN(c.fixedFeePaise)) || !Number.isInteger(body.payoutHoldDays);

    return (
        <form
            className="space-y-4"
            onSubmit={(e) => {
                e.preventDefault();
                save.mutate(body);
            }}
        >
            <ErrorNote error={save.error} />
            <p className="text-sm text-slate-600">
                What Nearmart keeps from each seller order, per shop. A seller with their own rate uses that instead. Rates are fixed on each order when it is placed.
            </p>
            <div className="space-y-3">
                {SELLER_MODULES.map((m) => (
                    <fieldset key={m} className="grid items-end gap-3 sm:grid-cols-[10rem_1fr_1fr]">
                        <legend className="sr-only">{moduleLabel(m)}</legend>
                        <span className="pb-2 text-sm font-medium">{moduleLabel(m)}</span>
                        <div>
                            <label className="label" htmlFor={`cfg-${m}-percent`}>Commission (%)</label>
                            <input
                                id={`cfg-${m}-percent`}
                                className="input"
                                type="number"
                                min="0"
                                max="100"
                                step="0.01"
                                value={values[m].percent}
                                onChange={(e) => set({ [m]: { ...values[m], percent: e.target.value } })}
                                required
                            />
                        </div>
                        <div>
                            <label className="label" htmlFor={`cfg-${m}-fee`}>Fixed fee per order (₹)</label>
                            <input
                                id={`cfg-${m}-fee`}
                                className="input"
                                type="number"
                                min="0"
                                step="0.01"
                                value={values[m].fee}
                                onChange={(e) => set({ [m]: { ...values[m], fee: e.target.value } })}
                            />
                        </div>
                    </fieldset>
                ))}
            </div>
            <div className="sm:w-60">
                <label className="label" htmlFor="cfg-hold">Payout hold (days after delivery)</label>
                <input id="cfg-hold" className="input" type="number" min="0" max="60" step="1" value={values.hold} onChange={(e) => set({ hold: e.target.value })} required />
                <p className="mt-1 text-xs text-slate-500">Time for returns and complaints before an order can be paid out.</p>
            </div>
            <div className="flex justify-end gap-2">
                <button type="button" className="btn-ghost" onClick={onDone}>Cancel</button>
                <button type="submit" className="btn-primary" disabled={save.isPending || invalid}>{save.isPending ? 'Saving…' : 'Save settings'}</button>
            </div>
        </form>
    );
}

function ShopBadges({ modules }) {
    if (!modules?.length) return <span className="text-slate-400">—</span>;
    return (
        <span className="flex flex-wrap gap-1">
            {modules.map((m) => (
                <Badge key={m.key} tone={MODULE_REQUEST_TONES[m.status]}>
                    {moduleLabel(m.key)}
                    {m.status !== 'approved' && ` · ${MODULE_REQUEST_LABELS[m.status]?.toLowerCase()}`}
                </Badge>
            ))}
        </span>
    );
}

export function Sellers() {
    const { can } = useAuth();
    const navigate = useNavigate();
    const [searchParams, setSearchParams] = useSearchParams();
    const tab = TABS.some(([t]) => t === searchParams.get('status')) ? searchParams.get('status') : 'submitted';
    const [q, setQ] = useState('');
    const [page, setPage] = useState(1);
    const [settings, setSettings] = useState(false);
    const search = useDebounced(q);

    const params = { page, limit: 25, ...(tab !== 'all' ? { status: tab } : {}), ...(search ? { q: search } : {}) };
    const { data, isLoading, error } = useQuery({
        queryKey: ['sellers', params],
        queryFn: () => api.get('/admin/sellers', { params }).then((r) => r.data.data),
        placeholderData: keepPreviousData,
        refetchInterval: 60_000
    });
    const counts = data?.counts ?? {};
    const countOf = (t) => (t === 'all' ? Object.keys(SELLER_STATUS_LABELS).reduce((sum, s) => sum + (counts[s] ?? 0), 0) : counts[t] ?? 0);

    return (
        <div className="space-y-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                    <h1 className="text-2xl font-semibold">Sellers</h1>
                    <p className="text-sm text-slate-500">Shops that sell on Nearmart: review applications, approve the shops they sell in, and set their commission.</p>
                </div>
                {can('sellers', 'update') && <button type="button" className="btn-ghost border border-slate-200" onClick={() => setSettings(true)}>Commission settings</button>}
            </div>

            <div className="flex flex-wrap items-center gap-3">
                <div className="flex flex-wrap gap-1 rounded-lg bg-slate-100 p-1" role="tablist" aria-label="Seller status">
                    {TABS.map(([value, label]) => (
                        <button
                            key={value}
                            type="button"
                            role="tab"
                            aria-selected={tab === value}
                            onClick={() => {
                                setSearchParams(value === 'submitted' ? {} : { status: value }, { replace: true });
                                setPage(1);
                            }}
                            className={`rounded-md px-3 py-1.5 text-sm font-medium ${tab === value ? 'bg-white shadow-sm' : 'text-slate-600'}`}
                        >
                            {label}
                            {data && <span className="ml-1.5 tabular-nums text-slate-400">{countOf(value)}</span>}
                        </button>
                    ))}
                </div>
                {counts.moduleRequests > 0 && (
                    <button
                        type="button"
                        className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-sm text-amber-700"
                        onClick={() => {
                            setSearchParams({ status: 'approved' }, { replace: true });
                            setPage(1);
                        }}
                        title="Approved sellers asking to sell in another shop"
                    >
                        Shop requests <span className="font-semibold tabular-nums">{counts.moduleRequests}</span>
                    </button>
                )}
            </div>

            <input
                className="input"
                placeholder="Business, owner, phone or email"
                aria-label="Search sellers"
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
                            <th className="px-4 py-3 font-medium">Business</th>
                            <th className="px-4 py-3 font-medium">City</th>
                            <th className="px-4 py-3 font-medium">Shops</th>
                            <th className="px-4 py-3 font-medium">Commission</th>
                            <th className="px-4 py-3 font-medium">Submitted</th>
                            <th className="px-4 py-3 font-medium">Status</th>
                        </tr>
                    </thead>
                    <tbody>
                        {isLoading && <tr><td colSpan={6} className="px-4 py-6 text-center text-slate-500">Loading…</td></tr>}
                        {data?.items.length === 0 && <tr><td colSpan={6} className="px-4 py-6 text-center text-slate-500">No sellers here.</td></tr>}
                        {data?.items.map((s) => (
                            <tr key={s._id} className="cursor-pointer border-t border-slate-100 hover:bg-slate-50" onClick={() => navigate(`/sellers/${s._id}`)}>
                                <td className="px-4 py-3">
                                    <span className="flex items-center gap-3">
                                        {s.store?.logo ? <img src={s.store.logo} alt="" className="h-9 w-9 rounded object-cover" /> : <span className="h-9 w-9 shrink-0 rounded bg-slate-100" />}
                                        <span>
                                            <Link to={`/sellers/${s._id}`} className="font-medium text-brand-700 hover:underline" onClick={(e) => e.stopPropagation()}>{s.businessName}</Link>
                                            <span className="block text-xs text-slate-500">{s.ownerName} · {s.phone}</span>
                                        </span>
                                    </span>
                                </td>
                                <td className="px-4 py-3 text-slate-600">{s.address?.city || '—'}</td>
                                <td className="px-4 py-3"><ShopBadges modules={s.modules} /></td>
                                <td className="px-4 py-3 text-slate-600">
                                    {s.commission?.percent != null || s.commission?.fixedFeePaise != null ? commission(s.commission) : <span className="text-slate-400">Default</span>}
                                </td>
                                <td className="whitespace-nowrap px-4 py-3 text-slate-600" title={when(s.submittedAt)}>{s.submittedAt ? ago(s.submittedAt) : '—'}</td>
                                <td className="px-4 py-3">
                                    <Badge tone={SELLER_STATUS_TONES[s.status]}>{SELLER_STATUS_LABELS[s.status] ?? s.status}</Badge>
                                    {!s.isActive && <span className="ml-1"><Badge tone="red">Login off</Badge></span>}
                                    {s.status === 'approved' && !s.isOpen && <span className="ml-1"><Badge>Closed</Badge></span>}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
            <Pager page={page} pages={data?.pages} onChange={setPage} />

            <Modal open={settings} title="Commission settings" onClose={() => setSettings(false)} wide>
                {settings && <CommissionSettingsForm onDone={() => setSettings(false)} />}
            </Modal>
        </div>
    );
}

// ─── Detail ───

function Field({ label, value }) {
    return (
        <div>
            <dt className="text-xs text-slate-500">{label}</dt>
            <dd className="break-words">{value || <span className="text-slate-400">—</span>}</dd>
        </div>
    );
}

/** Reads an API error whose body came back as a Blob (responseType 'blob'). */
const blobErrorMessage = async (err) => {
    const body = err?.response?.data;
    if (body instanceof Blob) {
        try {
            return JSON.parse(await body.text()).message || errorMessage(err);
        } catch {
            return errorMessage(err);
        }
    }
    return errorMessage(err);
};

/** KYC files are private: fetched with the staff token, then opened from an object URL. */
function Documents({ seller }) {
    const [busy, setBusy] = useState(null);
    const [error, setError] = useState('');

    const open = async (doc) => {
        // Open the tab now, while the click still counts as a user action, so it isn't blocked.
        const win = window.open('', '_blank');
        setBusy(doc._id);
        setError('');
        try {
            const res = await api.get(`/admin/sellers/${seller._id}/documents/${doc._id}`, { responseType: 'blob' });
            const url = URL.createObjectURL(res.data);
            if (win) win.location.href = url;
            else window.open(url, '_blank');
            setTimeout(() => URL.revokeObjectURL(url), 60_000);
        } catch (err) {
            win?.close();
            setError(await blobErrorMessage(err));
        } finally {
            setBusy(null);
        }
    };

    return (
        <section className="card text-sm">
            <h2 className="mb-2 font-semibold">Documents</h2>
            <ErrorNote error={error} />
            {!seller.documents?.length && <p className="text-slate-500">No documents uploaded.</p>}
            <ul className="divide-y divide-slate-100">
                {seller.documents?.map((d) => (
                    <li key={d._id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                        <span>
                            <span className="font-medium">{DOCUMENT_LABELS[d.type] ?? d.type}</span>
                            <span className="block text-xs text-slate-500">{d.name || d.mimeType} · uploaded {when(d.uploadedAt)}</span>
                        </span>
                        <button type="button" className="btn-ghost px-2 py-1" disabled={busy === d._id} onClick={() => open(d)}>
                            {busy === d._id ? 'Opening…' : 'Open'}
                        </button>
                    </li>
                ))}
            </ul>
        </section>
    );
}

/** Approves the application: which waiting shops, an optional own rate and a note. */
function ApproveForm({ seller, config, onDone }) {
    const queryClient = useQueryClient();
    const pending = seller.modules.filter((m) => m.status === 'pending');
    const [modules, setModules] = useState(pending.map((m) => m.key));
    const [rate, setRate] = useState(overrideToForm(seller.commission));
    const [note, setNote] = useState('');
    const toggle = (key) => setModules((list) => (list.includes(key) ? list.filter((k) => k !== key) : [...list, key]));

    const approve = useMutation({
        mutationFn: (body) => api.post(`/admin/sellers/${seller._id}/approve`, body),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['seller', seller._id] });
            queryClient.invalidateQueries({ queryKey: ['sellers'] });
            onDone();
        }
    });
    const override = formToOverride(rate);
    const approvedAlready = seller.modules.some((m) => m.status === 'approved');

    return (
        <form
            className="space-y-4"
            onSubmit={(e) => {
                e.preventDefault();
                approve.mutate({ modules, commissionPercent: override.percent, fixedFeePaise: override.fixedFeePaise, ...(note.trim() ? { note: note.trim() } : {}) });
            }}
        >
            <ErrorNote error={approve.error} />
            <fieldset>
                <legend className="label">Shops to approve</legend>
                {pending.length ? (
                    <div className="space-y-2">
                        {pending.map((m) => (
                            <label key={m.key} className="flex items-start gap-2 text-sm">
                                <input type="checkbox" className="mt-1" checked={modules.includes(m.key)} onChange={() => toggle(m.key)} />
                                <span>
                                    {moduleLabel(m.key)}
                                    <span className="block text-xs text-slate-500">{m.categories?.length ? m.categories.map((c) => c.name).join(', ') : 'Any category'}</span>
                                </span>
                            </label>
                        ))}
                        <p className="text-xs text-slate-500">Shops left unticked stay waiting; you can decide them later.</p>
                    </div>
                ) : (
                    <p className="text-sm text-slate-500">No shops are waiting. {approvedAlready ? 'Their approved shops stay as they are.' : ''}</p>
                )}
            </fieldset>
            <div className="space-y-2">
                <p className="label">Own commission (optional)</p>
                <OverrideFields form={rate} onChange={setRate} idPrefix="approve" />
                <DefaultsHint config={config} modules={seller.modules.map((m) => m.key)} />
            </div>
            <div>
                <label className="label" htmlFor="approve-note">Note (optional)</label>
                <input id="approve-note" className="input" value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} />
            </div>
            <div className="flex justify-end gap-2">
                <button type="button" className="btn-ghost" onClick={onDone}>Cancel</button>
                <button type="submit" className="btn-primary" disabled={approve.isPending || overrideInvalid(override) || (!modules.length && !approvedAlready)}>
                    {approve.isPending ? 'Approving…' : 'Approve seller'}
                </button>
            </div>
        </form>
    );
}

/** Reject (send back) or suspend, both with a reason the seller sees. */
function ReasonForm({ seller, action, onDone }) {
    const queryClient = useQueryClient();
    const [reason, setReason] = useState('');
    const run = useMutation({
        mutationFn: () => api.post(`/admin/sellers/${seller._id}/${action}`, { reason: reason.trim() }),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['seller', seller._id] });
            queryClient.invalidateQueries({ queryKey: ['sellers'] });
            onDone();
        }
    });
    const reject = action === 'reject';

    return (
        <form
            className="space-y-4"
            onSubmit={(e) => {
                e.preventDefault();
                run.mutate();
            }}
        >
            <ErrorNote error={run.error} />
            <p className="text-sm text-slate-600">
                {reject
                    ? 'The application goes back to the seller, who can fix it and send it again.'
                    : 'Their products are hidden and they stop receiving orders until you approve them again.'}
            </p>
            <div>
                <label className="label" htmlFor="seller-reason">Reason (shown to the seller)</label>
                <textarea id="seller-reason" className="input min-h-24" value={reason} onChange={(e) => setReason(e.target.value)} required minLength={3} maxLength={500} />
            </div>
            <div className="flex justify-end gap-2">
                <button type="button" className="btn-ghost" onClick={onDone}>Back</button>
                <button type="submit" className="btn bg-red-600 text-white hover:bg-red-700" disabled={run.isPending || reason.trim().length < 3}>
                    {run.isPending ? 'Saving…' : reject ? 'Reject application' : 'Suspend seller'}
                </button>
            </div>
        </form>
    );
}

/** Approve or reject one shop request, with an optional note. */
function ModuleDecisionForm({ seller, decision, onDone }) {
    const queryClient = useQueryClient();
    const [note, setNote] = useState('');
    const decide = useMutation({
        mutationFn: () => api.post(`/admin/sellers/${seller._id}/modules/${decision.key}`, { decision: decision.decision, ...(note.trim() ? { note: note.trim() } : {}) }),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['seller', seller._id] });
            queryClient.invalidateQueries({ queryKey: ['sellers'] });
            onDone();
        }
    });
    const approve = decision.decision === 'approved';

    return (
        <form
            className="space-y-4"
            onSubmit={(e) => {
                e.preventDefault();
                decide.mutate();
            }}
        >
            <ErrorNote error={decide.error} />
            <p className="text-sm text-slate-600">
                {approve
                    ? `${seller.businessName} can list products in ${moduleLabel(decision.key)} straight away.`
                    : `${seller.businessName} can't sell in ${moduleLabel(decision.key)}; their products there are hidden. They can ask again later.`}
            </p>
            <div>
                <label className="label" htmlFor="module-note">Note to the seller (optional)</label>
                <input id="module-note" className="input" value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} />
            </div>
            <div className="flex justify-end gap-2">
                <button type="button" className="btn-ghost" onClick={onDone}>Back</button>
                <button type="submit" className={approve ? 'btn-primary' : 'btn bg-red-600 text-white hover:bg-red-700'} disabled={decide.isPending}>
                    {decide.isPending ? 'Saving…' : approve ? 'Approve shop' : 'Reject shop'}
                </button>
            </div>
        </form>
    );
}

function CommissionForm({ seller, config, onDone }) {
    const queryClient = useQueryClient();
    const [rate, setRate] = useState(overrideToForm(seller.commission));
    const save = useMutation({
        mutationFn: (body) => api.patch(`/admin/sellers/${seller._id}`, body),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['seller', seller._id] });
            queryClient.invalidateQueries({ queryKey: ['sellers'] });
            onDone();
        }
    });
    const override = formToOverride(rate);

    return (
        <form
            className="space-y-4"
            onSubmit={(e) => {
                e.preventDefault();
                save.mutate({ commission: override });
            }}
        >
            <ErrorNote error={save.error} />
            <OverrideFields form={rate} onChange={setRate} idPrefix="commission" />
            <DefaultsHint config={config} modules={seller.modules.length ? seller.modules.map((m) => m.key) : SELLER_MODULES} />
            <p className="text-xs text-slate-500">Applies to new orders; orders already placed keep the rate they were placed with.</p>
            <div className="flex justify-end gap-2">
                <button type="button" className="btn-ghost" onClick={onDone}>Cancel</button>
                <button type="submit" className="btn-primary" disabled={save.isPending || overrideInvalid(override)}>{save.isPending ? 'Saving…' : 'Save commission'}</button>
            </div>
        </form>
    );
}

export function SellerDetail() {
    const { id } = useParams();
    const { can } = useAuth();
    const queryClient = useQueryClient();
    const [dialog, setDialog] = useState(null); // 'approve' | 'reject' | 'suspend' | 'commission' | { key, decision }
    const key = ['seller', id];

    const { data: seller, isLoading, error } = useQuery({
        queryKey: key,
        queryFn: () => api.get(`/admin/sellers/${id}`).then((r) => r.data.data)
    });
    const { data: config } = useSellerConfig();
    const toggleActive = useMutation({
        mutationFn: (isActive) => api.patch(`/admin/sellers/${id}`, { isActive }),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: key });
            queryClient.invalidateQueries({ queryKey: ['sellers'] });
        }
    });

    if (isLoading) return <p className="text-sm text-slate-500">Loading…</p>;
    if (error) return <ErrorNote error={error} />;

    const canUpdate = can('sellers', 'update');
    const close = () => setDialog(null);
    const a = seller.address ?? {};
    const hasLocation = a.lat != null && a.lng != null;
    const hasOverride = seller.commission?.percent != null || seller.commission?.fixedFeePaise != null;
    const decidesShops = ['approved', 'suspended'].includes(seller.status);
    const dialogTitle =
        dialog === 'approve' ? `Approve ${seller.businessName}`
            : dialog === 'reject' ? 'Reject application'
                : dialog === 'suspend' ? `Suspend ${seller.businessName}`
                    : dialog === 'commission' ? 'Seller commission'
                        : dialog ? `${dialog.decision === 'approved' ? 'Approve' : 'Reject'} ${moduleLabel(dialog.key)}` : '';

    return (
        <div className="space-y-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                    <Link to="/sellers" className="text-sm text-slate-500 hover:underline">← Sellers</Link>
                    <h1 className="flex flex-wrap items-center gap-3 text-2xl font-semibold">
                        {seller.businessName}
                        <Badge tone={SELLER_STATUS_TONES[seller.status]}>{SELLER_STATUS_LABELS[seller.status] ?? seller.status}</Badge>
                        {!seller.isActive && <Badge tone="red">Login off</Badge>}
                        {seller.status === 'approved' && !seller.isOpen && <Badge>Store closed</Badge>}
                    </h1>
                    <p className="text-sm text-slate-500">
                        {seller.ownerName} · <a href={`tel:${seller.phone}`} className="hover:underline">{seller.phone}</a> ·{' '}
                        <a href={`mailto:${seller.email}`} className="hover:underline">{seller.email}</a> · joined {when(seller.createdAt)}
                    </p>
                </div>
                {canUpdate && (
                    <div className="flex flex-wrap gap-2">
                        <button
                            type="button"
                            className={`btn-ghost ${seller.isActive ? 'text-red-600' : ''}`}
                            disabled={toggleActive.isPending}
                            onClick={() =>
                                (!seller.isActive || window.confirm(`Switch off login for ${seller.businessName}? They are signed out of the seller dashboard and their products are hidden.`)) &&
                                toggleActive.mutate(!seller.isActive)
                            }
                        >
                            {seller.isActive ? 'Switch login off' : 'Switch login on'}
                        </button>
                        {seller.status === 'approved' && <button type="button" className="btn-ghost text-red-600" onClick={() => setDialog('suspend')}>Suspend</button>}
                        {seller.status === 'submitted' && <button type="button" className="btn-ghost text-red-600" onClick={() => setDialog('reject')}>Reject</button>}
                        {['submitted', 'rejected', 'suspended'].includes(seller.status) && (
                            <button type="button" className="btn-primary" onClick={() => setDialog('approve')}>{seller.status === 'suspended' ? 'Approve again' : 'Approve'}</button>
                        )}
                    </div>
                )}
            </div>

            <ErrorNote error={toggleActive.error} />
            {seller.rejectionReason && ['rejected', 'suspended'].includes(seller.status) && (
                <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
                    {seller.status === 'rejected' ? 'Returned to the seller' : 'Suspended'}: {seller.rejectionReason}
                </p>
            )}
            {seller.status === 'draft' && (
                <p className="rounded-lg bg-slate-100 px-3 py-2 text-sm">The seller hasn't sent this application yet. It can be reviewed once they submit it.</p>
            )}

            <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
                <div className="space-y-6">
                    <section className="card text-sm">
                        <h2 className="mb-3 font-semibold">Shops</h2>
                        {!seller.modules?.length && <p className="text-slate-500">No shops requested.</p>}
                        <ul className="divide-y divide-slate-100">
                            {seller.modules?.map((m) => (
                                <li key={m.key} className="flex flex-wrap items-start justify-between gap-3 py-3">
                                    <div>
                                        <p className="flex items-center gap-2 font-medium">
                                            {moduleLabel(m.key)}
                                            <Badge tone={MODULE_REQUEST_TONES[m.status]}>{MODULE_REQUEST_LABELS[m.status] ?? m.status}</Badge>
                                        </p>
                                        <p className="text-slate-600">{m.categories?.length ? m.categories.map((c) => c.name).join(', ') : 'Any category'}</p>
                                        <p className="text-xs text-slate-500">
                                            Asked {when(m.requestedAt)}
                                            {m.decidedAt && ` · decided ${when(m.decidedAt)}`}
                                            {seller.effectiveCommission?.[m.key] && ` · commission ${commission(seller.effectiveCommission[m.key])}`}
                                        </p>
                                        {m.note && <p className="text-xs text-slate-600">Note: {m.note}</p>}
                                    </div>
                                    {canUpdate && decidesShops && m.status === 'pending' && (
                                        <div className="flex gap-2">
                                            <button type="button" className="btn-ghost px-2 py-1 text-red-600" onClick={() => setDialog({ key: m.key, decision: 'rejected' })}>Reject</button>
                                            <button type="button" className="btn-primary px-3 py-1" onClick={() => setDialog({ key: m.key, decision: 'approved' })}>Approve</button>
                                        </div>
                                    )}
                                    {canUpdate && decidesShops && m.status === 'approved' && (
                                        <button type="button" className="btn-ghost px-2 py-1 text-red-600" onClick={() => setDialog({ key: m.key, decision: 'rejected' })}>Remove</button>
                                    )}
                                    {canUpdate && decidesShops && m.status === 'rejected' && (
                                        <button type="button" className="btn-ghost px-2 py-1" onClick={() => setDialog({ key: m.key, decision: 'approved' })}>Approve</button>
                                    )}
                                </li>
                            ))}
                        </ul>
                    </section>

                    <section className="card text-sm">
                        <h2 className="mb-3 font-semibold">Store</h2>
                        <div className="flex gap-4">
                            {seller.store?.logo && <img src={seller.store.logo} alt="Logo" className="h-16 w-16 rounded object-cover" />}
                            <dl className="grid flex-1 gap-3 sm:grid-cols-2">
                                <Field label="Timings" value={seller.store?.timings} />
                                <Field label="Support phone" value={seller.store?.supportPhone} />
                                <div className="sm:col-span-2"><Field label="Description" value={seller.store?.description} /></div>
                            </dl>
                        </div>
                        {seller.store?.cover && <img src={seller.store.cover} alt="Cover" className="mt-3 aspect-[3/1] w-full rounded object-cover" />}
                    </section>

                    <section className="card text-sm">
                        <h2 className="mb-3 font-semibold">Address</h2>
                        <p>
                            {[a.line1, a.line2].filter(Boolean).join(', ') || <span className="text-slate-400">No address yet</span>}
                            {a.landmark && ` (near ${a.landmark})`}
                        </p>
                        <p className="text-slate-600">{[a.city, a.state, a.pincode].filter(Boolean).join(', ')}</p>
                        {hasLocation ? (
                            <p className="pt-2">
                                <a href={mapsUrl(a)} target="_blank" rel="noreferrer" className="font-medium text-brand-700 hover:underline">Open in Google Maps</a>
                                <span className="ml-2 text-xs text-slate-500 tabular-nums">{a.lat}, {a.lng}</span>
                            </p>
                        ) : (
                            <p className="pt-2 text-amber-700">No map location pinned; riders need one to find the shop.</p>
                        )}
                    </section>

                    <div className="grid gap-6 md:grid-cols-2">
                        <section className="card text-sm">
                            <h2 className="mb-3 font-semibold">Legal</h2>
                            <dl className="space-y-2">
                                <Field label="PAN" value={seller.legal?.pan} />
                                <Field label="GSTIN" value={seller.legal?.gstin} />
                                <Field label="FSSAI licence" value={seller.legal?.fssai} />
                            </dl>
                        </section>
                        <section className="card text-sm">
                            <h2 className="mb-3 font-semibold">Bank details</h2>
                            <dl className="space-y-2">
                                <Field label="Account name" value={seller.bank?.accountName} />
                                <Field label="Account number" value={seller.bank?.accountNumber} />
                                <Field label="IFSC" value={seller.bank?.ifsc} />
                                <Field label="UPI ID" value={seller.bank?.upiId} />
                            </dl>
                        </section>
                    </div>

                    <Documents seller={seller} />
                </div>

                <div className="space-y-6">
                    <section className="card space-y-1 text-sm">
                        <div className="mb-2 flex items-center justify-between">
                            <h2 className="font-semibold">Commission</h2>
                            {canUpdate && <button type="button" className="btn-ghost px-2 py-1" onClick={() => setDialog('commission')}>Edit</button>}
                        </div>
                        <p>{hasOverride ? `Own rate: ${commission(seller.commission)}` : 'Shop defaults'}</p>
                        {hasOverride && (seller.commission?.percent == null || seller.commission?.fixedFeePaise == null) && (
                            <p className="text-xs text-slate-500">Blank parts use the shop default.</p>
                        )}
                        {Object.entries(seller.effectiveCommission ?? {}).map(([m, c]) => (
                            <p key={m} className="text-slate-600"><span className="text-slate-500">{moduleLabel(m)}: </span>{commission(c)}</p>
                        ))}
                        {can('payouts') && seller.status !== 'draft' && (
                            <Link to="/payouts" className="block pt-2 text-brand-700 hover:underline">Balances and payouts →</Link>
                        )}
                    </section>

                    <section className="card space-y-1 text-sm">
                        <h2 className="mb-2 font-semibold">Account</h2>
                        <p><span className="text-slate-500">Products: </span>{seller.productCount ?? 0}</p>
                        <p><span className="text-slate-500">Delivers to: </span>{seller.zones?.length ? seller.zones.map((z) => z.name).join(', ') : 'Everywhere Nearmart delivers'}</p>
                        <p><span className="text-slate-500">Last sign-in: </span>{seller.lastLoginAt ? ago(seller.lastLoginAt) : 'Never'}</p>
                        <p><span className="text-slate-500">Submitted: </span>{when(seller.submittedAt)}</p>
                        <p><span className="text-slate-500">Reviewed: </span>{when(seller.reviewedAt)}</p>
                    </section>

                    <section className="card text-sm">
                        <h2 className="mb-2 font-semibold">History</h2>
                        {!seller.statusHistory?.length && <p className="text-slate-500">Nothing yet.</p>}
                        <ol className="space-y-2">
                            {[...(seller.statusHistory ?? [])].reverse().map((h, i) => (
                                <li key={i} className="border-l-2 border-slate-200 pl-3">
                                    <span className="font-medium">{SELLER_STATUS_LABELS[h.status] ?? h.status}</span>
                                    <span className="block text-xs text-slate-500">{when(h.at)} · {h.by?.kind === 'staff' ? 'Nearmart' : h.by?.kind ?? '—'}</span>
                                    {h.note && <span className="block text-xs text-slate-600">{h.note}</span>}
                                </li>
                            ))}
                        </ol>
                    </section>
                </div>
            </div>

            <Modal open={Boolean(dialog)} title={dialogTitle} onClose={close} wide={dialog === 'approve'}>
                {dialog === 'approve' && <ApproveForm seller={seller} config={config} onDone={close} />}
                {(dialog === 'reject' || dialog === 'suspend') && <ReasonForm seller={seller} action={dialog} onDone={close} />}
                {dialog === 'commission' && <CommissionForm seller={seller} config={config} onDone={close} />}
                {dialog?.key && <ModuleDecisionForm seller={seller} decision={dialog} onDone={close} />}
            </Modal>
        </div>
    );
}
