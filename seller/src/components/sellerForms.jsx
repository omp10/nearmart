import { useEffect, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Check, Eye, FileText, LocateFixed, Lock, Trash2, Upload } from 'lucide-react';
import { useAuth } from '../auth/AuthProvider.jsx';
import { api, errorMessage, fieldErrors } from '../lib/api.js';
import { formatDate } from '../lib/format.js';
import { DOCUMENT_TYPES, SHOPS, documentLabel, shopLabel } from '../lib/shops.js';
import { ErrorNote, Field, ImageField, Loading, Modal, useShopOptions } from './ui.jsx';

/**
 * Form sections shared by the application wizard and the Store profile page.
 * Each one saves itself with PATCH /seller/application and keeps the profile
 * in AuthProvider up to date.
 */

export function useSaveApplication(onSaved) {
    const { setSeller } = useAuth();
    const mutation = useMutation({
        mutationFn: (body) => api.patch('/seller/application', body).then((r) => r.data.data),
        onSuccess: (profile) => {
            setSeller(profile);
            onSaved?.(profile);
        }
    });
    return { ...mutation, errors: fieldErrors(mutation.error) };
}

/** Field names for KYC problems the API reports on the whole profile (paths from kycProblems). */
const KYC_LABELS = { 'legal.pan': 'PAN (tax details)', 'legal.gstin': 'GSTIN (tax details)', 'legal.fssai': 'FSSAI licence (tax details)', 'bank.ifsc': 'IFSC (bank details)' };

/**
 * The message above a form. Field errors show under their fields; this keeps
 * a short pointer to them, plus any problem in a section this form doesn't
 * show (the API checks tax and bank details together).
 */
function formError(save, ownPaths) {
    const entries = Object.entries(save.errors);
    if (!entries.length) return save.error;
    const elsewhere = entries.filter(([path]) => !ownPaths.includes(path));
    if (!elsewhere.length) return 'Please fix the fields marked below.';
    return elsewhere.map(([path, message]) => `${KYC_LABELS[path] ?? path}: ${message}`).join(' ');
}

/** Red border and screen-reader link for a field the API rejected. */
const invalidProps = (errors, path) => (errors?.[path] ? { 'aria-invalid': true, 'aria-describedby': `${path}-error` } : {});
const invalidClass = (errors, path) => (errors?.[path] ? 'border-red-400 focus:border-red-500 focus:ring-red-50' : '');

function SaveBar({ save, label = 'Save', savedText = 'Saved.', extra }) {
    return (
        <div className="flex flex-wrap items-center justify-end gap-3 border-t border-slate-100 pt-4">
            {save.isSuccess && !save.isPending && (
                <span className="flex items-center gap-1 text-sm text-brand-700" role="status">
                    <Check className="h-4 w-4" aria-hidden="true" />
                    {savedText}
                </span>
            )}
            {extra}
            <button type="submit" className="btn-primary" disabled={save.isPending}>
                {save.isPending ? 'Saving…' : label}
            </button>
        </div>
    );
}

function ReadOnly({ label, value, note }) {
    return (
        <div>
            <span className="label flex items-center gap-1.5">
                {label}
                <Lock className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
            </span>
            <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">{value || '—'}</p>
            {note && <p className="mt-1 text-xs text-slate-500">{note}</p>}
        </div>
    );
}

// ─── Business details ───

/**
 * `mode="application"`: name, owner, description, support phone, logo.
 * `mode="store"`: the business name is fixed after approval; adds timings and a cover photo.
 */
