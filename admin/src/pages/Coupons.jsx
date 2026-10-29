import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router';
import { useAuth } from '../auth/AuthProvider.jsx';
import { api } from '../lib/api.js';
import { useCurrentModule } from '../lib/moduleContext.jsx';
import { formatPaise, paiseToRupees, rupeesToPaise } from '../lib/money.js';
import { Badge, ErrorNote, Modal, useModules } from '../components/ui.jsx';

const toLocalInput = (d) => (d ? new Date(new Date(d).getTime() - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 16) : '');

const toForm = (c, module) => ({
    code: c?.code ?? '',
    description: c?.description ?? '',
    type: c?.type ?? 'percent',
    value: c ? (c.type === 'flat' ? paiseToRupees(c.value) : String(c.value)) : '',
    maxDiscount: paiseToRupees(c?.maxDiscountPaise),
    minOrder: c?.minOrderPaise ? paiseToRupees(c.minOrderPaise) : '',
    modules: c?.modules ?? (module ? [module] : []),
    validFrom: toLocalInput(c?.validFrom),
    validTo: toLocalInput(c?.validTo),
    usageLimit: c?.usageLimit ? String(c.usageLimit) : '',
    perUserLimit: String(c?.perUserLimit ?? 1),
    firstOrderOnly: c?.firstOrderOnly ?? false,
    seller: c?.seller ? String(c.seller._id ?? c.seller) : '',
    fundedBy: c?.fundedBy ?? 'platform',
    isActive: c?.isActive ?? true
});

/** Approved marketplace sellers, for limiting a coupon to one store. Needs the sellers view permission. */
function useApprovedSellers(enabled) {
    return useQuery({
        queryKey: ['sellers', { status: 'approved', limit: 100 }],
        queryFn: () => api.get('/admin/sellers', { params: { status: 'approved', limit: 100 } }).then((r) => r.data.data.items),
        enabled,
        staleTime: 5 * 60_000
    });
}

const describe = (c) => {
    const amount = c.type === 'percent' ? `${c.value}% off` : `${formatPaise(c.value)} off`;
    const cap = c.type === 'percent' && c.maxDiscountPaise != null ? ` up to ${formatPaise(c.maxDiscountPaise)}` : '';
    const min = c.minOrderPaise ? ` on ${formatPaise(c.minOrderPaise)}+` : '';
    return `${amount}${cap}${min}`;
};

const status = (c) => {
    const now = Date.now();
    if (!c.isActive) return <Badge>Off</Badge>;
    if (c.validTo && new Date(c.validTo) < now) return <Badge tone="red">Expired</Badge>;
    if (c.validFrom && new Date(c.validFrom) > now) return <Badge tone="amber">Scheduled</Badge>;
    if (c.usageLimit != null && c.usedCount >= c.usageLimit) return <Badge tone="red">Used up</Badge>;
    return <Badge tone="green">Live</Badge>;
};

