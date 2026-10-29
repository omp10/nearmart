import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router';
import { AlertTriangle, Check, Clock, Plus, Star, Trash2, X } from 'lucide-react';
import { useAuth } from '../auth/AuthProvider.jsx';
import { api, fieldErrors } from '../lib/api.js';
import { paiseToRupees, rupeesToPaise } from '../lib/money.js';
import { approvedShops, shopLabel } from '../lib/shops.js';
import { ErrorNote, Field, FieldError, ImageUpload, Loading, Notice, flattenTree, useCategoryTree } from '../components/ui.jsx';

const UNITS = ['kg', 'g', 'l', 'ml', 'piece', 'pack', 'bunch', 'dozen', 'box'];
const UNIT_LABELS = { kg: 'kg', g: 'grams', l: 'litre', ml: 'ml', piece: 'piece', pack: 'pack', bunch: 'bunch', dozen: 'dozen', box: 'box' };
const GST_RATES = [0, 5, 12, 18, 28];

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
    category: String(p.category ?? ''),
    name: p.name ?? '',
    brand: p.brand ?? '',
    modelNumber: p.modelNumber ?? '',
    description: p.description ?? '',
    images: p.images ?? [],
    specifications: p.specifications ?? [],
    warranty: p.warranty ?? '',
    returnPolicy: p.returnPolicy ?? '',
    availabilityNote: p.availabilityNote ?? '',
    handlingNote: p.handlingNote ?? '',
    tags: (p.tags ?? []).join(', '),
    gstRate: p.gstRate ?? 0,
    isActive: p.isActive,
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
    warranty: '', returnPolicy: '', availabilityNote: '', handlingNote: '', tags: '', gstRate: 0, isActive: true,
    variants: [blankVariant()]
});