export function BusinessForm({ seller, mode = 'application', submitLabel, onSaved }) {
    const isStore = mode === 'store';
    const [form, setForm] = useState(() => ({
        businessName: seller.businessName ?? '',
        ownerName: seller.ownerName ?? '',
        description: seller.store?.description ?? '',
        supportPhone: seller.store?.supportPhone ?? '',
        timings: seller.store?.timings ?? '',
        logo: seller.store?.logo ?? '',
        cover: seller.store?.cover ?? ''
    }));
    const save = useSaveApplication(onSaved);
    const set = (patch) => setForm((f) => ({ ...f, ...patch }));
    const e = save.errors;

    const onSubmit = (ev) => {
        ev.preventDefault();
        const store = { description: form.description, supportPhone: form.supportPhone, logo: form.logo };
        if (isStore) Object.assign(store, { timings: form.timings, cover: form.cover });
        save.mutate({ ...(isStore ? {} : { businessName: form.businessName }), ownerName: form.ownerName, store });
    };

    return (
        <form onSubmit={onSubmit} className="space-y-4">
            <ErrorNote error={save.error} />
            <div className="grid gap-4 sm:grid-cols-2">
                {isStore ? (
                    <ReadOnly label="Business name" value={seller.businessName} note="To change it, contact Nearmart support." />
                ) : (
                    <Field label="Business name" htmlFor="b-name" errors={e} path="businessName" hint="As customers will see it, e.g. Sharma General Store">
                        <input id="b-name" className="input" value={form.businessName} onChange={(ev) => set({ businessName: ev.target.value })} required minLength={2} maxLength={120} />
                    </Field>
                )}
                <Field label="Owner's name" htmlFor="b-owner" errors={e} path="ownerName">
                    <input id="b-owner" className="input" value={form.ownerName} onChange={(ev) => set({ ownerName: ev.target.value })} required minLength={2} maxLength={80} autoComplete="name" />
                </Field>
                <Field label="About your store" htmlFor="b-desc" errors={e} path="store.description" className="sm:col-span-2" hint="A line or two about what you sell. Shown on your store page.">
                    <textarea id="b-desc" className="input" rows={3} value={form.description} onChange={(ev) => set({ description: ev.target.value })} maxLength={1000} />
                </Field>
                <Field label="Phone for customers and delivery partners" htmlFor="b-phone" errors={e} path="store.supportPhone" hint="Leave blank to use your sign-up number.">
                    <input id="b-phone" className="input" type="tel" inputMode="tel" value={form.supportPhone} onChange={(ev) => set({ supportPhone: ev.target.value })} maxLength={20} placeholder="98765 43210" />
                </Field>
                {isStore && (
                    <Field label="Timings shown to customers" htmlFor="b-timings" errors={e} path="store.timings" hint='Text only, e.g. "8 AM – 10 PM, closed Sunday". The hours that decide when you take orders are under Opening hours.'>
                        <input id="b-timings" className="input" value={form.timings} onChange={(ev) => set({ timings: ev.target.value })} maxLength={200} />
                    </Field>
                )}
                <div className="sm:col-span-2">
                    <span className="label">Store logo</span>
                    <ImageField label="Logo" value={form.logo} onChange={(logo) => set({ logo })} />
                    <FieldErrorLine errors={e} path="store.logo" />
                </div>
                {isStore && (
                    <div className="sm:col-span-2">
                        <span className="label">Cover photo</span>
                        <ImageField label="Cover" wide value={form.cover} onChange={(cover) => set({ cover })} />
                        <p className="mt-1 text-xs text-slate-500">A wide photo of your shop front or products.</p>
                    </div>
                )}
            </div>
            <SaveBar save={save} label={submitLabel} />
        </form>
    );
}

function FieldErrorLine({ errors, path }) {
    return errors?.[path] ? <p className="mt-1 text-xs text-red-600">{errors[path]}</p> : null;
}

// ─── Shop address ───