function CouponForm({ coupon, onDone }) {
    const queryClient = useQueryClient();
    const { can } = useAuth();
    const canSeeSellers = can('sellers');
    const { data: sellers = [], isLoading: sellersLoading } = useApprovedSellers(canSeeSellers);
    const { data: modules = [] } = useModules();
    // From Global a new coupon starts on every module; from a module, on that one.
    const { module, isGlobal } = useCurrentModule();
    const [form, setForm] = useState(() => toForm(coupon, isGlobal ? null : module));
    const [formError, setFormError] = useState('');
    const set = (patch) => setForm((f) => ({ ...f, ...patch }));

    const save = useMutation({
        mutationFn: (body) => (coupon ? api.patch(`/admin/coupons/${coupon._id}`, body) : api.post('/admin/coupons', body)),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['coupons'] });
            onDone();
        }
    });

    const submit = (e) => {
        e.preventDefault();
        setFormError('');
        const value = form.type === 'flat' ? rupeesToPaise(form.value) : Number(form.value);
        const maxDiscountPaise = form.type === 'percent' ? rupeesToPaise(form.maxDiscount) : null;
        const minOrderPaise = rupeesToPaise(form.minOrder) ?? 0;
        if ([value, maxDiscountPaise, minOrderPaise].some(Number.isNaN) || !value) return setFormError('Check the amounts');
        // Mirrors the server rule: the seller can only pay for a coupon limited to them.
        if (form.fundedBy === 'seller' && !form.seller) return setFormError('A seller-funded coupon must be limited to that seller');
        return save.mutate({
            code: form.code,
            description: form.description,
            type: form.type,
            value,
            maxDiscountPaise,
            minOrderPaise,
            modules: form.modules,
            validFrom: form.validFrom ? new Date(form.validFrom).toISOString() : null,
            validTo: form.validTo ? new Date(form.validTo).toISOString() : null,
            usageLimit: form.usageLimit ? Number.parseInt(form.usageLimit, 10) : null,
            perUserLimit: Number.parseInt(form.perUserLimit, 10) || 1,
            firstOrderOnly: form.firstOrderOnly,
            seller: form.seller || null,
            fundedBy: form.seller ? form.fundedBy : 'platform',
            isActive: form.isActive
        });
    };

    return (
        <form onSubmit={submit} className="space-y-4">
            <ErrorNote error={formError || save.error} />
            <div className="grid gap-4 sm:grid-cols-2">
                <div>
                    <label className="label" htmlFor="cp-code">Code</label>
                    <input id="cp-code" className="input font-mono uppercase" value={form.code} onChange={(e) => set({ code: e.target.value.toUpperCase() })} required pattern="[A-Za-z0-9_\-]{3,20}" disabled={Boolean(coupon?.usedCount)} />
                </div>
                <div>
                    <label className="label" htmlFor="cp-desc">Description</label>
                    <input id="cp-desc" className="input" placeholder="Shown to customers" value={form.description} onChange={(e) => set({ description: e.target.value })} maxLength={200} />
                </div>
                <div>
                    <label className="label" htmlFor="cp-type">Discount</label>
                    <div className="flex gap-2">
                        <select id="cp-type" className="input w-32" value={form.type} onChange={(e) => set({ type: e.target.value })}>
                            <option value="percent">% off</option>
                            <option value="flat">₹ off</option>
                        </select>
                        <input className="input" type="number" min="0" step={form.type === 'flat' ? '0.01' : '1'} max={form.type === 'percent' ? 100 : undefined} aria-label="Discount value" value={form.value} onChange={(e) => set({ value: e.target.value })} required />
                    </div>
                </div>
                {form.type === 'percent' && (
                    <div>
                        <label className="label" htmlFor="cp-max">Maximum discount (₹)</label>
                        <input id="cp-max" className="input" type="number" min="0" step="0.01" placeholder="No cap" value={form.maxDiscount} onChange={(e) => set({ maxDiscount: e.target.value })} />
                    </div>
                )}
                <div>
                    <label className="label" htmlFor="cp-min">Minimum order (₹)</label>
                    <input id="cp-min" className="input" type="number" min="0" step="0.01" value={form.minOrder} onChange={(e) => set({ minOrder: e.target.value })} />
                </div>
                <div>
                    <label className="label" htmlFor="cp-from">Valid from</label>
                    <input id="cp-from" className="input" type="datetime-local" value={form.validFrom} onChange={(e) => set({ validFrom: e.target.value })} />
                </div>
                <div>
                    <label className="label" htmlFor="cp-to">Valid until</label>
                    <input id="cp-to" className="input" type="datetime-local" value={form.validTo} onChange={(e) => set({ validTo: e.target.value })} />
                </div>
                <div>
                    <label className="label" htmlFor="cp-limit">Total uses</label>
                    <input id="cp-limit" className="input" type="number" min="1" placeholder="Unlimited" value={form.usageLimit} onChange={(e) => set({ usageLimit: e.target.value })} />
                </div>
                <div>
                    <label className="label" htmlFor="cp-per">Uses per customer</label>
                    <input id="cp-per" className="input" type="number" min="1" value={form.perUserLimit} onChange={(e) => set({ perUserLimit: e.target.value })} />
                </div>
            </div>
            <fieldset>
                <legend className="label">Applies to</legend>
                <div className="flex flex-wrap gap-4">
                    {modules.filter((m) => m.key !== 'laundry').map((m) => (
                        <label key={m.key} className="flex items-center gap-2 text-sm">
                            <input
                                type="checkbox"
                                checked={form.modules.includes(m.key)}
                                onChange={(e) => set({ modules: e.target.checked ? [...form.modules, m.key] : form.modules.filter((k) => k !== m.key) })}
                            />
                            {m.name}
                        </label>
                    ))}
                </div>
                <p className="mt-1 text-xs text-slate-500">Leave all unticked to apply everywhere.</p>
            </fieldset>
            <div className="grid gap-4 sm:grid-cols-2">
                <div>
                    <label className="label" htmlFor="cp-seller">Only for seller (optional)</label>
                    {canSeeSellers ? (
                        <select
                            id="cp-seller"
                            className="input"
                            value={form.seller}
                            onChange={(e) => set({ seller: e.target.value, ...(e.target.value ? {} : { fundedBy: 'platform' }) })}
                            disabled={sellersLoading}
                        >
                            <option value="">Any store (Nearmart's included)</option>
                            {sellers.map((s) => <option key={s._id} value={s._id}>{s.businessName}</option>)}
                            {form.seller && !sellersLoading && !sellers.some((s) => s._id === form.seller) && (
                                <option value={form.seller}>A seller not approved now</option>
                            )}
                        </select>
                    ) : (
                        <p id="cp-seller" className="input bg-slate-50 text-slate-500">{form.seller ? 'One marketplace seller' : 'Any store'}</p>
                    )}
                    <p className="mt-1 text-xs text-slate-500">
                        {canSeeSellers ? "The coupon then works only on that seller's items." : 'You need access to Sellers to change this.'}
                    </p>
                </div>
                <div>
                    <label className="label" htmlFor="cp-funded">Discount paid by</label>
                    <select id="cp-funded" className="input" value={form.seller ? form.fundedBy : 'platform'} onChange={(e) => set({ fundedBy: e.target.value })} disabled={!form.seller}>
                        <option value="platform">Nearmart</option>
                        <option value="seller">The seller</option>
                    </select>
                    <p className="mt-1 text-xs text-slate-500">
                        {!form.seller
                            ? 'Choose a seller first: only a coupon limited to one seller can be paid for by that seller.'
                            : form.fundedBy === 'seller'
                                ? "The discount comes out of the seller's payout."
                                : 'Nearmart pays the discount; the seller is paid in full.'}
                    </p>
                </div>
            </div>
            <div className="flex flex-wrap gap-6">
                <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={form.firstOrderOnly} onChange={(e) => set({ firstOrderOnly: e.target.checked })} />
                    First order only
                </label>
                <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={form.isActive} onChange={(e) => set({ isActive: e.target.checked })} />
                    Active
                </label>
            </div>
            <div className="flex justify-end gap-2">
                <button type="button" className="btn-ghost" onClick={onDone}>Cancel</button>
                <button type="submit" className="btn-primary" disabled={save.isPending}>{save.isPending ? 'Saving…' : 'Save'}</button>
            </div>
        </form>
    );
}