/** Form state → API body. Returns { error } when a number doesn't parse. */
const toBody = (form, isEdit) => {
    const variants = [];
    for (const v of form.variants) {
        const pricePaise = rupeesToPaise(v.price);
        const offerPricePaise = rupeesToPaise(v.offerPrice);
        const name = v.label || 'this size';
        if (pricePaise == null || Number.isNaN(pricePaise)) return { error: `Enter a price for "${name}"` };
        if (Number.isNaN(offerPricePaise)) return { error: `The offer price for "${name}" is not a number` };
        if (offerPricePaise != null && offerPricePaise >= pricePaise) return { error: `The offer price for "${name}" should be lower than its price` };
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

function VariantCard({ v, index, count, isEdit, isElectronics, errors, onChange, onRemove }) {
    const id = (f) => `v${index}-${f}`;
    const err = (f) => <FieldError errors={errors} path={`variants.${index}.${f}`} />;
    return (
        <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-4">
            <div className="mb-3 flex items-center justify-between gap-2">
                <p className="text-sm font-semibold text-slate-800">{v.label || `Size / option ${index + 1}`}</p>
                <div className="flex items-center gap-3">
                    <label className="flex items-center gap-2 text-sm">
                        <input type="checkbox" className="h-4 w-4 accent-brand-700" checked={v.isActive} onChange={(e) => onChange({ isActive: e.target.checked })} />
                        On sale
                    </label>
                    {count > 1 && (
                        <button type="button" className="btn-ghost px-2 py-1 text-red-600" aria-label={`Remove ${v.label || `option ${index + 1}`}`} onClick={onRemove}>
                            <Trash2 className="h-4 w-4" aria-hidden="true" />
                        </button>
                    )}
                </div>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div className="col-span-2">
                    <label className="label text-xs" htmlFor={id('label')}>Name of this size</label>
                    <input id={id('label')} className="input" placeholder="e.g. 1 kg, 500 ml, Black 128 GB" value={v.label} onChange={(e) => onChange({ label: e.target.value })} required maxLength={80} />
                    {err('label')}
                </div>
                <div>
                    <label className="label text-xs" htmlFor={id('qty')}>Quantity</label>
                    <input id={id('qty')} className="input" type="number" min="0" step="any" inputMode="decimal" value={v.unitQty} onChange={(e) => onChange({ unitQty: e.target.value })} />
                </div>
                <div>
                    <label className="label text-xs" htmlFor={id('unit')}>Unit</label>
                    <select id={id('unit')} className="input" value={v.unit} onChange={(e) => onChange({ unit: e.target.value })}>
                        {UNITS.map((u) => <option key={u} value={u}>{UNIT_LABELS[u]}</option>)}
                    </select>
                </div>
                <div>
                    <label className="label text-xs" htmlFor={id('price')}>Price (MRP) ₹</label>
                    <input id={id('price')} className="input" type="number" min="0" step="0.01" inputMode="decimal" value={v.price} onChange={(e) => onChange({ price: e.target.value })} required />
                    {err('pricePaise')}
                </div>
                <div>
                    <label className="label text-xs" htmlFor={id('offer')}>Offer price ₹</label>
                    <input id={id('offer')} className="input" type="number" min="0" step="0.01" inputMode="decimal" placeholder="Optional" value={v.offerPrice} onChange={(e) => onChange({ offerPrice: e.target.value })} />
                    {err('offerPricePaise')}
                </div>
                <div>
                    <label className="label text-xs" htmlFor={id('stock')}>{v._id ? 'In stock' : 'Opening stock'}</label>
                    <input
                        id={id('stock')}
                        className="input"
                        type="number"
                        min="0"
                        step="1"
                        inputMode="numeric"
                        value={v.stockQty}
                        disabled={Boolean(v._id)}
                        title={v._id ? 'Change stock on the Inventory page' : undefined}
                        onChange={(e) => onChange({ stockQty: e.target.value })}
                    />
                    {v._id && <p className="mt-1 text-[11px] text-slate-500">Change on <Link to="/inventory" className="text-brand-700 underline">Inventory</Link></p>}
                </div>
                <div>
                    <label className="label text-xs" htmlFor={id('low')}>Warn me below</label>
                    <input id={id('low')} className="input" type="number" min="0" step="1" inputMode="numeric" value={v.lowStockThreshold} onChange={(e) => onChange({ lowStockThreshold: e.target.value })} />
                </div>
                <div>
                    <label className="label text-xs" htmlFor={id('sku')}>SKU / code</label>
                    <input id={id('sku')} className="input" placeholder="Optional" value={v.sku} onChange={(e) => onChange({ sku: e.target.value })} maxLength={40} />
                    {err('sku')}
                </div>
                <div>
                    <label className="label text-xs" htmlFor={id('max')}>Max per order</label>
                    <input id={id('max')} className="input" type="number" min="1" step="1" inputMode="numeric" placeholder="No limit" value={v.maxPerOrder} onChange={(e) => onChange({ maxPerOrder: e.target.value })} />
                </div>
                {isElectronics && (
                    <div className="col-span-2 sm:col-span-4">
                        <label className="label text-xs" htmlFor={id('options')}>Options</label>
                        <input id={id('options')} className="input" placeholder="colour: Black, storage: 128 GB" value={v.options} onChange={(e) => onChange({ options: e.target.value })} />
                    </div>
                )}
            </div>
            {isEdit && !v._id && <p className="mt-2 text-xs text-slate-500">New: saved with the product.</p>}
        </div>
    );
}

export default function ProductEditor() {
    const { id } = useParams();
    const isEdit = Boolean(id);
    const [search] = useSearchParams();
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const { seller } = useAuth();
    const shops = approvedShops(seller);
    const [form, setForm] = useState(null);
    const [formError, setFormError] = useState('');
    const location = useLocation();
    const createdMessage = location.state?.created ? location.state.message : null;

    const { data: product, error: loadError } = useQuery({
        queryKey: ['product', id],
        queryFn: () => api.get(`/seller/products/${id}`).then((r) => r.data.data),
        enabled: isEdit
    });

    // Fill the form once per product, so a refetch never throws away typing.
    const [loadedId, setLoadedId] = useState(null);
    useEffect(() => {
        if (isEdit && product && loadedId !== product._id) {
            setForm(fromProduct(product));
            setLoadedId(product._id);
        }
        if (!isEdit && !form && shops.length) {
            const wanted = search.get('module');
            setForm(emptyForm(shops.some((m) => m.key === wanted) ? wanted : shops[0].key));
        }
    }, [isEdit, product, loadedId, form, search, shops]);

    const { data: tree = [], error: treeError } = useCategoryTree(form?.module);
    const allowedRoots = shops.find((m) => m.key === form?.module)?.categories ?? [];
    const categories = flattenTree(tree, allowedRoots);

    const save = useMutation({
        mutationFn: (body) => (isEdit ? api.patch(`/seller/products/${id}`, body) : api.post('/seller/products', body)),
        onSuccess: (res) => {
            queryClient.invalidateQueries({ queryKey: ['products'] });
            queryClient.invalidateQueries({ queryKey: ['inventory'] });
            queryClient.invalidateQueries({ queryKey: ['dashboard'] });
            queryClient.setQueryData(['product', res.data.data._id], res.data.data);
            if (isEdit) setForm(fromProduct(res.data.data));
            // The API's message says whether Nearmart reviews the product before customers see it.
            else navigate(`/products/${res.data.data._id}`, { replace: true, state: { created: true, message: res.data.message } });
        }
    });

    const remove = useMutation({
        mutationFn: () => api.delete(`/seller/products/${id}`),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['products'] });
            queryClient.invalidateQueries({ queryKey: ['inventory'] });
            navigate('/products', { replace: true });
        }
    });

    if (!isEdit && !shops.length) {
        return (
            <div className="space-y-4">
                <Link to="/products" className="text-sm text-slate-500 hover:underline">← Products</Link>
                <Notice tone="amber" title="You can't add products yet" action={<Link to="/shops" className="btn-outline">Shops & categories</Link>}>
                    Products can only be added in shops Nearmart has approved for you.
                </Notice>
            </div>
        );
    }
    if (loadError) return <ErrorNote error={loadError} />;
    if (!form) return <Loading />;

    const errors = fieldErrors(save.error);
    const set = (patch) => setForm((f) => ({ ...f, ...patch }));
    const setVariant = (key, patch) => set({ variants: form.variants.map((v) => (v.key === key ? { ...v, ...patch } : v)) });
    const isElectronics = form.module === 'electronics';
    const isProduce = form.module === 'produce';
    const moduleApproved = shops.some((m) => m.key === form.module);

    const onSubmit = (e) => {
        e.preventDefault();
        setFormError('');
        if (!form.category) return setFormError('Choose a category');
        const { body, error } = toBody(form, isEdit);
        if (error) return setFormError(error);
        return save.mutate(body);
    };

    return (
        <form onSubmit={onSubmit} className="space-y-6 pb-20 md:pb-0">
            <div className="flex flex-wrap items-end justify-between gap-3">
                <div className="min-w-0">
                    <Link to="/products" className="text-sm text-slate-500 hover:underline">← Products</Link>
                    <h1 className="truncate text-2xl font-semibold">{isEdit ? form.name || 'Product' : 'Add a product'}</h1>
                </div>
                <div className="hidden gap-2 md:flex">
                    {isEdit && (
                        <button type="button" className="btn-ghost text-red-600" disabled={remove.isPending} onClick={() => window.confirm('Delete this product for good?') && remove.mutate()}>
                            Delete
                        </button>
                    )}
                    <button type="submit" className="btn-primary px-6" disabled={save.isPending}>{save.isPending ? 'Saving…' : 'Save product'}</button>
                </div>
            </div>

            <ErrorNote error={formError || save.error || remove.error} />
            {save.isSuccess && !save.isPending && (
                <p className="flex items-center gap-1 text-sm text-brand-700" role="status"><Check className="h-4 w-4" aria-hidden="true" />Saved.</p>
            )}
            {createdMessage && !save.isSuccess && (
                <Notice tone={product?.review?.status === 'pending' ? 'amber' : 'green'} icon={product?.review?.status === 'pending' ? Clock : Check}>
                    {createdMessage}
                </Notice>
            )}
            {product?.review?.status === 'pending' && !createdMessage && (
                <Notice tone="amber" icon={Clock} title="Waiting for Nearmart's review">
                    Customers will see this product once Nearmart approves it. You can still edit it meanwhile.
                </Notice>
            )}
            {product?.review?.status === 'rejected' && (
                <Notice tone="red" icon={AlertTriangle} title={`Sent back${product.review.note ? `: ${product.review.note}` : ''}`}>
                    Customers can't see this product. Make the changes Nearmart asked for and save it, or contact Nearmart if you have questions.
                </Notice>
            )}
            {isEdit && !moduleApproved && (
                <Notice tone="amber" title={`You are no longer approved to sell in ${shopLabel(form.module)}`}>
                    This product is hidden from customers. Contact Nearmart if this is a mistake.
                </Notice>
            )}

            <fieldset className="min-w-0 space-y-6">
                <section className="card grid gap-4 sm:grid-cols-2">
                    <Field label="Shop" htmlFor="p-module">
                        <select id="p-module" className="input" value={form.module} disabled={isEdit} onChange={(e) => set({ module: e.target.value, category: '' })}>
                            {(isEdit && !moduleApproved ? [{ key: form.module }] : shops).map((m) => <option key={m.key} value={m.key}>{shopLabel(m.key)}</option>)}
                        </select>
                        {isEdit && <p className="mt-1 text-xs text-slate-500">A product stays in its shop.</p>}
                    </Field>
                    <Field label="Category" htmlFor="p-category" errors={errors} path="category">
                        <select id="p-category" className="input" value={form.category} onChange={(e) => set({ category: e.target.value })} required>
                            <option value="" disabled>Choose a category</option>
                            {categories.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                        </select>
                        {treeError && <p className="mt-1 text-xs text-red-600"><ErrorText error={treeError} /></p>}
                    </Field>
                    <Field label="Product name" htmlFor="p-name" errors={errors} path="name" className="sm:col-span-2" hint="Be specific, e.g. Aashirvaad Whole Wheat Atta">
                        <input id="p-name" className="input" value={form.name} onChange={(e) => set({ name: e.target.value })} required maxLength={160} />
                    </Field>
                    <Field label="Brand" htmlFor="p-brand" errors={errors} path="brand">
                        <input id="p-brand" className="input" value={form.brand} onChange={(e) => set({ brand: e.target.value })} maxLength={80} />
                    </Field>
                    <Field label="GST (already included in your prices)" htmlFor="p-gst" errors={errors} path="gstRate">
                        <select id="p-gst" className="input" value={form.gstRate} onChange={(e) => set({ gstRate: Number(e.target.value) })}>
                            {GST_RATES.map((r) => <option key={r} value={r}>{r}%</option>)}
                        </select>
                    </Field>
                    {isElectronics && (
                        <Field label="Model number" htmlFor="p-model" errors={errors} path="modelNumber">
                            <input id="p-model" className="input" value={form.modelNumber} onChange={(e) => set({ modelNumber: e.target.value })} maxLength={80} />
                        </Field>
                    )}
                    <Field label="Description" htmlFor="p-desc" errors={errors} path="description" className="sm:col-span-2">
                        <textarea id="p-desc" className="input" rows={4} value={form.description} onChange={(e) => set({ description: e.target.value })} maxLength={5000} />
                    </Field>
                    <Field label="Search words" htmlFor="p-tags" errors={errors} path="tags" className="sm:col-span-2" hint="Other names customers might type, separated by commas, e.g. atta, gehu">
                        <input id="p-tags" className="input" value={form.tags} onChange={(e) => set({ tags: e.target.value })} />
                    </Field>
                    <label className="flex items-center gap-2 text-sm sm:col-span-2">
                        <input type="checkbox" className="h-4 w-4 accent-brand-700" checked={form.isActive} onChange={(e) => set({ isActive: e.target.checked })} />
                        Visible to customers
                    </label>
                </section>

                <section className="card space-y-3">
                    <div>
                        <h2 className="font-semibold">Photos</h2>
                        <p className="text-xs text-slate-500">Up to 10. The first photo is the main one. Clear photos on a plain background sell best.</p>
                    </div>
                    <div className="flex flex-wrap items-center gap-3">
                        {form.images.map((url, i) => (
                            <div key={url} className="relative">
                                <img src={url} alt="" className="h-24 w-24 rounded-lg border border-slate-200 object-cover" />
                                {i === 0 ? (
                                    <span className="absolute left-1 top-1 rounded bg-white/90 px-1 text-[10px] font-medium">Main</span>
                                ) : (
                                    <button type="button" className="absolute left-1 top-1 rounded bg-white/90 p-0.5" aria-label="Make main photo" title="Make main photo" onClick={() => set({ images: [url, ...form.images.filter((u) => u !== url)] })}>
                                        <Star className="h-3.5 w-3.5" aria-hidden="true" />
                                    </button>
                                )}
                                <button type="button" className="absolute right-1 top-1 rounded bg-white/90 p-0.5" aria-label="Remove photo" onClick={() => set({ images: form.images.filter((u) => u !== url) })}>
                                    <X className="h-3.5 w-3.5" aria-hidden="true" />
                                </button>
                            </div>
                        ))}
                        {form.images.length < 10 && <ImageUpload onUploaded={(url) => set({ images: [...form.images, url] })} label="Add photo" />}
                    </div>
                    <FieldError errors={errors} path="images" />
                </section>

                <section className="card space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                            <h2 className="font-semibold">Sizes and prices</h2>
                            <p className="text-xs text-slate-500">Add one for each pack size, weight or model you sell.</p>
                        </div>
                        <button type="button" className="btn-outline" onClick={() => set({ variants: [...form.variants, blankVariant()] })}>
                            <Plus className="h-4 w-4" aria-hidden="true" />
                            Add size
                        </button>
                    </div>
                    <FieldError errors={errors} path="variants" />
                    <div className="space-y-3">
                        {form.variants.map((v, i) => (
                            <VariantCard
                                key={v.key}
                                v={v}
                                index={i}
                                count={form.variants.length}
                                isEdit={isEdit}
                                isElectronics={isElectronics}
                                errors={errors}
                                onChange={(patch) => setVariant(v.key, patch)}
                                onRemove={() => set({ variants: form.variants.filter((x) => x.key !== v.key) })}
                            />
                        ))}
                    </div>
                </section>

                {isElectronics && (
                    <section className="card space-y-3">
                        <div className="flex items-center justify-between">
                            <h2 className="font-semibold">Specifications</h2>
                            <button type="button" className="btn-outline" onClick={() => set({ specifications: [...form.specifications, { key: '', value: '' }] })}>
                                <Plus className="h-4 w-4" aria-hidden="true" />
                                Add row
                            </button>
                        </div>
                        {form.specifications.length === 0 && <p className="text-sm text-slate-500">For example Screen size: 43 inch, Power: 1200 W.</p>}
                        {form.specifications.map((s, i) => (
                            <div key={i} className="flex gap-2">
                                <input className="input" placeholder="Screen size" aria-label={`Specification ${i + 1} name`} value={s.key} onChange={(e) => set({ specifications: form.specifications.map((x, j) => (j === i ? { ...x, key: e.target.value } : x)) })} />
                                <input className="input" placeholder="43 inch" aria-label={`Specification ${i + 1} value`} value={s.value} onChange={(e) => set({ specifications: form.specifications.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)) })} />
                                <button type="button" className="btn-ghost px-2" aria-label={`Remove specification ${i + 1}`} onClick={() => set({ specifications: form.specifications.filter((_, j) => j !== i) })}>
                                    <X className="h-4 w-4" aria-hidden="true" />
                                </button>
                            </div>
                        ))}
                    </section>
                )}

                <section className="card grid gap-4 sm:grid-cols-2">
                    {isElectronics && (
                        <Field label="Warranty" htmlFor="p-warranty" errors={errors} path="warranty">
                            <textarea id="p-warranty" className="input" rows={3} value={form.warranty} onChange={(e) => set({ warranty: e.target.value })} maxLength={1000} />
                        </Field>
                    )}
                    <Field label="Return policy" htmlFor="p-return" errors={errors} path="returnPolicy" hint="Optional, e.g. Returnable within 2 days if unopened">
                        <textarea id="p-return" className="input" rows={3} value={form.returnPolicy} onChange={(e) => set({ returnPolicy: e.target.value })} maxLength={1000} />
                    </Field>
                    {isProduce && (
                        <>
                            <Field label="Seasonal availability" htmlFor="p-avail" errors={errors} path="availabilityNote">
                                <input id="p-avail" className="input" placeholder="e.g. Available Nov–Feb" value={form.availabilityNote} onChange={(e) => set({ availabilityNote: e.target.value })} maxLength={300} />
                            </Field>
                            <Field label="Handling note" htmlFor="p-handling" errors={errors} path="handlingNote">
                                <input id="p-handling" className="input" placeholder="e.g. Refrigerate after delivery" value={form.handlingNote} onChange={(e) => set({ handlingNote: e.target.value })} maxLength={300} />
                            </Field>
                        </>
                    )}
                </section>
            </fieldset>

            <div className="fixed inset-x-0 bottom-0 z-10 flex justify-end gap-2 border-t border-slate-200 bg-white/95 p-3 backdrop-blur md:hidden">
                {isEdit && (
                    <button type="button" className="btn-ghost text-red-600" disabled={remove.isPending} onClick={() => window.confirm('Delete this product for good?') && remove.mutate()}>
                        Delete
                    </button>
                )}
                <button type="submit" className="btn-primary px-6" disabled={save.isPending}>{save.isPending ? 'Saving…' : 'Save product'}</button>
            </div>
        </form>
    );
}

function ErrorText({ error }) {
    return error?.response?.data?.message || 'Could not load categories';
}
