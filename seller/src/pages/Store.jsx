import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { useAuth } from '../auth/AuthProvider.jsx';
import { api } from '../lib/api.js';
import { formatDate } from '../lib/format.js';
import { MODULE_STATUS, SHOPS, shopLabel } from '../lib/shops.js';
import { AddressForm, BankForm, BusinessForm, TaxForm } from '../components/sellerForms.jsx';
import { Badge, ErrorNote, Loading, Modal, Notice, PageHeader, useShopOptions } from '../components/ui.jsx';

function Section({ title, subtitle, children }) {
    return (
        <section className="card">
            <h2 className="text-lg font-semibold">{title}</h2>
            {subtitle && <p className="mb-4 text-sm text-slate-500">{subtitle}</p>}
            {!subtitle && <div className="mb-4" />}
            {children}
        </section>
    );
}

export function StoreProfile() {
    const { seller } = useAuth();
    return (
        <div className="space-y-6">
            <PageHeader title="Store profile" subtitle="How customers and delivery partners see your store." />
            <Section title="Store details">
                <BusinessForm seller={seller} mode="store" />
            </Section>
            <Section title="Shop address" subtitle="Where delivery partners collect your orders.">
                <AddressForm seller={seller} />
            </Section>
            <Section title="Bank details">
                <BankForm
                    seller={seller}
                    note={<p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">Nearmart checks changed bank details before the next payout, so a change may delay it slightly.</p>}
                />
            </Section>
            <Section title="Tax details">
                <TaxForm seller={seller} locked />
            </Section>
        </div>
    );
}

function RequestShop({ available, onDone }) {
    const { setSeller } = useAuth();
    const { data: options = [] } = useShopOptions();
    const [key, setKey] = useState(available[0] ?? '');
    const [categories, setCategories] = useState([]);
    const shopCategories = options.find((o) => o.key === key)?.categories ?? [];
    const request = useMutation({
        mutationFn: () => api.post('/seller/modules', { key, categories }).then((r) => r.data.data),
        onSuccess: (profile) => {
            setSeller(profile);
            onDone();
        }
    });
    const toggle = (id) => setCategories((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id]));

    return (
        <form
            className="space-y-4"
            onSubmit={(e) => {
                e.preventDefault();
                request.mutate();
            }}
        >
            <ErrorNote error={request.error} />
            <fieldset className="space-y-2">
                <legend className="label">Shop</legend>
                {available.map((k) => {
                    const Icon = SHOPS[k]?.icon;
                    return (
                        <label key={k} className={`flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2 ${key === k ? 'border-brand-500 bg-brand-50/50' : 'border-slate-200'}`}>
                            <input type="radio" name="shop" className="accent-brand-700" checked={key === k} onChange={() => { setKey(k); setCategories([]); }} />
                            {Icon && <Icon className={`h-4 w-4 ${SHOPS[k].tint}`} aria-hidden="true" />}
                            <span className="text-sm font-medium">{shopLabel(k)}</span>
                        </label>
                    );
                })}
            </fieldset>
            {shopCategories.length > 0 && (
                <div>
                    <p className="label">Categories (optional)</p>
                    <p className="mb-2 text-xs text-slate-500">Leave all unticked to sell in any category of this shop.</p>
                    <div className="flex flex-wrap gap-2">
                        {shopCategories.map((c) => {
                            const active = categories.includes(c.id);
                            return (
                                <button key={c.id} type="button" aria-pressed={active} onClick={() => toggle(c.id)} className={`rounded-full border px-3 py-1 text-xs font-medium ${active ? 'border-brand-700 bg-brand-700 text-white' : 'border-slate-200 bg-white text-slate-600'}`}>
                                    {active && '✓ '}
                                    {c.name}
                                </button>
                            );
                        })}
                    </div>
                </div>
            )}
            <div className="flex justify-end gap-2">
                <button type="button" className="btn-ghost" onClick={onDone}>Cancel</button>
                <button type="submit" className="btn-primary" disabled={!key || request.isPending}>{request.isPending ? 'Sending…' : 'Ask Nearmart'}</button>
            </div>
        </form>
    );
}

export function Shops() {
    const { seller } = useAuth();
    const { data: options, isLoading } = useShopOptions();
    const [asking, setAsking] = useState(false);
    const categoryName = (key, id) => options?.find((s) => s.key === key)?.categories.find((c) => c.id === String(id))?.name ?? 'Category';
    const modules = seller.modules ?? [];
    // A shop can be asked for when it isn't approved or already waiting.
    const available = (options ?? []).map((o) => o.key).filter((k) => !modules.some((m) => m.key === k && m.status !== 'rejected'));

    return (
        <div className="space-y-6">
            <PageHeader
                title="Shops & categories"
                subtitle="The Nearmart shops you sell in. Nearmart approves each one."
                actions={available.length > 0 && (
                    <button type="button" className="btn-primary" onClick={() => setAsking(true)}>
                        <Plus className="h-4 w-4" aria-hidden="true" />
                        Sell in another shop
                    </button>
                )}
            />
            {isLoading && <Loading />}
            <div className="grid gap-4 md:grid-cols-2">
                {modules.map((m) => {
                    const Icon = SHOPS[m.key]?.icon;
                    const status = MODULE_STATUS[m.status] ?? { label: m.status, tone: 'slate' };
                    return (
                        <section key={m.key} className="card space-y-2">
                            <div className="flex items-start justify-between gap-2">
                                <p className="flex items-center gap-2 font-semibold text-slate-900">
                                    {Icon && <Icon className={`h-5 w-5 ${SHOPS[m.key].tint}`} aria-hidden="true" />}
                                    {shopLabel(m.key)}
                                </p>
                                <Badge tone={status.tone}>{status.label}</Badge>
                            </div>
                            <p className="text-sm text-slate-600">
                                {m.categories?.length ? m.categories.map((c) => categoryName(m.key, c)).join(', ') : 'All categories'}
                            </p>
                            <p className="text-xs text-slate-500">
                                Asked {formatDate(m.requestedAt)}{m.decidedAt && ` · decided ${formatDate(m.decidedAt)}`}
                            </p>
                            {m.note && <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700">Note from Nearmart: {m.note}</p>}
                            {m.status === 'rejected' && <p className="text-xs text-slate-500">You can ask again with "Sell in another shop".</p>}
                        </section>
                    );
                })}
            </div>
            {modules.length === 0 && <Notice>You don't sell in any shop yet.</Notice>}

            <Modal open={asking} title="Sell in another shop" onClose={() => setAsking(false)}>
                {asking && <RequestShop available={available} onDone={() => setAsking(false)} />}
            </Modal>
        </div>
    );
}
