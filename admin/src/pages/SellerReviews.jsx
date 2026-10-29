import { useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router';
import { useAuth } from '../auth/AuthProvider.jsx';
import { api } from '../lib/api.js';
import { formatPaise } from '../lib/money.js';
import { ago } from '../lib/riders.js';
import { PRODUCT_REVIEW_LABELS, PRODUCT_REVIEW_TONES } from '../lib/sellers.js';
import { BUSINESS_MODULES } from '../nav.js';
import { Badge, ErrorNote, Modal, Pager } from '../components/ui.jsx';

const MODULE_LABELS = Object.fromEntries(BUSINESS_MODULES.map((m) => [m.id, m.label]));

const TABS = [
    ['pending', 'Waiting'],
    ['rejected', 'Sent back'],
    ['approved', 'Approved']
];

const invalidateReviews = (queryClient) => {
    queryClient.invalidateQueries({ queryKey: ['product-reviews'] });
};

/** Send a product back to the seller with a note on what to change. */
function SendBackForm({ product, onDone }) {
    const queryClient = useQueryClient();
    const [note, setNote] = useState(product.review?.note ?? '');
    const send = useMutation({
        mutationFn: () => api.post(`/admin/sellers/products/${product._id}/review`, { decision: 'rejected', note: note.trim() }),
        onSuccess: () => {
            invalidateReviews(queryClient);
            onDone();
        }
    });

    return (
        <form
            className="space-y-4"
            onSubmit={(e) => {
                e.preventDefault();
                send.mutate();
            }}
        >
            <ErrorNote error={send.error} />
            <p className="text-sm text-slate-600">
                {product.name} stays hidden from customers. {product.sellerName || 'The seller'} is notified and can edit it for another look.
            </p>
            <div>
                <label className="label" htmlFor="review-note">What needs to change (shown to the seller)</label>
                <textarea id="review-note" className="input min-h-24" value={note} onChange={(e) => setNote(e.target.value)} required minLength={3} maxLength={300} />
            </div>
            <div className="flex justify-end gap-2">
                <button type="button" className="btn-ghost" onClick={onDone}>Back</button>
                <button type="submit" className="btn bg-red-600 text-white hover:bg-red-700" disabled={send.isPending || note.trim().length < 3}>
                    {send.isPending ? 'Saving…' : 'Send back'}
                </button>
            </div>
        </form>
    );
}

function ReviewCard({ product, canUpdate, onSendBack }) {
    const { can } = useAuth();
    const queryClient = useQueryClient();
    const approve = useMutation({
        mutationFn: () => api.post(`/admin/sellers/products/${product._id}/review`, { decision: 'approved' }),
        onSuccess: () => invalidateReviews(queryClient)
    });
    const status = product.review?.status ?? 'pending';

    return (
        <li className="card flex flex-col gap-3 text-sm">
            <div className="flex gap-3">
                {product.images?.[0] ? (
                    <img src={product.images[0]} alt="" className="h-20 w-20 shrink-0 rounded object-cover" />
                ) : (
                    <span className="grid h-20 w-20 shrink-0 place-items-center rounded bg-slate-100 text-xs text-slate-400">No image</span>
                )}
                <div className="min-w-0 flex-1">
                    <p className="font-medium">
                        {can('catalog') ? <Link to={`/products/${product._id}`} className="text-brand-700 hover:underline">{product.name}</Link> : product.name}
                    </p>
                    {product.brand && <p className="text-xs text-slate-500">{product.brand}</p>}
                    <p className="text-slate-600">
                        {product.seller ? (
                            <Link to={`/sellers/${product.seller}`} className="hover:underline">{product.sellerName || 'Seller'}</Link>
                        ) : (
                            product.sellerName || '—'
                        )}
                        {' · '}
                        {MODULE_LABELS[product.module] ?? product.module}
                    </p>
                    <p className="text-xs text-slate-500">Added {product.createdAt ? ago(product.createdAt) : '—'}</p>
                </div>
                <span className="shrink-0"><Badge tone={PRODUCT_REVIEW_TONES[status]}>{PRODUCT_REVIEW_LABELS[status] ?? status}</Badge></span>
            </div>
            {product.images?.length > 1 && (
                <div className="flex gap-1 overflow-x-auto">
                    {product.images.slice(1).map((src) => <img key={src} src={src} alt="" className="h-10 w-10 shrink-0 rounded object-cover" />)}
                </div>
            )}
            <ul className="divide-y divide-slate-100 rounded border border-slate-100">
                {!product.variants?.length && <li className="px-3 py-1.5 text-slate-500">No variants</li>}
                {product.variants?.map((v, i) => (
                    <li key={v._id ?? i} className="flex justify-between gap-3 px-3 py-1.5">
                        <span>{v.label || '—'}</span>
                        <span className="tabular-nums">{formatPaise(v.pricePaise)}</span>
                    </li>
                ))}
            </ul>
            {status === 'rejected' && product.review?.note && <p className="rounded bg-red-50 px-2 py-1 text-xs text-red-700">Sent back: {product.review.note}</p>}
            <ErrorNote error={approve.error} />
            {canUpdate && (
                <div className="mt-auto flex justify-end gap-2">
                    {status !== 'rejected' && <button type="button" className="btn-ghost px-2 py-1 text-red-600" onClick={() => onSendBack(product)}>Send back</button>}
                    {status !== 'approved' && (
                        <button type="button" className="btn-primary px-3 py-1" disabled={approve.isPending} onClick={() => approve.mutate()}>
                            {approve.isPending ? 'Approving…' : 'Approve'}
                        </button>
                    )}
                </div>
            )}
        </li>
    );
}

export default function SellerReviews() {
    const { can } = useAuth();
    const [searchParams, setSearchParams] = useSearchParams();
    const status = TABS.some(([t]) => t === searchParams.get('status')) ? searchParams.get('status') : 'pending';
    const [page, setPage] = useState(1);
    const [sendBack, setSendBack] = useState(null);

    const params = { status, page, limit: 24 };
    const { data, isLoading, error } = useQuery({
        queryKey: ['product-reviews', params],
        queryFn: () => api.get('/admin/sellers/products/review', { params }).then((r) => r.data.data),
        placeholderData: keepPreviousData,
        refetchInterval: 60_000
    });
    const canUpdate = can('sellers', 'update');

    return (
        <div className="space-y-6">
            <div>
                <Link to="/sellers" className="text-sm text-slate-500 hover:underline">← Sellers</Link>
                <h1 className="text-2xl font-semibold">Product reviews</h1>
                <p className="text-sm text-slate-500">
                    New products from marketplace sellers wait here when reviews are on (Commission settings). Customers see a product only once it is approved.
                </p>
            </div>

            <div className="flex flex-wrap gap-1 rounded-lg bg-slate-100 p-1" role="tablist" aria-label="Review status">
                {TABS.map(([value, label]) => (
                    <button
                        key={value}
                        type="button"
                        role="tab"
                        aria-selected={status === value}
                        onClick={() => {
                            setSearchParams(value === 'pending' ? {} : { status: value }, { replace: true });
                            setPage(1);
                        }}
                        className={`rounded-md px-3 py-1.5 text-sm font-medium ${status === value ? 'bg-white shadow-sm' : 'text-slate-600'}`}
                    >
                        {label}
                        {data && status === value && <span className="ml-1.5 tabular-nums text-slate-400">{data.total}</span>}
                    </button>
                ))}
            </div>

            <ErrorNote error={error} />
            {isLoading && <p className="text-sm text-slate-500">Loading…</p>}
            {data?.items.length === 0 && (
                <p className="card text-center text-sm text-slate-500">{status === 'pending' ? 'Nothing waiting for review.' : 'No products here.'}</p>
            )}
            <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {data?.items.map((p) => <ReviewCard key={p._id} product={p} canUpdate={canUpdate} onSendBack={setSendBack} />)}
            </ul>
            <Pager page={page} pages={data?.pages} onChange={setPage} />

            <Modal open={Boolean(sendBack)} title={sendBack ? `Send back ${sendBack.name}` : ''} onClose={() => setSendBack(null)}>
                {sendBack && <SendBackForm product={sendBack} onDone={() => setSendBack(null)} />}
            </Modal>
        </div>
    );
}
