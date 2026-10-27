import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, errorMessage } from '../lib/api.js';

export function ErrorNote({ error }) {
    if (!error) return null;
    return (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
            {typeof error === 'string' ? error : errorMessage(error)}
        </p>
    );
}

export function Badge({ tone = 'slate', children }) {
    const tones = {
        slate: 'bg-slate-100 text-slate-600',
        green: 'bg-brand-50 text-brand-700',
        amber: 'bg-amber-50 text-amber-700',
        red: 'bg-red-50 text-red-700'
    };
    return <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${tones[tone]}`}>{children}</span>;
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
                    <div className="mb-4 flex items-center justify-between">
                        <h2 className="text-lg font-semibold">{title}</h2>
                        <button type="button" className="btn-ghost px-2" onClick={onClose} aria-label="Close">✕</button>
                    </div>
                    {children}
                </div>
            )}
        </dialog>
    );
}

export function useModules() {
    return useQuery({
        queryKey: ['modules'],
        queryFn: () => api.get('/admin/catalog/modules').then((r) => r.data.data),
        staleTime: 5 * 60_000
    });
}

export function useCategoryTree(module) {
    return useQuery({
        queryKey: ['categories', module],
        queryFn: () => api.get('/admin/catalog/categories', { params: { module } }).then((r) => r.data.data),
        enabled: Boolean(module)
    });
}

/** Tree → [{ id, label: 'Staples › Flours', depth }] for <select>s. */
export const flattenTree = (nodes, trail = []) =>
    nodes.flatMap((n) => [
        { id: n._id, label: [...trail, n.name].join(' › '), depth: n.depth, isActive: n.isActive },
        ...flattenTree(n.children, [...trail, n.name])
    ]);

const UPLOAD_KINDS = {
    image: { path: '/uploads/image', accept: 'image/jpeg,image/png,image/webp,image/gif' },
    video: { path: '/uploads/video', accept: 'video/mp4,video/webm' }
};

export function ImageUpload({ folder, onUploaded, label = 'Upload image', kind = 'image' }) {
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
            const res = await api.post(UPLOAD_KINDS[kind].path, form, { params: { folder } });
            onUploaded(res.data.data.url);
        } catch (err) {
            setError(errorMessage(err, 'Upload failed'));
        } finally {
            setBusy(false);
        }
    };

    return (
        <div>
            <label className={`btn-ghost cursor-pointer border border-dashed border-slate-300 ${busy ? 'opacity-60' : ''}`}>
                {busy ? 'Uploading…' : label}
                <input type="file" accept={UPLOAD_KINDS[kind].accept} className="sr-only" onChange={onChange} disabled={busy} />
            </label>
            {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
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

/** Debounces a fast-changing value such as a search box. */
export function useDebounced(value, ms = 300) {
    const [debounced, setDebounced] = useState(value);
    useEffect(() => {
        const t = setTimeout(() => setDebounced(value), ms);
        return () => clearTimeout(t);
    }, [value, ms]);
    return debounced;
}
