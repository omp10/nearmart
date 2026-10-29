import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../auth/AuthProvider.jsx';
import { api } from '../lib/api.js';
import { ModuleTabs, useCurrentModule } from '../lib/moduleContext.jsx';
import { Badge, ErrorNote, ImageUpload, Modal, useModules } from '../components/ui.jsx';

const toLocalInput = (d) => (d ? new Date(new Date(d).getTime() - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 16) : '');

const LINK_TYPES = [
    ['none', 'Nothing'],
    ['category', 'Category (id)'],
    ['product', 'Product (id)'],
    ['search', 'Search term'],
    ['url', 'Web page (https)']
];

const PRESET_COLORS = [
    { label: 'Pale Mint', hex: '#D1FAE5' },
    { label: 'Pale Peach', hex: '#FFEDD5' },
    { label: 'Pale Cream', hex: '#FEF3C7' },
    { label: 'Pale Sky Blue', hex: '#E0F2FE' },
    { label: 'Pale Yellow', hex: '#FEF9C3' },
    { label: 'Pale Green', hex: '#DCFCE7' },
    { label: 'White', hex: '#FFFFFF' }
];

const liveState = (c) => {
    const now = Date.now();
    if (!c.isActive) return <Badge>Off</Badge>;
    if (c.endsAt && new Date(c.endsAt) <= now) return <Badge tone="red">Ended</Badge>;
    if (c.startsAt && new Date(c.startsAt) > now) return <Badge tone="amber">Scheduled</Badge>;
    return <Badge tone="green">Live</Badge>;
};

