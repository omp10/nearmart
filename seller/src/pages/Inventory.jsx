import { useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router';
import { Search } from 'lucide-react';
import { useAuth } from '../auth/AuthProvider.jsx';
import { api } from '../lib/api.js';
import { approvedShops, shopLabel } from '../lib/shops.js';
import { Badge, ErrorNote, Modal, PageHeader, Pager, flattenTree, useCategoryTree, useDebounced } from '../components/ui.jsx';

const stockBadge = (row) => {
    if (row.stockQty === 0) return <Badge tone="red">Out of stock</Badge>;
    if (row.stockQty <= row.lowStockThreshold) return <Badge tone="amber">Running low</Badge>;
    return <Badge tone="green">In stock</Badge>;
};

function StockForm({ row, onDone }) {
    const queryClient = useQueryClient();
    const [mode, setMode] = useState('restock'); // restock | remove | count
    const [qty, setQty] = useState('');
    const [note, setNote] = useState('');
    const [threshold, setThreshold] = useState(String(row.lowStockThreshold));
    const base = `/seller/inventory/${row.productId}/variants/${row.variantId}`;

    const save = useMutation({
        mutationFn: async () => {
            const n = Number.parseInt(qty, 10);
            if (qty !== '') {
                if (mode === 'count') await api.put(`${base}/stock`, { quantity: n, note: note || undefined });
                else await api.post(`${base}/adjust`, {
                    delta: mode === 'remove' ? -n : n,
                    reason: mode === 'restock' ? 'restock' : 'adjustment',
                    note: note || undefined
                });
            }
            if (Number(threshold) !== row.lowStockThreshold) {
                await api.patch(`${base}/threshold`, { threshold: Number.parseInt(threshold, 10) || 0 });
            }
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['inventory'] });
            queryClient.invalidateQueries({ queryKey: ['products'] });
            queryClient.invalidateQueries({ queryKey: ['product', row.productId] });
            queryClient.invalidateQueries({ queryKey: ['dashboard'] });
            onDone();
        }
    });

    const preview = (() => {
        const n = Number.parseInt(qty, 10);
        if (!Number.isFinite(n)) return null;
        if (mode === 'count') return n;
        return mode === 'remove' ? row.stockQty - n : row.stockQty + n;
    })();

    return (
        <form
            className="space-y-4"
            onSubmit={(e) => {
                e.preventDefault();
                save.mutate();
            }}
        >
            <p className="text-sm text-slate-600">
                {row.productName} · {row.label}: <strong>{row.stockQty}</strong> in stock now
            </p>
            <ErrorNote error={save.error} />
            <div className="grid grid-cols-3 gap-1 rounded-lg bg-slate-100 p-1" role="radiogroup" aria-label="Type of change">
                {[['restock', 'Add stock'], ['remove', 'Remove'], ['count', 'Set count']].map(([value, label]) => (
                    <button
                        key={value}
                        type="button"
                        role="radio"
                        aria-checked={mode === value}
                        onClick={() => setMode(value)}
                        className={`rounded-md px-3 py-2 text-sm font-medium ${mode === value ? 'bg-white text-brand-700 shadow-sm' : 'text-slate-600'}`}
                    >
                        {label}
                    </button>
                ))}
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
                <div>
                    <label className="label" htmlFor="s-qty">{mode === 'count' ? 'Quantity you counted' : mode === 'remove' ? 'How many to remove' : 'How many to add'}</label>
                    <input id="s-qty" type="number" inputMode="numeric" min={mode === 'count' ? 0 : 1} step="1" className="input text-lg" value={qty} onChange={(e) => setQty(e.target.value)} autoFocus />
                    {preview != null && (
                        <p className={`mt-1 text-xs ${preview < 0 ? 'text-red-600' : 'text-slate-500'}`}>
                            New stock: {preview}{preview < 0 && '. Not enough stock to remove that many.'}
                        </p>
                    )}
                </div>
                <div>
                    <label className="label" htmlFor="s-threshold">Warn me when stock falls to</label>
                    <input id="s-threshold" type="number" inputMode="numeric" min="0" step="1" className="input" value={threshold} onChange={(e) => setThreshold(e.target.value)} />
                </div>
            </div>
            <div>
                <label className="label" htmlFor="s-note">Note (optional)</label>
                <input id="s-note" className="input" placeholder="e.g. New delivery from supplier, damaged packs" value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} />
            </div>
            <div className="flex justify-end gap-2">
                <button type="button" className="btn-ghost" onClick={onDone}>Cancel</button>
                <button type="submit" className="btn-primary" disabled={save.isPending || (preview != null && preview < 0)}>
                    {save.isPending ? 'Saving…' : 'Save'}
                </button>
            </div>
        </form>
    );
}