export function AddressForm({ seller, submitLabel, onSaved }) {
    const a = seller.address ?? {};
    const [form, setForm] = useState(() => ({
        line1: a.line1 ?? '',
        line2: a.line2 ?? '',
        landmark: a.landmark ?? '',
        city: a.city ?? '',
        state: a.state ?? '',
        pincode: a.pincode ?? '',
        lat: a.lat == null ? '' : String(a.lat),
        lng: a.lng == null ? '' : String(a.lng)
    }));
    const [locating, setLocating] = useState(false);
    const [localError, setLocalError] = useState('');
    const save = useSaveApplication(onSaved);
    const set = (patch) => setForm((f) => ({ ...f, ...patch }));
    const e = save.errors;

    const useMyLocation = () => {
        setLocalError('');
        if (!navigator.geolocation) return setLocalError('This browser cannot share your location. Please type it in.');
        setLocating(true);
        return navigator.geolocation.getCurrentPosition(
            (pos) => {
                setLocating(false);
                set({ lat: pos.coords.latitude.toFixed(6), lng: pos.coords.longitude.toFixed(6) });
            },
            (err) => {
                setLocating(false);
                setLocalError(err.code === 1 ? 'Location permission was denied. Allow it in your browser, or type the location in.' : 'Could not find your location. Try again, or type it in.');
            },
            { enableHighAccuracy: true, timeout: 15000 }
        );
    };

    const onSubmit = (ev) => {
        ev.preventDefault();
        setLocalError('');
        const toCoord = (v) => (v.trim() === '' ? null : Number(v));
        const lat = toCoord(form.lat);
        const lng = toCoord(form.lng);
        if (Number.isNaN(lat) || Number.isNaN(lng)) return setLocalError('Latitude and longitude must be numbers, e.g. 19.076090 and 72.877426.');
        if ((lat == null) !== (lng == null)) return setLocalError('Enter both latitude and longitude, or leave both empty.');
        const pincode = form.pincode.trim();
        if (pincode && !/^\d{6}$/.test(pincode)) return setLocalError('Enter a 6-digit pincode.');
        const { lat: _lat, lng: _lng, pincode: _pin, ...rest } = form;
        return save.mutate({ address: { ...rest, ...(pincode ? { pincode } : {}), lat, lng } });
    };

    const mapUrl = form.lat && form.lng ? `https://www.google.com/maps?q=${encodeURIComponent(form.lat)},${encodeURIComponent(form.lng)}` : null;

    return (
        <form onSubmit={onSubmit} className="space-y-4">
            <ErrorNote error={localError || save.error} />
            <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Shop number, building and street" htmlFor="a-line1" errors={e} path="address.line1" className="sm:col-span-2">
                    <input id="a-line1" className="input" value={form.line1} onChange={(ev) => set({ line1: ev.target.value })} maxLength={200} required autoComplete="address-line1" />
                </Field>
                <Field label="Area / locality" htmlFor="a-line2" errors={e} path="address.line2">
                    <input id="a-line2" className="input" value={form.line2} onChange={(ev) => set({ line2: ev.target.value })} maxLength={200} autoComplete="address-line2" />
                </Field>
                <Field label="Landmark" htmlFor="a-landmark" errors={e} path="address.landmark" hint="Helps delivery partners find you">
                    <input id="a-landmark" className="input" value={form.landmark} onChange={(ev) => set({ landmark: ev.target.value })} maxLength={120} placeholder="Near City Hospital" />
                </Field>
                <Field label="City" htmlFor="a-city" errors={e} path="address.city">
                    <input id="a-city" className="input" value={form.city} onChange={(ev) => set({ city: ev.target.value })} maxLength={80} required autoComplete="address-level2" />
                </Field>
                <Field label="State" htmlFor="a-state" errors={e} path="address.state">
                    <input id="a-state" className="input" value={form.state} onChange={(ev) => set({ state: ev.target.value })} maxLength={80} autoComplete="address-level1" />
                </Field>
                <Field label="Pincode" htmlFor="a-pin" errors={e} path="address.pincode">
                    <input id="a-pin" className="input" inputMode="numeric" pattern="\d{6}" maxLength={6} value={form.pincode} onChange={(ev) => set({ pincode: ev.target.value.replace(/\D/g, '') })} required autoComplete="postal-code" />
                </Field>
            </div>

            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                        <p className="text-sm font-medium text-slate-800">Exact shop location</p>
                        <p className="text-xs text-slate-500">Delivery partners use this to reach your shop. Best done while standing in the shop.</p>
                    </div>
                    <button type="button" className="btn-outline" onClick={useMyLocation} disabled={locating}>
                        <LocateFixed className="h-4 w-4" aria-hidden="true" />
                        {locating ? 'Finding you…' : 'Use my location'}
                    </button>
                </div>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <Field label="Latitude" htmlFor="a-lat" errors={e} path="address.lat">
                        <input id="a-lat" className="input" inputMode="decimal" value={form.lat} onChange={(ev) => set({ lat: ev.target.value })} placeholder="19.076090" />
                    </Field>
                    <Field label="Longitude" htmlFor="a-lng" errors={e} path="address.lng">
                        <input id="a-lng" className="input" inputMode="decimal" value={form.lng} onChange={(ev) => set({ lng: ev.target.value })} placeholder="72.877426" />
                    </Field>
                </div>
                {mapUrl && (
                    <a href={mapUrl} target="_blank" rel="noreferrer" className="mt-2 inline-block text-sm text-brand-700 hover:underline">
                        Check this spot on Google Maps ↗
                    </a>
                )}
            </div>
            <SaveBar save={save} label={submitLabel} />
        </form>
    );
}