function OfferCardForm({ card, module, onDone }) {
    const queryClient = useQueryClient();
    const { data: modules = [] } = useModules();
    const [form, setForm] = useState({
        module: card?.module ?? module,
        title: card?.title ?? '',
        label: card?.label ?? 'UP TO',
        discountText: card?.discountText ?? '',
        image: card?.image ?? '',
        backgroundColor: card?.backgroundColor ?? '#D1FAE5',
        linkType: card?.link?.type ?? 'none',
        linkValue: card?.link?.value ?? '',
        sortOrder: String(card?.sortOrder ?? 0),
        isActive: card?.isActive ?? true,
        startsAt: toLocalInput(card?.startsAt),
        endsAt: toLocalInput(card?.endsAt)
    });
    const set = (patch) => setForm((f) => ({ ...f, ...patch }));

    const save = useMutation({
        mutationFn: (body) => (card ? api.patch(`/admin/offer-cards/${card._id}`, body) : api.post('/admin/offer-cards', body)),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['offer-cards'] });
            onDone();
        }
    });

    return (
        <form
            className="space-y-4"
            onSubmit={(e) => {
                e.preventDefault();
                save.mutate({
                    module: form.module,
                    title: form.title,
                    label: form.label,
                    discountText: form.discountText,
                    image: form.image,
                    backgroundColor: form.backgroundColor,
                    link: { type: form.linkType, value: form.linkType === 'none' ? '' : form.linkValue },
                    sortOrder: Number.parseInt(form.sortOrder, 10) || 0,
                    isActive: form.isActive,
                    startsAt: form.startsAt ? new Date(form.startsAt).toISOString() : null,
                    endsAt: form.endsAt ? new Date(form.endsAt).toISOString() : null
                });
            }}
        >
            <ErrorNote error={save.error} />

            <div className="grid gap-4 sm:grid-cols-2">
                <div>
                    <label className="label" htmlFor="oc-module">Module</label>
                    <select id="oc-module" className="input" value={form.module} onChange={(e) => set({ module: e.target.value })}>
                        {modules.map((m) => (
                            <option key={m.key} value={m.key}>{m.name}</option>
                        ))}
                    </select>
                </div>
                <div>
                    <label className="label" htmlFor="oc-sort">Sort order</label>
                    <input id="oc-sort" type="number" className="input" value={form.sortOrder} onChange={(e) => set({ sortOrder: e.target.value })} />
                </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
                <div>
                    <label className="label" htmlFor="oc-label">Overline label</label>
                    <input id="oc-label" className="input" value={form.label} placeholder="UP TO" onChange={(e) => set({ label: e.target.value })} maxLength={50} />
                </div>
                <div>
                    <label className="label" htmlFor="oc-disc">Discount text</label>
                    <input id="oc-disc" className="input" value={form.discountText} placeholder="12% OFF" onChange={(e) => set({ discountText: e.target.value })} required maxLength={50} />
                </div>
                <div>
                    <label className="label" htmlFor="oc-title">Title</label>
                    <input id="oc-title" className="input" value={form.title} placeholder="Beverages" onChange={(e) => set({ title: e.target.value })} required maxLength={100} />
                </div>
            </div>

            <div className="space-y-2">
                <span className="label">Background colour</span>
                <div className="flex flex-wrap items-center gap-2">
                    <input
                        type="color"
                        value={form.backgroundColor.startsWith('#') && form.backgroundColor.length === 7 ? form.backgroundColor : '#D1FAE5'}
                        onChange={(e) => set({ backgroundColor: e.target.value })}
                        className="h-9 w-12 cursor-pointer rounded border border-slate-300 p-0.5"
                    />
                    <input
                        type="text"
                        className="input w-32 font-mono text-xs"
                        value={form.backgroundColor}
                        onChange={(e) => set({ backgroundColor: e.target.value })}
                        placeholder="#D1FAE5"
                    />
                    <div className="flex flex-wrap gap-1">
                        {PRESET_COLORS.map((c) => (
                            <button
                                key={c.hex}
                                type="button"
                                onClick={() => set({ backgroundColor: c.hex })}
                                className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 px-2.5 py-1 text-xs hover:border-slate-400"
                            >
                                <span className="h-3 w-3 rounded-full border border-slate-300" style={{ backgroundColor: c.hex }} />
                                {c.label}
                            </button>
                        ))}
                    </div>
                </div>
            </div>

            <div className="space-y-2">
                <span className="label">Card Artwork (4:5 vertical, webp, empty top-left)</span>
                <div className="flex items-start gap-4">
                    {form.image ? (
                        <div
                            className="relative h-44 w-36 overflow-hidden rounded-xl border border-slate-200 shadow-sm"
                            style={{ backgroundColor: form.backgroundColor }}
                        >
                            <img src={form.image} alt="" className="h-full w-full object-cover" />
                            <div className="absolute left-3 top-3">
                                <span className="block text-[9px] font-semibold uppercase tracking-wider text-slate-600">{form.label || 'UP TO'}</span>
                                <span className="block text-base font-bold text-brand-700">{form.discountText || '12% OFF'}</span>
                                <span className="block text-xs font-medium text-slate-700">{form.title || 'Title'}</span>
                            </div>
                        </div>
                    ) : (
                        <div
                            className="flex h-44 w-36 items-center justify-center rounded-xl border border-dashed border-slate-300 text-center text-xs text-slate-400"
                            style={{ backgroundColor: form.backgroundColor }}
                        >
                            Card preview
                        </div>
                    )}
                    <div className="flex-1 space-y-2">
                        <ImageUpload
                            folder="offers"
                            onUploaded={(image) => set({ image })}
                            label={form.image ? 'Replace image' : 'Upload image (4:5)'}
                        />
                        <p className="text-xs text-slate-500">
                            Recommended size: 800×1000 (4:5). Images are automatically converted to WebP. The top-left 55% should be clear for text overlay.
                        </p>
                    </div>
                </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
                <div>
                    <label className="label" htmlFor="oc-link">On tap, open</label>
                    <select id="oc-link" className="input" value={form.linkType} onChange={(e) => set({ linkType: e.target.value, linkValue: '' })}>
                        {LINK_TYPES.map(([v, l]) => (
                            <option key={v} value={v}>{l}</option>
                        ))}
                    </select>
                </div>
                {form.linkType !== 'none' && (
                    <div>
                        <label className="label" htmlFor="oc-val">
                            {form.linkType === 'category' ? 'Category ID' : form.linkType === 'product' ? 'Product ID' : form.linkType === 'search' ? 'Search term' : 'URL'}
                        </label>
                        <input
                            id="oc-val"
                            className="input font-mono text-xs"
                            value={form.linkValue}
                            placeholder={form.linkType === 'url' ? 'https://' : form.linkType === 'search' ? 'e.g. Beverages or Atta' : 'ID'}
                            onChange={(e) => set({ linkValue: e.target.value })}
                            required
                        />
                    </div>
                )}
                <div>
                    <label className="label" htmlFor="oc-start">Show from (optional)</label>
                    <input id="oc-start" type="datetime-local" className="input" value={form.startsAt} onChange={(e) => set({ startsAt: e.target.value })} />
                </div>
                <div>
                    <label className="label" htmlFor="oc-end">Until (optional)</label>
                    <input id="oc-end" type="datetime-local" className="input" value={form.endsAt} onChange={(e) => set({ endsAt: e.target.value })} />
                </div>
            </div>

            <label className="flex items-center gap-2 text-sm font-medium">
                <input type="checkbox" checked={form.isActive} onChange={(e) => set({ isActive: e.target.checked })} />
                Active on customer app
            </label>

            <div className="flex justify-end gap-2 pt-2">
                <button type="button" className="btn-ghost" onClick={onDone}>Cancel</button>
                <button type="submit" className="btn-primary" disabled={save.isPending || !form.image}>
                    {save.isPending ? 'Saving…' : 'Save offer card'}
                </button>
            </div>
        </form>
    );
}

