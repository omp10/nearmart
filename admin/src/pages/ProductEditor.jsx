import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { useAuth } from '../auth/AuthProvider.jsx';
import { api } from '../lib/api.js';
import { paiseToRupees, rupeesToPaise } from '../lib/money.js';
import { ErrorNote, ImageUpload, flattenTree, useCategoryTree, useModules } from '../components/ui.jsx';

const UNITS = ['kg', 'g', 'l', 'ml', 'piece', 'pack', 'bunch', 'dozen', 'box'];

let nextKey = 0;
const blankVariant = () => ({
    key: `new-${(nextKey += 1)}`,
    sku: '', label: '', unit: 'piece', unitQty: '1', price: '', offerPrice: '',
    stockQty: '0', lowStockThreshold: '5', maxPerOrder: '', isActive: true, options: ''
});

/** "colour: Black, capacity: 128 GB" ⇄ { colour: 'Black', capacity: '128 GB' } */
const optionsToText = (o) => Object.entries(o || {}).map(([k, v]) => `${k}: ${v}`).join(', ');
const textToOptions = (t) =>
    Object.fromEntries(
        String(t || '')
            .split(',')
            .map((pair) => pair.split(':').map((s) => s.trim()))
            .filter(([k, v]) => k && v)
    );

const fromProduct = (p) => ({
    module: p.module,
    category: p.category,
    name: p.name,
    brand: p.brand,
    modelNumber: p.modelNumber,
    description: p.description,
    images: p.images,
    specifications: p.specifications,
    warranty: p.warranty,
    returnPolicy: p.returnPolicy,
    availabilityNote: p.availabilityNote,
    handlingNote: p.handlingNote,
    tags: p.tags.join(', '),
    isActive: p.isActive,
    isFeatured: p.isFeatured,
    variants: p.variants.map((v) => ({
        key: v._id,
        _id: v._id,
        sku: v.sku || '',
        label: v.label,
        unit: v.unit,
        unitQty: String(v.unitQty),
        price: paiseToRupees(v.pricePaise),
        offerPrice: paiseToRupees(v.offerPricePaise),
        stockQty: String(v.stockQty),
        lowStockThreshold: String(v.lowStockThreshold),
        maxPerOrder: v.maxPerOrder ? String(v.maxPerOrder) : '',
        isActive: v.isActive,
        options: optionsToText(v.options)
    }))
});

const emptyForm = (module) => ({
    module, category: '', name: '', brand: '', modelNumber: '', description: '', images: [], specifications: [],
    warranty: '', returnPolicy: '', availabilityNote: '', handlingNote: '', tags: '', isActive: true, isFeatured: false,
    variants: [blankVariant()]
});

/** Form state → API body. Returns { error } when a number doesn't parse. */
const toBody = (form, isEdit) => {
    const variants = [];
    for (const v of form.variants) {
        const pricePaise = rupeesToPaise(v.price);
        const offerPricePaise = rupeesToPaise(v.offerPrice);
        if (pricePaise == null || Number.isNaN(pricePaise)) return { error: `Enter a selling price for "${v.label || 'variant'}"` };
        if (Number.isNaN(offerPricePaise)) return { error: `Offer price for "${v.label}" is not a number` };
        const options = textToOptions(v.options);
        variants.push({
            ...(v._id ? { _id: v._id } : {}),
            sku: v.sku.trim() || undefined,
            label: v.label.trim(),
            unit: v.unit,
            unitQty: Number(v.unitQty) || 0,
            pricePaise,
            offerPricePaise,
            stockQty: Number.parseInt(v.stockQty, 10) || 0,
            lowStockThreshold: Number.parseInt(v.lowStockThreshold, 10) || 0,
            maxPerOrder: v.maxPerOrder ? Number.parseInt(v.maxPerOrder, 10) : null,
            isActive: v.isActive,
            ...(Object.keys(options).length ? { options } : {})
        });
    }
    const { module, tags, ...rest } = form;
    return {
        body: {
            ...(isEdit ? {} : { module }),
            ...rest,
            tags: tags.split(',').map((t) => t.trim()).filter(Boolean),
            specifications: form.specifications.filter((s) => s.key.trim() && s.value.trim()),
            variants
        }
    };
};