// ─── Where you'll sell (application only) ───

export function ShopsForm({ seller, submitLabel, onSaved }) {
    const { data: options, isLoading, error } = useShopOptions();
    const [picked, setPicked] = useState(() =>
        Object.fromEntries((seller.modules ?? []).map((m) => [m.key, (m.categories ?? []).map(String)]))
    );
    const save = useSaveApplication(onSaved);

    const toggleShop = (key) =>
        setPicked((p) => {
            const next = { ...p };
            if (next[key]) delete next[key];
            else next[key] = [];
            return next;
        });
    const toggleCategory = (key, id) =>
        setPicked((p) => ({ ...p, [key]: p[key].includes(id) ? p[key].filter((c) => c !== id) : [...p[key], id] }));

    const onSubmit = (ev) => {
        ev.preventDefault();
        save.mutate({ modules: Object.entries(picked).map(([key, categories]) => ({ key, categories })) });
    };

    if (isLoading) return <Loading />;
    if (error) return <ErrorNote error={error} />;

    return (
        <form onSubmit={onSubmit} className="space-y-4">
            <ErrorNote error={save.error} />
            <p className="text-sm text-slate-600">Pick the Nearmart shops your products belong in. Nearmart approves each shop separately.</p>
            <div className="space-y-3">
                {options.map((shop) => {
                    const meta = SHOPS[shop.key];
                    const Icon = meta?.icon;
                    const on = Boolean(picked[shop.key]);
                    return (
                        <div key={shop.key} className={`rounded-xl border p-4 transition ${on ? 'border-brand-500 bg-brand-50/40' : 'border-slate-200 bg-white'}`}>
                            <label className="flex cursor-pointer items-start gap-3">
                                <input type="checkbox" className="mt-1 h-4 w-4 accent-brand-700" checked={on} onChange={() => toggleShop(shop.key)} />
                                {Icon && <Icon className={`mt-0.5 h-5 w-5 ${meta.tint}`} aria-hidden="true" />}
                                <span>
                                    <span className="block font-medium text-slate-900">{shopLabel(shop.key)}</span>
                                    <span className="block text-xs text-slate-500">{meta?.blurb}</span>
                                </span>
                            </label>
                            {on && shop.categories.length > 0 && (
                                <div className="mt-3 pl-7">
                                    <p className="mb-2 text-xs text-slate-500">Which categories? Leave all unticked to sell in any category.</p>
                                    <div className="flex flex-wrap gap-2">
                                        {shop.categories.map((c) => {
                                            const active = picked[shop.key].includes(c.id);
                                            return (
                                                <button
                                                    key={c.id}
                                                    type="button"
                                                    aria-pressed={active}
                                                    onClick={() => toggleCategory(shop.key, c.id)}
                                                    className={`rounded-full border px-3 py-1 text-xs font-medium transition ${active ? 'border-brand-700 bg-brand-700 text-white' : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'}`}
                                                >
                                                    {active && '✓ '}
                                                    {c.name}
                                                </button>
                                            );
                                        })}
                                    </div>
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>
            <SaveBar save={save} label={submitLabel} />
        </form>
    );
}

// ─── Tax numbers ───

export function TaxForm({ seller, submitLabel, onSaved, locked = false }) {
    const [form, setForm] = useState(() => ({ pan: seller.legal?.pan ?? '', gstin: seller.legal?.gstin ?? '', fssai: seller.legal?.fssai ?? '' }));
    const save = useSaveApplication(onSaved);
    const set = (patch) => setForm((f) => ({ ...f, ...patch }));
    const e = save.errors;

    if (locked) {
        return (
            <div className="grid gap-4 sm:grid-cols-3">
                <ReadOnly label="PAN" value={seller.legal?.pan} />
                <ReadOnly label="GSTIN" value={seller.legal?.gstin} />
                <ReadOnly label="FSSAI licence" value={seller.legal?.fssai} />
                <p className="text-xs text-slate-500 sm:col-span-3">Tax details were checked when Nearmart approved your store. To change them, contact Nearmart support.</p>
            </div>
        );
    }

    return (
        <form
            onSubmit={(ev) => {
                ev.preventDefault();
                save.mutate({ legal: { pan: form.pan.trim().toUpperCase(), gstin: form.gstin.trim().toUpperCase(), fssai: form.fssai.trim() } });
            }}
            className="space-y-4"
        >
            <ErrorNote error={formError(save, ['legal.pan', 'legal.gstin', 'legal.fssai'])} />
            <div className="grid gap-4 sm:grid-cols-3">
                <Field label="PAN (required)" htmlFor="t-pan" errors={e} path="legal.pan" hint="10 characters, e.g. ABCDE1234F">
                    <input id="t-pan" className={`input uppercase ${invalidClass(e, 'legal.pan')}`} {...invalidProps(e, 'legal.pan')} value={form.pan} onChange={(ev) => set({ pan: ev.target.value.toUpperCase().replace(/\s/g, '') })} maxLength={12} autoCapitalize="characters" autoComplete="off" spellCheck={false} />
                </Field>
                <Field label="GSTIN" htmlFor="t-gst" errors={e} path="legal.gstin" hint="15 characters, if you are GST registered">
                    <input id="t-gst" className={`input uppercase ${invalidClass(e, 'legal.gstin')}`} {...invalidProps(e, 'legal.gstin')} value={form.gstin} onChange={(ev) => set({ gstin: ev.target.value.toUpperCase().replace(/\s/g, '') })} maxLength={20} autoCapitalize="characters" autoComplete="off" spellCheck={false} />
                </Field>
                <Field label="FSSAI licence" htmlFor="t-fssai" errors={e} path="legal.fssai" hint="14 digits. Needed if you sell food">
                    <input id="t-fssai" className={`input ${invalidClass(e, 'legal.fssai')}`} {...invalidProps(e, 'legal.fssai')} inputMode="numeric" value={form.fssai} onChange={(ev) => set({ fssai: ev.target.value.replace(/\s/g, '') })} maxLength={20} autoComplete="off" />
                </Field>
            </div>
            <SaveBar save={save} label={submitLabel} />
        </form>
    );
}

// ─── Documents ───

/** Opens a private document (served only to its owner) as a blob preview. */
function DocumentPreview({ doc, onClose }) {
    const [state, setState] = useState({ url: null, type: '', error: null });

    useEffect(() => {
        if (!doc) return undefined;
        let url = null;
        let cancelled = false;
        setState({ url: null, type: '', error: null });
        api.get(`/seller/documents/${doc._id}`, { responseType: 'blob' })
            .then((res) => {
                if (cancelled) return;
                url = URL.createObjectURL(res.data);
                setState({ url, type: res.data.type, error: null });
            })
            .catch(async (err) => {
                // A JSON error body arrives as a blob too.
                let message = errorMessage(err, 'Could not open this document');
                try {
                    const body = JSON.parse(await err.response?.data?.text?.());
                    if (body?.message) message = body.message;
                } catch {
                    // keep the generic message
                }
                if (!cancelled) setState({ url: null, type: '', error: message });
            });
        return () => {
            cancelled = true;
            if (url) URL.revokeObjectURL(url);
        };
    }, [doc]);

    return (
        <Modal open={Boolean(doc)} title={doc ? `${documentLabel(doc.type)}${doc.name ? ` · ${doc.name}` : ''}` : ''} onClose={onClose} wide>
            {state.error && <ErrorNote error={state.error} />}
            {!state.url && !state.error && <Loading label="Opening…" />}
            {state.url && (
                <div className="space-y-3">
                    {state.type === 'application/pdf' ? (
                        <iframe src={state.url} title="Document" className="h-[70vh] w-full rounded-lg border border-slate-200" />
                    ) : (
                        <img src={state.url} alt={documentLabel(doc.type)} className="mx-auto max-h-[70vh] rounded-lg border border-slate-200" />
                    )}
                    <a href={state.url} target="_blank" rel="noreferrer" className="btn-outline">Open in a new tab</a>
                </div>
            )}
        </Modal>
    );
}

export function DocumentsManager({ seller, canRemove }) {
    const { setSeller } = useAuth();
    const [type, setType] = useState('pan');
    const [viewing, setViewing] = useState(null);

    const upload = useMutation({
        mutationFn: (file) => {
            const form = new FormData();
            form.append('type', type);
            form.append('file', file);
            return api.post('/seller/documents', form).then((r) => r.data.data);
        },
        onSuccess: setSeller
    });
    const remove = useMutation({
        mutationFn: (docId) => api.delete(`/seller/documents/${docId}`).then((r) => r.data.data),
        onSuccess: setSeller
    });

    const onFile = (ev) => {
        const file = ev.target.files?.[0];
        ev.target.value = '';
        if (file) upload.mutate(file);
    };

    const docs = seller.documents ?? [];

    return (
        <div className="space-y-4">
            <ErrorNote error={upload.error || remove.error} />
            {docs.length === 0 ? (
                <p className="rounded-lg border border-dashed border-slate-300 px-4 py-6 text-center text-sm text-slate-500">No documents yet.</p>
            ) : (
                <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
                    {docs.map((d) => (
                        <li key={d._id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                            <FileText className="h-5 w-5 shrink-0 text-slate-400" aria-hidden="true" />
                            <div className="min-w-0 flex-1">
                                <p className="text-sm font-medium text-slate-800">{documentLabel(d.type)}</p>
                                <p className="truncate text-xs text-slate-500">{d.name || 'File'} · added {formatDate(d.uploadedAt)}</p>
                            </div>
                            <button type="button" className="btn-ghost px-2 py-1" onClick={() => setViewing(d)}>
                                <Eye className="h-4 w-4" aria-hidden="true" />
                                View
                            </button>
                            {canRemove && (
                                <button
                                    type="button"
                                    className="btn-ghost px-2 py-1 text-red-600"
                                    disabled={remove.isPending}
                                    onClick={() => window.confirm(`Remove ${documentLabel(d.type)}?`) && remove.mutate(d._id)}
                                >
                                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                                    Remove
                                </button>
                            )}
                        </li>
                    ))}
                </ul>
            )}

            <div className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
                <div className="min-w-48 flex-1">
                    <label className="label" htmlFor="doc-type">Document type</label>
                    <select id="doc-type" className="input" value={type} onChange={(ev) => setType(ev.target.value)}>
                        {DOCUMENT_TYPES.map((d) => <option key={d.key} value={d.key}>{d.label}</option>)}
                    </select>
                </div>
                <label className={`btn-primary cursor-pointer ${upload.isPending ? 'pointer-events-none opacity-60' : ''}`}>
                    <Upload className="h-4 w-4" aria-hidden="true" />
                    {upload.isPending ? 'Uploading…' : 'Choose file and upload'}
                    <input type="file" accept="application/pdf,image/jpeg,image/png,image/webp" className="sr-only" onChange={onFile} disabled={upload.isPending} />
                </label>
                <p className="w-full text-xs text-slate-500">PDF or a clear photo (JPG, PNG, WebP), up to 5 MB. Only you and Nearmart can see these.</p>
            </div>
            <DocumentPreview doc={viewing} onClose={() => setViewing(null)} />
        </div>
    );
}

// ─── Bank details ───

export function BankForm({ seller, submitLabel, onSaved, note }) {
    const b = seller.bank ?? {};
    const [form, setForm] = useState(() => ({ accountName: b.accountName ?? '', accountNumber: b.accountNumber ?? '', ifsc: b.ifsc ?? '', upiId: b.upiId ?? '' }));
    const save = useSaveApplication(onSaved);
    const set = (patch) => setForm((f) => ({ ...f, ...patch }));
    const e = save.errors;

    return (
        <form
            onSubmit={(ev) => {
                ev.preventDefault();
                save.mutate({ bank: { accountName: form.accountName.trim(), accountNumber: form.accountNumber.replace(/\s/g, ''), ifsc: form.ifsc.trim().toUpperCase(), upiId: form.upiId.trim() } });
            }}
            className="space-y-4"
        >
            <ErrorNote error={formError(save, ['bank.accountName', 'bank.accountNumber', 'bank.ifsc', 'bank.upiId'])} />
            <p className="text-sm text-slate-600">Where Nearmart sends your money. Give a bank account, a UPI ID, or both.</p>
            {note}
            <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Account holder's name" htmlFor="k-name" errors={e} path="bank.accountName" className="sm:col-span-2">
                    <input id="k-name" className="input" value={form.accountName} onChange={(ev) => set({ accountName: ev.target.value })} maxLength={120} />
                </Field>
                <Field label="Account number" htmlFor="k-number" errors={e} path="bank.accountNumber">
                    <input id="k-number" className="input" inputMode="numeric" value={form.accountNumber} onChange={(ev) => set({ accountNumber: ev.target.value.replace(/[^\d\s]/g, '') })} maxLength={24} autoComplete="off" />
                </Field>
                <Field label="IFSC" htmlFor="k-ifsc" errors={e} path="bank.ifsc" hint="11 characters, e.g. SBIN0001234">
                    <input id="k-ifsc" className={`input uppercase ${invalidClass(e, 'bank.ifsc')}`} {...invalidProps(e, 'bank.ifsc')} value={form.ifsc} onChange={(ev) => set({ ifsc: ev.target.value.toUpperCase().replace(/\s/g, '') })} maxLength={11} autoCapitalize="characters" autoComplete="off" spellCheck={false} />
                </Field>
                <Field label="UPI ID" htmlFor="k-upi" errors={e} path="bank.upiId" className="sm:col-span-2" hint="e.g. yourname@okaxis">
                    <input id="k-upi" className="input" value={form.upiId} onChange={(ev) => set({ upiId: ev.target.value })} maxLength={60} autoComplete="off" />
                </Field>
            </div>
            <SaveBar save={save} label={submitLabel} />
        </form>
    );
}
