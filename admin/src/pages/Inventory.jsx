import { useEffect, useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router';
import { useAuth } from '../auth/AuthProvider.jsx';
import { api } from '../lib/api.js';
import { LaundryHasItsOwnPages, ModuleTabs, useCurrentModule } from '../lib/moduleContext.jsx';
import { Badge, ErrorNote, Modal, Pager, flattenTree, useCategoryTree, useDebounced } from '../components/ui.jsx';

const REASON_LABELS = {
    initial: 'Opening stock',
    restock: 'Restock',
    adjustment: 'Adjustment',
    order: 'Order',
    order_cancelled: 'Order cancelled'
};

const stockBadge = (row) => {
    if (row.stockQty === 0) return <Badge tone="red">Out</Badge>;
    if (row.stockQty <= row.lowStockThreshold) return <Badge tone="amber">Low</Badge>;
    return <Badge tone="green">OK</Badge>;
};

function StockForm({ row, onDone }) {
    const queryClient = useQueryClient();
    const [mode, setMode] = useState('restock'); // restock | remove | count
    const [qty, setQty] = useState('');
    const [note, setNote] = useState('');
    const [threshold, setThreshold] = useState(String(row.lowStockThreshold));
    const base = `/admin/catalog/inventory/${row.productId}/variants/${row.variantId}`;

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
            queryClient.invalidateQueries({ queryKey: ['movements'] });
            queryClient.invalidateQueries({ queryKey: ['products'] });
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
                {row.productName} · {row.label} — currently <strong>{row.stockQty}</strong> in stock
            </p>
            <ErrorNote error={save.error} />
            <div className="flex flex-wrap gap-1 rounded-lg bg-slate-100 p-1" role="radiogroup" aria-label="Type of change">
                {[['restock', 'Add stock'], ['remove', 'Remove'], ['count', 'Set exact count']].map(([value, label]) => (
                    <button
                        key={value}
                        type="button"
                        role="radio"
                        aria-checked={mode === value}
                        onClick={() => setMode(value)}
                        className={`rounded-md px-3 py-1.5 text-sm font-medium ${mode === value ? 'bg-white shadow-sm' : 'text-slate-600'}`}
                    >
                        {label}
                    </button>
                ))}
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
                <div>
                    <label className="label" htmlFor="s-qty">{mode === 'count' ? 'Counted quantity' : 'Quantity'}</label>
                    <input id="s-qty" type="number" min={mode === 'count' ? 0 : 1} step="1" className="input" value={qty} onChange={(e) => setQty(e.target.value)} autoFocus />
                    {preview != null && (
                        <p className={`mt-1 text-xs ${preview < 0 ? 'text-red-600' : 'text-slate-500'}`}>
                            New stock: {preview}{preview < 0 && ' — not enough stock'}
                        </p>
                    )}
                </div>
                <div>
                    <label className="label" htmlFor="s-threshold">Low-stock alert at</label>
                    <input id="s-threshold" type="number" min="0" step="1" className="input" value={threshold} onChange={(e) => setThreshold(e.target.value)} />
                </div>
            </div>
            <div>
                <label className="label" htmlFor="s-note">Note (optional)</label>
                <input id="s-note" className="input" placeholder="e.g. Supplier invoice 1042, damaged in transit" value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} />
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

function History({ row }) {
    const { data, isLoading, error } = useQuery({
        queryKey: ['movements', row.variantId],
        queryFn: () =>
            api.get('/admin/catalog/inventory/movements', { params: { productId: row.productId, variantId: row.variantId, limit: 50 } })
                .then((r) => r.data.data)
    });
    if (isLoading) return <p className="text-sm text-slate-500">Loading…</p>;
    if (error) return <ErrorNote error={error} />;
    if (!data.items.length) return <p className="text-sm text-slate-500">No stock changes recorded yet.</p>;
    return (
        <div className="max-h-[60vh] overflow-y-auto">
            <table className="w-full text-sm">
                <thead className="text-left text-xs text-slate-500">
                    <tr>
                        <th className="py-1 font-medium">When</th>
                        <th className="py-1 font-medium">Change</th>
                        <th className="py-1 font-medium">After</th>
                        <th className="py-1 font-medium">Reason</th>
                    </tr>
                </thead>
                <tbody>
                    {data.items.map((m) => (
                        <tr key={m._id} className="border-t border-slate-100">
                            <td className="py-2 pr-3 text-slate-600">{new Date(m.createdAt).toLocaleString('en-IN')}</td>
                            <td className={`py-2 pr-3 font-medium ${m.delta > 0 ? 'text-brand-700' : 'text-red-600'}`}>{m.delta > 0 ? `+${m.delta}` : m.delta}</td>
                            <td className="py-2 pr-3">{m.after}</td>
                            <td className="py-2">
                                {REASON_LABELS[m.reason] ?? m.reason}
                                {m.note && <span className="block text-xs text-slate-500">{m.note}</span>}
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

export default function Inventory() {
    const { can } = useAuth();
    const { module } = useCurrentModule();
    const [filters, setFilters] = useState({ q: '', category: '', stock: '' });
    const [page, setPage] = useState(1);
    const [dialog, setDialog] = useState(null); // { type: 'adjust' | 'history', row }
    const q = useDebounced(filters.q);
    const { data: tree = [] } = useCategoryTree(module);

    const setFilter = (patch) => {
        setFilters((f) => ({ ...f, ...patch }));
        setPage(1);
    };
    const params = { module, page, limit: 25, q: q || undefined, category: filters.category || undefined, stock: filters.stock || undefined };
    const { data, isLoading, error } = useQuery({
        queryKey: ['inventory', params],
        queryFn: () => api.get('/admin/catalog/inventory', { params }).then((r) => r.data.data),
        placeholderData: keepPreviousData,
        enabled: module !== 'laundry'
    });

    useEffect(() => {
        setFilters((f) => ({ ...f, category: '' }));
        setPage(1);
    }, [module]);

    // Laundry is the selected module: it has its own pages.
    if (module === 'laundry') {
        return (
            <div className="space-y-6">
                <h1 className="text-2xl font-semibold">Inventory</h1>
                <ModuleTabs productOnly />
                <LaundryHasItsOwnPages what="stock to manage" />
            </div>
        );
    }

    return (
        <div className="space-y-6">
            <div>
                <h1 className="text-2xl font-semibold">Inventory</h1>
                <p className="text-sm text-slate-500">Stock per variant, lowest first. Every change is recorded in the item's history.</p>
            </div>

            <ModuleTabs productOnly />

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <input className="input lg:col-span-2" placeholder="Search product, variant or SKU" aria-label="Search inventory" value={filters.q} onChange={(e) => setFilter({ q: e.target.value })} />
                <select className="input" aria-label="Category" value={filters.category} onChange={(e) => setFilter({ category: e.target.value })}>
                    <option value="">All categories</option>
                    {flattenTree(tree).map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                </select>
                <select className="input" aria-label="Stock level" value={filters.stock} onChange={(e) => setFilter({ stock: e.target.value })}>
                    <option value="">All stock levels</option>
                    <option value="low">Low or out</option>
                    <option value="out">Out of stock</option>
                    <option value="in">In stock</option>
                </select>
            </div>

            <ErrorNote error={error} />

            <div className="card overflow-x-auto p-0">
                <table className="w-full text-sm">
                    <thead className="bg-slate-50 text-left text-slate-500">
                        <tr>
                            <th className="px-4 py-3 font-medium">Product</th>
                            <th className="px-4 py-3 font-medium">Variant</th>
                            <th className="px-4 py-3 font-medium">SKU</th>
                            <th className="px-4 py-3 font-medium">Stock</th>
                            <th className="px-4 py-3 font-medium">Status</th>
                            <th className="px-4 py-3" />
                        </tr>
                    </thead>
                    <tbody>
                        {isLoading && <tr><td colSpan={6} className="px-4 py-6 text-center text-slate-500">Loading…</td></tr>}
                        {data?.items.length === 0 && <tr><td colSpan={6} className="px-4 py-6 text-center text-slate-500">Nothing matches.</td></tr>}
                        {data?.items.map((row) => (
                            <tr key={row.variantId} className="border-t border-slate-100">
                                <td className="px-4 py-3">
                                    <Link to={`/products/${row.productId}`} className="font-medium text-slate-800 hover:underline">{row.productName}</Link>
                                    {!row.productActive && <span className="ml-2"><Badge>Hidden</Badge></span>}
                                </td>
                                <td className="px-4 py-3">{row.label}</td>
                                <td className="px-4 py-3 text-slate-500">{row.sku || '—'}</td>
                                <td className="px-4 py-3 text-base font-semibold tabular-nums">{row.stockQty}</td>
                                <td className="px-4 py-3">{stockBadge(row)}</td>
                                <td className="whitespace-nowrap px-4 py-3 text-right">
                                    <button type="button" className="btn-ghost px-2 py-1" onClick={() => setDialog({ type: 'history', row })}>History</button>
                                    {can('inventory', 'update') && (
                                        <button type="button" className="btn-ghost px-2 py-1 text-brand-700" onClick={() => setDialog({ type: 'adjust', row })}>Update stock</button>
                                    )}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
            <Pager page={page} pages={data?.pages} onChange={setPage} />

            <Modal
                open={Boolean(dialog)}
                title={dialog?.type === 'history' ? `Stock history · ${dialog.row.productName} · ${dialog.row.label}` : 'Update stock'}
                onClose={() => setDialog(null)}
                wide={dialog?.type === 'history'}
            >
                {dialog?.type === 'adjust' && <StockForm row={dialog.row} onDone={() => setDialog(null)} />}
                {dialog?.type === 'history' && <History row={dialog.row} />}
            </Modal>
        </div>
    );
}
