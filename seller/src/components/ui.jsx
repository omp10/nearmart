import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ImagePlus, Loader2, X } from 'lucide-react';
import { api, errorMessage } from '../lib/api.js';

export function ErrorNote({ error }) {
    if (!error) return null;
    return (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
            {errorMessage(error)}
        </p>
    );
}

/** A field's message from the API's validation `details`, shown under the field. */
export function FieldError({ errors, path }) {
    const message = errors?.[path];
    if (!message) return null;
    return <p id={`${path}-error`} className="mt-1 text-xs text-red-600" role="alert">{message}</p>;
}

/** Label + control + hint + field error, the shape of every form row. */
export function Field({ label, htmlFor, hint, errors, path, className = '', children }) {
    return (
        <div className={className}>
            {label && <label className="label" htmlFor={htmlFor}>{label}</label>}
            {children}
            {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
            <FieldError errors={errors} path={path} />
        </div>
    );
}

export function Badge({ tone = 'slate', children }) {
    const tones = {
        slate: 'bg-slate-100 text-slate-600',
        green: 'bg-brand-50 text-brand-700',
        amber: 'bg-amber-50 text-amber-700',
        red: 'bg-red-50 text-red-700',
        blue: 'bg-sky-50 text-sky-700'
    };
    return <span className={`inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${tones[tone]}`}>{children}</span>;
}

/** A coloured box for important messages (rejection reason, paused store, tips). */
export function Notice({ tone = 'slate', title, icon: Icon, children, action }) {
    const tones = {
        slate: 'border-slate-200 bg-white text-slate-700',
        green: 'border-brand-100 bg-brand-50 text-brand-800',
        amber: 'border-amber-200 bg-amber-50 text-amber-900',
        red: 'border-red-200 bg-red-50 text-red-800',
        blue: 'border-sky-200 bg-sky-50 text-sky-900'
    };
    return (
        <div className={`flex flex-wrap items-start gap-3 rounded-xl border px-4 py-3 text-sm ${tones[tone]}`} role={tone === 'red' ? 'alert' : 'status'}>
            {Icon && <Icon className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />}
            <div className="min-w-0 flex-1">
                {title && <p className="font-semibold">{title}</p>}
                {children && <div className={title ? 'mt-0.5' : ''}>{children}</div>}
            </div>
            {action}
        </div>
    );
}

export function Loading({ label = 'Loading…' }) {
    return (
        <p className="flex items-center gap-2 text-sm text-slate-500" role="status">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            {label}
        </p>
    );
}

export function PageHeader({ title, subtitle, back, actions }) {
    return (
        <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="min-w-0">
                {back}
                <h1 className="text-2xl font-semibold">{title}</h1>
                {subtitle && <p className="mt-0.5 text-sm text-slate-500">{subtitle}</p>}
            </div>
            {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
        </div>
    );
}

export function StatCard({ label, value, hint, icon: Icon, tone = 'slate', to, as: As = 'div', ...rest }) {
    const tones = {
        slate: 'bg-slate-100 text-slate-600',
        green: 'bg-brand-50 text-brand-700',
        amber: 'bg-amber-50 text-amber-700',
        red: 'bg-red-50 text-red-700',
        blue: 'bg-sky-50 text-sky-700'
    };
    return (
        <As className={`card flex items-start gap-4 p-4 ${to ? 'transition hover:border-brand-200 hover:shadow' : ''}`} {...(to ? { to } : {})} {...rest}>
            {Icon && (
                <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-lg ${tones[tone]}`}>
                    <Icon className="h-5 w-5" strokeWidth={1.8} aria-hidden="true" />
                </span>
            )}
            <span className="min-w-0">
                <span className="block text-xs font-medium text-slate-500">{label}</span>
                <span className="block truncate text-xl font-semibold tabular-nums text-slate-900">{value}</span>
                {hint && <span className="block text-xs text-slate-500">{hint}</span>}
            </span>
        </As>
    );
}

/** Native <dialog>: focus trapping, Esc to close and the backdrop come from the browser. */
export function Modal({ open, title, onClose, children, wide = false }) {
    const ref = useRef(null);
    useEffect(() => {
        const dialog = ref.current;
        if (!dialog) return;
        if (open && !dialog.open) dialog.showModal();
        if (!open && dialog.open) dialog.close();
    }, [open]);

    return (
        <dialog
            ref={ref}
            onClose={onClose}
            className={`m-auto w-[calc(100%-2rem)] rounded-xl p-0 shadow-xl backdrop:bg-slate-900/40 ${wide ? 'max-w-3xl' : 'max-w-lg'}`}
        >
            {open && (
                <div className="p-5">
                    <div className="mb-4 flex items-center justify-between gap-3">
                        <h2 className="text-lg font-semibold">{title}</h2>
                        <button type="button" className="btn-ghost px-2" onClick={onClose} aria-label="Close">
                            <X className="h-4 w-4" aria-hidden="true" />
                        </button>
                    </div>
                    {children}
                </div>
            )}
        </dialog>
    );
}

/** Uploads one image to /uploads/image?folder=catalog and hands back its URL. */
export function ImageUpload({ onUploaded, label = 'Upload image', folder = 'catalog' }) {
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');

    const onChange = async (e) => {
        const file = e.target.files?.[0];
        e.target.value = '';
        if (!file) return;
        setBusy(true);
        setError('');
        try {
            const form = new FormData();
            form.append('file', file);
            const res = await api.post('/uploads/image', form, { params: { folder } });
            onUploaded(res.data.data.url);
        } catch (err) {
            setError(errorMessage(err, 'Upload failed'));
        } finally {
            setBusy(false);
        }
    };

    return (
        <div>
            <label className={`btn-ghost cursor-pointer border border-dashed border-slate-300 bg-white ${busy ? 'opacity-60' : ''}`}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <ImagePlus className="h-4 w-4" aria-hidden="true" />}
                {busy ? 'Uploading…' : label}
                <input type="file" accept="image/jpeg,image/png,image/webp,image/gif" className="sr-only" onChange={onChange} disabled={busy} />
            </label>
            {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
        </div>
    );
}

/** One image (logo, cover) with a preview, replace and remove. */
export function ImageField({ value, onChange, label, wide = false, disabled = false }) {
    return (
        <div className="flex flex-wrap items-center gap-3">
            {value ? (
                <div className="relative">
                    <img src={value} alt={label} className={`rounded-lg border border-slate-200 object-cover ${wide ? 'h-20 w-40' : 'h-20 w-20'}`} />
                    {!disabled && (
                        <button type="button" className="absolute right-1 top-1 rounded bg-white/90 p-0.5 shadow" aria-label={`Remove ${label}`} onClick={() => onChange('')}>
                            <X className="h-3.5 w-3.5" aria-hidden="true" />
                        </button>
                    )}
                </div>
            ) : (
                <div className={`grid place-items-center rounded-lg border border-dashed border-slate-300 bg-slate-50 text-xs text-slate-400 ${wide ? 'h-20 w-40' : 'h-20 w-20'}`}>No image</div>
            )}
            {!disabled && <ImageUpload onUploaded={onChange} label={value ? 'Change' : `Upload ${label.toLowerCase()}`} />}
        </div>
    );
}

export function Pager({ page, pages, onChange }) {
    if (!pages || pages <= 1) return null;
    return (
        <div className="flex items-center justify-end gap-2 text-sm">
            <button type="button" className="btn-ghost" disabled={page <= 1} onClick={() => onChange(page - 1)}>Previous</button>
            <span className="text-slate-500">Page {page} of {pages}</span>
            <button type="button" className="btn-ghost" disabled={page >= pages} onClick={() => onChange(page + 1)}>Next</button>
        </div>
    );
}

/** From–to date filter, as YYYY-MM-DD strings. */
export function DateRange({ from, to, onChange }) {
    return (
        <div className="flex flex-wrap items-end gap-2">
            <div>
                <label className="label text-xs" htmlFor="range-from">From</label>
                <input id="range-from" type="date" className="input" value={from} max={to || undefined} onChange={(e) => onChange({ from: e.target.value, to })} />
            </div>
            <div>
                <label className="label text-xs" htmlFor="range-to">To</label>
                <input id="range-to" type="date" className="input" value={to} min={from || undefined} onChange={(e) => onChange({ from, to: e.target.value })} />
            </div>
            {(from || to) && (
                <button type="button" className="btn-ghost" onClick={() => onChange({ from: '', to: '' })}>Clear dates</button>
            )}
        </div>
    );
}

/** Debounces a fast-changing value such as a search box. */
export function useDebounced(value, ms = 300) {
    const [debounced, setDebounced] = useState(value);
    useEffect(() => {
        const t = setTimeout(() => setDebounced(value), ms);
        return () => clearTimeout(t);
    }, [value, ms]);
    return debounced;
}

/** Category tree of one of the seller's approved shops. */
export function useCategoryTree(module) {
    return useQuery({
        queryKey: ['categories', module],
        queryFn: () => api.get('/seller/catalog/categories', { params: { module } }).then((r) => r.data.data),
        enabled: Boolean(module),
        staleTime: 5 * 60_000
    });
}

/** Shops and their top-level categories, for choosing where to sell. */
export function useShopOptions() {
    return useQuery({
        queryKey: ['shop-options'],
        queryFn: () => api.get('/seller/catalog/modules').then((r) => r.data.data),
        staleTime: 10 * 60_000
    });
}

/**
 * Tree → [{ id, label: 'Staples › Flours', rootId }] for <select>s. `allowedRoots`
 * (top-level category ids) narrows it to the categories a seller was approved for.
 */
export const flattenTree = (nodes, allowedRoots = [], trail = [], rootId = null) =>
    nodes.flatMap((n) => {
        const root = rootId ?? String(n._id);
        if (!rootId && allowedRoots.length && !allowedRoots.map(String).includes(root)) return [];
        return [
            { id: String(n._id), label: [...trail, n.name].join(' › '), rootId: root, isActive: n.isActive },
            ...flattenTree(n.children ?? [], allowedRoots, [...trail, n.name], root)
        ];
    });