export default function Inventory() {
    const { seller } = useAuth();
    const shops = approvedShops(seller);
    const [search] = useSearchParams();
    const [filters, setFilters] = useState(() => ({ q: '', module: shops.length === 1 ? shops[0].key : '', category: '', stock: search.get('stock') || '' }));
    const [page, setPage] = useState(1);
    const [editing, setEditing] = useState(null);
    const q = useDebounced(filters.q.trim());
    const { data: tree = [] } = useCategoryTree(filters.module || null);
    const allowedRoots = shops.find((m) => m.key === filters.module)?.categories ?? [];

    const setFilter = (patch) => {
        setFilters((f) => ({ ...f, ...patch }));
        setPage(1);
    };
    const params = { page, limit: 25, q: q || undefined, module: filters.module || undefined, category: filters.category || undefined, stock: filters.stock || undefined };
    const { data, isLoading, error } = useQuery({
        queryKey: ['inventory', params],
        queryFn: () => api.get('/seller/inventory', { params }).then((r) => r.data.data),
        placeholderData: keepPreviousData
    });

    return (
        <div className="space-y-5">
            <PageHeader title="Inventory" subtitle="Stock for every size you sell, lowest first. Update it whenever new stock arrives." />

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <div className="relative lg:col-span-2">
                    <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
                    <input type="search" className="input pl-9" placeholder="Search product, size or SKU" aria-label="Search inventory" value={filters.q} onChange={(e) => setFilter({ q: e.target.value })} />
                </div>
                {shops.length > 1 && (
                    <select className="input" aria-label="Shop" value={filters.module} onChange={(e) => setFilter({ module: e.target.value, category: '' })}>
                        <option value="">All shops</option>
                        {shops.map((m) => <option key={m.key} value={m.key}>{shopLabel(m.key)}</option>)}
                    </select>
                )}
                {filters.module && (
                    <select className="input" aria-label="Category" value={filters.category} onChange={(e) => setFilter({ category: e.target.value })}>
                        <option value="">All categories</option>
                        {flattenTree(tree, allowedRoots).map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                    </select>
                )}
                <select className="input" aria-label="Stock level" value={filters.stock} onChange={(e) => setFilter({ stock: e.target.value })}>
                    <option value="">All stock levels</option>
                    <option value="low">Running low or out</option>
                    <option value="out">Out of stock</option>
                    <option value="in">In stock</option>
                </select>
            </div>

            <ErrorNote error={error} />
            {isLoading && <p className="text-sm text-slate-500">Loading…</p>}
            {data?.items.length === 0 && <div className="card py-10 text-center text-sm text-slate-500">Nothing matches.</div>}

            {data?.items.length > 0 && (
                <>
                    <ul className="space-y-2 md:hidden">
                        {data.items.map((row) => (
                            <li key={row.variantId} className="card flex items-center gap-3 p-3">
                                <div className="min-w-0 flex-1">
                                    <Link to={`/products/${row.productId}`} className="block truncate font-medium text-slate-900">{row.productName}</Link>
                                    <p className="text-xs text-slate-500">{row.label}{row.sku && ` · ${row.sku}`}</p>
                                    <div className="mt-1 flex flex-wrap gap-1">
                                        {stockBadge(row)}
                                        {!row.productActive && <Badge>Hidden</Badge>}
                                    </div>
                                </div>
                                <div className="text-right">
                                    <p className={`text-xl font-semibold tabular-nums ${row.stockQty === 0 ? 'text-red-600' : ''}`}>{row.stockQty}</p>
                                    <button type="button" className="btn-outline mt-1 px-3 py-1 text-xs" onClick={() => setEditing(row)}>Update</button>
                                </div>
                            </li>
                        ))}
                    </ul>

                    <div className="card hidden overflow-x-auto p-0 md:block">
                        <table className="w-full text-sm">
                            <thead className="text-left">
                                <tr>
                                    <th className="px-4 py-3">Product</th>
                                    <th className="px-4 py-3">Size</th>
                                    <th className="px-4 py-3">SKU</th>
                                    <th className="px-4 py-3">Stock</th>
                                    <th className="px-4 py-3">Warn at</th>
                                    <th className="px-4 py-3">Status</th>
                                    <th className="px-4 py-3" />
                                </tr>
                            </thead>
                            <tbody>
                                {data.items.map((row) => (
                                    <tr key={row.variantId} className="border-t border-slate-100">
                                        <td className="px-4 py-3">
                                            <Link to={`/products/${row.productId}`} className="font-medium text-slate-800 hover:underline">{row.productName}</Link>
                                            {!row.productActive && <span className="ml-2"><Badge>Hidden</Badge></span>}
                                        </td>
                                        <td className="px-4 py-3">{row.label}</td>
                                        <td className="px-4 py-3 text-slate-500">{row.sku || '—'}</td>
                                        <td className="px-4 py-3 text-base font-semibold tabular-nums">{row.stockQty}</td>
                                        <td className="px-4 py-3 tabular-nums text-slate-500">{row.lowStockThreshold}</td>
                                        <td className="px-4 py-3">{stockBadge(row)}</td>
                                        <td className="whitespace-nowrap px-4 py-3 text-right">
                                            <button type="button" className="btn-ghost px-2 py-1 text-brand-700" onClick={() => setEditing(row)}>Update stock</button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </>
            )}
            <Pager page={page} pages={data?.pages} onChange={setPage} />

            <Modal open={Boolean(editing)} title="Update stock" onClose={() => setEditing(null)}>
                {editing && <StockForm row={editing} onDone={() => setEditing(null)} />}
            </Modal>
        </div>
    );
}