export default function Coupons() {
    const { can } = useAuth();
    const queryClient = useQueryClient();
    const [editing, setEditing] = useState(null);
    const { module, modules, isGlobal } = useCurrentModule();
    const name = modules.find((m) => m.key === module)?.name ?? module;
    const { data: sellers = [] } = useApprovedSellers(can('sellers'));
    const sellerName = (sellerId) => sellers.find((s) => s._id === String(sellerId))?.businessName ?? 'one seller';
    const { data: all = [], isLoading, error } = useQuery({
        queryKey: ['coupons'],
        queryFn: () => api.get('/admin/coupons').then((r) => r.data.data)
    });
    // A coupon with no modules applies everywhere, so it shows under every module.
    const coupons = isGlobal ? all : all.filter((c) => !c.modules.length || c.modules.includes(module));
    const remove = useMutation({
        mutationFn: (id) => api.delete(`/admin/coupons/${id}`),
        onSuccess: () => queryClient.invalidateQueries({ queryKey: ['coupons'] })
    });

    return (
        <div className="space-y-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                    <h1 className="text-2xl font-semibold">Coupons</h1>
                    <p className="text-sm text-slate-500">{isGlobal ? 'Every coupon, for all modules.' : `Coupons that work on ${name} orders.`} One coupon per order; coupons don't stack.</p>
                </div>
                {can('coupons', 'create') && <button type="button" className="btn-primary" onClick={() => setEditing({})}>Add coupon</button>}
            </div>
            <ErrorNote error={error || remove.error} />
            <div className="card overflow-x-auto p-0">
                <table className="w-full text-sm">
                    <thead className="bg-slate-50 text-left text-slate-500">
                        <tr>
                            <th className="px-4 py-3 font-medium">Code</th>
                            <th className="px-4 py-3 font-medium">Offer</th>
                            <th className="px-4 py-3 font-medium">Applies to</th>
                            <th className="px-4 py-3 font-medium">Used</th>
                            <th className="px-4 py-3 font-medium">Status</th>
                            <th className="px-4 py-3" />
                        </tr>
                    </thead>
                    <tbody>
                        {isLoading && <tr><td colSpan={6} className="px-4 py-6 text-center text-slate-500">Loading…</td></tr>}
                        {!isLoading && coupons.length === 0 && <tr><td colSpan={6} className="px-4 py-6 text-center text-slate-500">No coupons {isGlobal ? '' : `for ${name} `}yet.</td></tr>}
                        {coupons.map((c) => (
                            <tr key={c._id} className="border-t border-slate-100">
                                <td className="px-4 py-3 font-mono font-medium">{c.code}</td>
                                <td className="px-4 py-3">{describe(c)}{c.firstOrderOnly && <span className="block text-xs text-slate-500">First order only</span>}</td>
                                <td className="px-4 py-3 text-slate-600">
                                    {c.modules.length ? c.modules.map((k) => modules.find((m) => m.key === k)?.name ?? k).join(', ') : 'All modules'}
                                    {c.seller && (
                                        <span className="block text-xs">
                                            Only{' '}
                                            {can('sellers') ? <Link to={`/sellers/${c.seller}`} className="text-brand-700 hover:underline">{sellerName(c.seller)}</Link> : sellerName(c.seller)}
                                        </span>
                                    )}
                                    <span className="block text-xs text-slate-500">Paid by {c.fundedBy === 'seller' ? 'the seller' : 'Nearmart'}</span>
                                </td>
                                <td className="px-4 py-3 tabular-nums">{c.usedCount}{c.usageLimit != null && ` / ${c.usageLimit}`}</td>
                                <td className="px-4 py-3">{status(c)}</td>
                                <td className="whitespace-nowrap px-4 py-3 text-right">
                                    {can('coupons', 'update') && <button type="button" className="btn-ghost px-2 py-1" onClick={() => setEditing(c)}>Edit</button>}
                                    {can('coupons', 'delete') && c.usedCount === 0 && (
                                        <button type="button" className="btn-ghost px-2 py-1 text-red-600" onClick={() => window.confirm(`Delete ${c.code}?`) && remove.mutate(c._id)}>Delete</button>
                                    )}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
            <Modal open={Boolean(editing)} title={editing?._id ? `Edit ${editing.code}` : 'New coupon'} onClose={() => setEditing(null)} wide>
                {editing && <CouponForm coupon={editing._id ? editing : null} onDone={() => setEditing(null)} />}
            </Modal>
        </div>
    );
}