export default function ProductEditor() {
    const { id } = useParams();
    const isEdit = Boolean(id);
    const [search] = useSearchParams();
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const { can } = useAuth();
    const { data: modules = [] } = useModules();
    const [form, setForm] = useState(null);
    const [formError, setFormError] = useState('');

    const { data: product, error: loadError } = useQuery({
        queryKey: ['product', id],
        queryFn: () => api.get(`/admin/catalog/products/${id}`).then((r) => r.data.data),
        enabled: isEdit
    });

    useEffect(() => {
        if (isEdit && product) setForm(fromProduct(product));
        if (!isEdit && !form) setForm(emptyForm(search.get('module') || 'grocery'));
    }, [isEdit, product, form, search]);

    const { data: tree = [] } = useCategoryTree(form?.module);

    const save = useMutation({
        mutationFn: (body) => (isEdit ? api.patch(`/admin/catalog/products/${id}`, body) : api.post('/admin/catalog/products', body)),
        onSuccess: (res) => {
            queryClient.invalidateQueries({ queryKey: ['products'] });
            queryClient.invalidateQueries({ queryKey: ['inventory'] });
            queryClient.setQueryData(['product', res.data.data._id], res.data.data);
            if (isEdit) setForm(fromProduct(res.data.data));
            else navigate(`/products/${res.data.data._id}`, { replace: true });
        }
    });

    const remove = useMutation({
        mutationFn: () => api.delete(`/admin/catalog/products/${id}`),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['products'] });
            navigate('/products', { replace: true });
        }
    });

    if (loadError) return <ErrorNote error={loadError} />;
    if (!form) return <p className="text-sm text-slate-500">Loading…</p>;

    const set = (patch) => setForm((f) => ({ ...f, ...patch }));
    const setVariant = (key, patch) => set({ variants: form.variants.map((v) => (v.key === key ? { ...v, ...patch } : v)) });
    const editable = can('catalog', isEdit ? 'update' : 'create');
    const isElectronics = form.module === 'electronics';
    const isProduce = form.module === 'produce';

    const onSubmit = (e) => {
        e.preventDefault();
        setFormError('');
        const { body, error } = toBody(form, isEdit);
        if (error) return setFormError(error);
        return save.mutate(body);
    };

    return (
        <form onSubmit={onSubmit} className="space-y-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                    <Link to="/products" className="text-sm text-slate-500 hover:underline">← Products</Link>
                    <h1 className="text-2xl font-semibold">{isEdit ? form.name || 'Product' : 'New product'}</h1>
                </div>
                <div className="flex gap-2">
                    {isEdit && can('catalog', 'delete') && (
                        <button
                            type="button"
                            className="btn-ghost text-red-600"
                            onClick={() => window.confirm('Delete this product permanently?') && remove.mutate()}
                        >
                            Delete
                        </button>
                    )}
                    {editable && (
                        <button type="submit" className="btn-primary" disabled={save.isPending}>
                            {save.isPending ? 'Saving…' : 'Save'}
                        </button>
                    )}
                </div>
            </div>

            <ErrorNote error={formError || save.error || remove.error} />
            {save.isSuccess && !save.isPending && <p className="text-sm text-brand-700" role="status">Saved.</p>}

            {/* min-w-0: a fieldset defaults to min-content width, which let the variants table widen the page. */}
            <fieldset disabled={!editable} className="min-w-0 space-y-6">
                <section className="card grid gap-4 sm:grid-cols-2">
                    <div>
                        <label className="label" htmlFor="p-module">Module</label>
                        <select
                            id="p-module"
                            className="input"
                            value={form.module}
                            disabled={isEdit}
                            onChange={(e) => set({ module: e.target.value, category: '' })}
                        >
                            {modules.filter((m) => m.key !== 'laundry').map((m) => <option key={m.key} value={m.key}>{m.name}</option>)}
                        </select>
                    </div>
                    <div>
                        <label className="label" htmlFor="p-category">Category</label>
                        <select id="p-category" className="input" value={form.category} onChange={(e) => set({ category: e.target.value })} required>
                            <option value="" disabled>Choose a category</option>
                            {flattenTree(tree).map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                        </select>
                    </div>
                    <div className="sm:col-span-2">
                        <label className="label" htmlFor="p-name">Name</label>
                        <input id="p-name" className="input" value={form.name} onChange={(e) => set({ name: e.target.value })} required maxLength={160} />
                    </div>
                    <div>
                        <label className="label" htmlFor="p-brand">Brand</label>
                        <input id="p-brand" className="input" value={form.brand} onChange={(e) => set({ brand: e.target.value })} maxLength={80} />
                    </div>
                    {isElectronics && (
                        <div>
                            <label className="label" htmlFor="p-model">Model number</label>
                            <input id="p-model" className="input" value={form.modelNumber} onChange={(e) => set({ modelNumber: e.target.value })} maxLength={80} />
                        </div>
                    )}
                    <div className="sm:col-span-2">
                        <label className="label" htmlFor="p-desc">Description</label>
                        <textarea id="p-desc" className="input" rows={4} value={form.description} onChange={(e) => set({ description: e.target.value })} maxLength={5000} />
                    </div>
                    <div className="sm:col-span-2">
                        <label className="label" htmlFor="p-tags">Search keywords</label>
                        <input
                            id="p-tags"
                            className="input"
                            placeholder="Comma-separated, e.g. tamatar, salad"
                            value={form.tags}
                            onChange={(e) => set({ tags: e.target.value })}
                        />
                    </div>
                    <div className="flex flex-wrap gap-6 sm:col-span-2">
                        <label className="flex items-center gap-2 text-sm">
                            <input type="checkbox" checked={form.isActive} onChange={(e) => set({ isActive: e.target.checked })} />
                            Visible to customers
                        </label>
                        <label className="flex items-center gap-2 text-sm">
                            <input type="checkbox" checked={form.isFeatured} onChange={(e) => set({ isFeatured: e.target.checked })} />
                            Featured on the home screen
                        </label>
                    </div>
                </section>

                <section className="card space-y-3">
                    <h2 className="font-semibold">Images</h2>
                    <div className="flex flex-wrap items-center gap-3">
                        {form.images.map((url, i) => (
                            <div key={url} className="relative">
                                <img src={url} alt="" className="h-24 w-24 rounded-lg border object-cover" />
                                {i === 0 && <span className="absolute left-1 top-1 rounded bg-white/90 px-1 text-[10px]">Main</span>}
                                <button
                                    type="button"
                                    className="absolute right-1 top-1 rounded bg-white/90 px-1 text-xs"
                                    aria-label="Remove image"
                                    onClick={() => set({ images: form.images.filter((u) => u !== url) })}
                                >
                                    ✕
                                </button>
                            </div>
                        ))}
                        {form.images.length < 10 && (
                            <ImageUpload folder="catalog" onUploaded={(url) => set({ images: [...form.images, url] })} label="Add image" />
                        )}
                    </div>
                </section>

                <section className="card space-y-3">
                    <div className="flex items-center justify-between">
                        <div>
                            <h2 className="font-semibold">Variants</h2>
                            <p className="text-xs text-slate-500">
                                Pack sizes, models or colours. Prices in ₹.
                                {isEdit && ' Stock for existing variants changes on the Inventory page.'}
                            </p>
                        </div>
                        <button type="button" className="btn-ghost" onClick={() => set({ variants: [...form.variants, blankVariant()] })}>
                            + Add variant
                        </button>
                    </div>
                    <div className="overflow-x-auto">
                        <table className="w-full min-w-[960px] text-sm">
                            <thead className="text-left text-xs text-slate-500">
                                <tr>
                                    <th className="py-1 pr-2 font-medium">Label</th>
                                    <th className="py-1 pr-2 font-medium">SKU</th>
                                    <th className="py-1 pr-2 font-medium">Qty</th>
                                    <th className="py-1 pr-2 font-medium">Unit</th>
                                    <th className="py-1 pr-2 font-medium">Selling ₹</th>
                                    <th className="py-1 pr-2 font-medium">Offer ₹</th>
                                    <th className="py-1 pr-2 font-medium">Stock</th>
                                    <th className="py-1 pr-2 font-medium">Low at</th>
                                    <th className="py-1 pr-2 font-medium">Max/order</th>
                                    {isElectronics && <th className="py-1 pr-2 font-medium">Options</th>}
                                    <th className="py-1 pr-2 font-medium">On</th>
                                    <th />
                                </tr>
                            </thead>
                            <tbody>
                                {form.variants.map((v, i) => (
                                    <tr key={v.key} className="align-top">
                                        <td className="py-1 pr-2">
                                            <input className="input" aria-label={`Variant ${i + 1} label`} placeholder="1 kg" value={v.label} onChange={(e) => setVariant(v.key, { label: e.target.value })} required />
                                        </td>
                                        <td className="py-1 pr-2 w-28">
                                            <input className="input" aria-label={`Variant ${i + 1} SKU`} value={v.sku} onChange={(e) => setVariant(v.key, { sku: e.target.value })} />
                                        </td>
                                        <td className="py-1 pr-2 w-20">
                                            <input className="input" type="number" min="0" step="any" aria-label={`Variant ${i + 1} quantity`} value={v.unitQty} onChange={(e) => setVariant(v.key, { unitQty: e.target.value })} />
                                        </td>
                                        <td className="py-1 pr-2 w-24">
                                            <select className="input" aria-label={`Variant ${i + 1} unit`} value={v.unit} onChange={(e) => setVariant(v.key, { unit: e.target.value })}>
                                                {UNITS.map((u) => <option key={u}>{u}</option>)}
                                            </select>
                                        </td>
                                        <td className="py-1 pr-2 w-24">
                                            <input className="input" type="number" min="0" step="0.01" aria-label={`Variant ${i + 1} selling price`} value={v.price} onChange={(e) => setVariant(v.key, { price: e.target.value })} required />
                                        </td>
                                        <td className="py-1 pr-2 w-24">
                                            <input className="input" type="number" min="0" step="0.01" aria-label={`Variant ${i + 1} offer price`} value={v.offerPrice} onChange={(e) => setVariant(v.key, { offerPrice: e.target.value })} />
                                        </td>
                                        <td className="py-1 pr-2 w-20">
                                            <input
                                                className="input"
                                                type="number"
                                                min="0"
                                                step="1"
                                                aria-label={`Variant ${i + 1} stock`}
                                                value={v.stockQty}
                                                disabled={Boolean(v._id)}
                                                title={v._id ? 'Change stock on the Inventory page' : 'Opening stock'}
                                                onChange={(e) => setVariant(v.key, { stockQty: e.target.value })}
                                            />
                                        </td>
                                        <td className="py-1 pr-2 w-20">
                                            <input className="input" type="number" min="0" step="1" aria-label={`Variant ${i + 1} low-stock level`} value={v.lowStockThreshold} onChange={(e) => setVariant(v.key, { lowStockThreshold: e.target.value })} />
                                        </td>
                                        <td className="py-1 pr-2 w-20">
                                            <input className="input" type="number" min="1" step="1" aria-label={`Variant ${i + 1} max per order`} placeholder="—" value={v.maxPerOrder} onChange={(e) => setVariant(v.key, { maxPerOrder: e.target.value })} />
                                        </td>
                                        {isElectronics && (
                                            <td className="py-1 pr-2">
                                                <input className="input" aria-label={`Variant ${i + 1} options`} placeholder="colour: Black, storage: 128 GB" value={v.options} onChange={(e) => setVariant(v.key, { options: e.target.value })} />
                                            </td>
                                        )}
                                        <td className="py-3 pr-2">
                                            <input type="checkbox" aria-label={`Variant ${i + 1} active`} checked={v.isActive} onChange={(e) => setVariant(v.key, { isActive: e.target.checked })} />
                                        </td>
                                        <td className="py-1">
                                            {form.variants.length > 1 && (
                                                <button type="button" className="btn-ghost px-2" aria-label={`Remove variant ${i + 1}`} onClick={() => set({ variants: form.variants.filter((x) => x.key !== v.key) })}>
                                                    ✕
                                                </button>
                                            )}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </section>

                {isElectronics && (
                    <section className="card space-y-3">
                        <div className="flex items-center justify-between">
                            <h2 className="font-semibold">Specifications</h2>
                            <button type="button" className="btn-ghost" onClick={() => set({ specifications: [...form.specifications, { key: '', value: '' }] })}>
                                + Add row
                            </button>
                        </div>
                        {form.specifications.map((s, i) => (
                            <div key={i} className="flex gap-2">
                                <input className="input" placeholder="Screen size" aria-label={`Specification ${i + 1} name`} value={s.key} onChange={(e) => set({ specifications: form.specifications.map((x, j) => (j === i ? { ...x, key: e.target.value } : x)) })} />
                                <input className="input" placeholder="43 inch" aria-label={`Specification ${i + 1} value`} value={s.value} onChange={(e) => set({ specifications: form.specifications.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)) })} />
                                <button type="button" className="btn-ghost px-2" aria-label={`Remove specification ${i + 1}`} onClick={() => set({ specifications: form.specifications.filter((_, j) => j !== i) })}>✕</button>
                            </div>
                        ))}
                    </section>
                )}

                <section className="card grid gap-4 sm:grid-cols-2">
                    {isElectronics && (
                        <div>
                            <label className="label" htmlFor="p-warranty">Warranty</label>
                            <textarea id="p-warranty" className="input" rows={3} value={form.warranty} onChange={(e) => set({ warranty: e.target.value })} maxLength={1000} />
                        </div>
                    )}
                    <div>
                        <label className="label" htmlFor="p-return">Return policy</label>
                        <textarea id="p-return" className="input" rows={3} value={form.returnPolicy} onChange={(e) => set({ returnPolicy: e.target.value })} maxLength={1000} />
                    </div>
                    {isProduce && (
                        <>
                            <div>
                                <label className="label" htmlFor="p-avail">Seasonal availability</label>
                                <input id="p-avail" className="input" placeholder="e.g. Available Nov–Feb" value={form.availabilityNote} onChange={(e) => set({ availabilityNote: e.target.value })} maxLength={300} />
                            </div>
                            <div>
                                <label className="label" htmlFor="p-handling">Handling note</label>
                                <input id="p-handling" className="input" placeholder="e.g. Refrigerate after delivery" value={form.handlingNote} onChange={(e) => set({ handlingNote: e.target.value })} maxLength={300} />
                            </div>
                        </>
                    )}
                </section>
            </fieldset>
        </form>
    );
}