export default function OfferCards() {
    const { can } = useAuth();
    const queryClient = useQueryClient();
    const [editing, setEditing] = useState(null);
    const { module, modules } = useCurrentModule();
    const activeModule = module === 'global' ? 'grocery' : module;
    const name = modules.find((m) => m.key === activeModule)?.name ?? activeModule;

    const { data: all = [], isLoading, error } = useQuery({
        queryKey: ['offer-cards'],
        queryFn: () => api.get('/admin/offer-cards').then((r) => r.data.data)
    });

    const cards = all
        .filter((c) => c.module === activeModule)
        .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));

    const remove = useMutation({
        mutationFn: (id) => api.delete(`/admin/offer-cards/${id}`),
        onSuccess: () => queryClient.invalidateQueries({ queryKey: ['offer-cards'] })
    });

    const toggleActive = useMutation({
        mutationFn: ({ id, isActive }) => api.patch(`/admin/offer-cards/${id}`, { isActive }),
        onSuccess: () => queryClient.invalidateQueries({ queryKey: ['offer-cards'] })
    });

    const reorder = useMutation({
        mutationFn: (items) => api.put('/admin/offer-cards/reorder', { items }),
        onSuccess: () => queryClient.invalidateQueries({ queryKey: ['offer-cards'] })
    });

    const moveCard = (index, direction) => {
        const targetIndex = index + direction;
        if (targetIndex < 0 || targetIndex >= cards.length) return;
        const reordered = [...cards];
        const [moved] = reordered.splice(index, 1);
        reordered.splice(targetIndex, 0, moved);
        const updates = reordered.map((c, i) => ({ id: c._id, sortOrder: (i + 1) * 10 }));
        reorder.mutate(updates);
    };

    return (
        <div className="space-y-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                    <h1 className="text-2xl font-semibold">Offer Cards</h1>
                    <p className="text-sm text-slate-500">
                        Promotional tiles shown directly under the main banner in the mobile app. Managed per shop.
                    </p>
                </div>
                {can('banners', 'create') && (
                    <button type="button" className="btn-primary" onClick={() => setEditing({})}>
                        Add offer card
                    </button>
                )}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3">
                <ModuleTabs />
            </div>

            <ErrorNote error={error || remove.error || toggleActive.error || reorder.error} />

            {isLoading && <p className="text-sm text-slate-500">Loading…</p>}
            {!isLoading && cards.length === 0 && (
                <div className="rounded-xl border border-dashed border-slate-300 p-8 text-center text-slate-500">
                    No offer cards for {name} yet. Add cards with custom artwork to showcase deals on the home screen.
                </div>
            )}

            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {cards.map((c, idx) => (
                    <div key={c._id} className="card flex flex-col justify-between space-y-3 p-4">
                        <div className="flex gap-3">
                            <div
                                className="relative h-36 w-28 shrink-0 overflow-hidden rounded-xl border border-slate-200 shadow-sm"
                                style={{ backgroundColor: c.backgroundColor || '#F3F4F6' }}
                            >
                                <img src={c.image} alt={c.title} className="h-full w-full object-cover" />
                                <div className="absolute left-2 top-2 pr-2">
                                    <span className="block text-[8px] font-semibold uppercase tracking-wider text-slate-600">
                                        {c.label || 'UP TO'}
                                    </span>
                                    <span className="block text-sm font-bold text-brand-700">
                                        {c.discountText}
                                    </span>
                                    <span className="block text-[11px] font-medium text-slate-700 truncate">
                                        {c.title}
                                    </span>
                                </div>
                            </div>
                            <div className="flex-1 min-w-0 space-y-1">
                                <div className="flex items-center justify-between gap-1">
                                    <p className="font-semibold truncate">{c.title}</p>
                                    {liveState(c)}
                                </div>
                                <p className="text-xs text-brand-700 font-medium">{c.discountText}</p>
                                <p className="text-xs text-slate-500">
                                    Order: <span className="font-mono">{c.sortOrder}</span>
                                </p>
                                {c.link?.type && c.link.type !== 'none' && (
                                    <p className="text-xs text-slate-500 truncate">
                                        Link: <span className="capitalize">{c.link.type}</span> ({c.link.value})
                                    </p>
                                )}
                            </div>
                        </div>

                        <div className="flex items-center justify-between border-t border-slate-100 pt-3 text-xs">
                            <div className="flex items-center gap-1">
                                <button
                                    type="button"
                                    disabled={idx === 0 || reorder.isPending}
                                    onClick={() => moveCard(idx, -1)}
                                    className="rounded border border-slate-200 px-2 py-0.5 hover:bg-slate-50 disabled:opacity-30"
                                    title="Move earlier"
                                >
                                    ↑
                                </button>
                                <button
                                    type="button"
                                    disabled={idx === cards.length - 1 || reorder.isPending}
                                    onClick={() => moveCard(idx, 1)}
                                    className="rounded border border-slate-200 px-2 py-0.5 hover:bg-slate-50 disabled:opacity-30"
                                    title="Move later"
                                >
                                    ↓
                                </button>
                                <button
                                    type="button"
                                    onClick={() => toggleActive.mutate({ id: c._id, isActive: !c.isActive })}
                                    className={`ml-1 rounded px-2 py-0.5 font-medium ${c.isActive ? 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
                                >
                                    {c.isActive ? 'Active' : 'Turned off'}
                                </button>
                            </div>
                            <div className="flex items-center gap-1">
                                {can('banners', 'update') && (
                                    <button
                                        type="button"
                                        className="btn-ghost px-2 py-1 text-xs"
                                        onClick={() => setEditing(c)}
                                    >
                                        Edit
                                    </button>
                                )}
                                {can('banners', 'delete') && (
                                    <button
                                        type="button"
                                        className="btn-ghost px-2 py-1 text-xs text-red-600"
                                        onClick={() => window.confirm(`Delete "${c.title}"?`) && remove.mutate(c._id)}
                                    >
                                        Delete
                                    </button>
                                )}
                            </div>
                        </div>
                    </div>
                ))}
            </div>

            <Modal
                open={Boolean(editing)}
                title={editing?._id ? 'Edit offer card' : 'New offer card'}
                onClose={() => setEditing(null)}
                wide
            >
                {editing && (
                    <OfferCardForm
                        card={editing._id ? editing : null}
                        module={activeModule}
                        onDone={() => setEditing(null)}
                    />
                )}
            </Modal>
        </div>
    );
}
