import { useEffect, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { useAuth } from '../auth/AuthProvider.jsx';
import { api } from '../lib/api.js';
import { formatPaise } from '../lib/money.js';
import { LaundryHasItsOwnPages, ModuleTabs, useCurrentModule } from '../lib/moduleContext.jsx';
import { Badge, ErrorNote, Pager, flattenTree, useCategoryTree, useDebounced } from '../components/ui.jsx';

export default function Products() {
    const { can } = useAuth();
    const { module } = useCurrentModule();
    const [filters, setFilters] = useState({ q: '', category: '', status: '', stock: '', seller: '', sort: 'newest' });
    const [page, setPage] = useState(1);
    const q = useDebounced(filters.q);
    const { data: tree = [] } = useCategoryTree(module);

    const setFilter = (patch) => {
        setFilters((f) => ({ ...f, ...patch }));
        setPage(1);
    };

    const params = { module, page, limit: 20, q: q || undefined, category: filters.category || undefined,
        status: filters.status || undefined, stock: filters.stock || undefined, seller: filters.seller || undefined, sort: filters.sort };
    const { data, isLoading, error } = useQuery({
        queryKey: ['products', params],
        queryFn: () => api.get('/admin/catalog/products', { params }).then((r) => r.data.data),
        placeholderData: keepPreviousData,
        enabled: module !== 'laundry'
    });
    // Seller names for the filter; staff without the Sellers section just get All / Nearmart.
    const { data: sellers } = useQuery({
        queryKey: ['sellers', { status: 'approved', limit: 100 }],
        queryFn: () => api.get('/admin/sellers', { params: { status: 'approved', limit: 100 } }).then((r) => r.data.data),
        enabled: can('sellers'),
        staleTime: 5 * 60_000
    });

    // A category from another module would match nothing.
    useEffect(() => {
        setFilters((f) => ({ ...f, category: '' }));
        setPage(1);
    }, [module]);

    // Laundry is the selected module: it has its own pages.
    if (module === 'laundry') {
        return (
            <div className="space-y-6">
                <h1 className="text-2xl font-semibold">Products</h1>
                <ModuleTabs productOnly />
                <LaundryHasItsOwnPages what="products" />
            </div>
        );
    }

    return (
        <div className="space-y-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                    <h1 className="text-2xl font-semibold">Products</h1>
                    <p className="text-sm text-slate-500">Each product has one or more variants with their own price and stock.</p>
                </div>
                {can('catalog', 'create') && (
                    <Link to={`/products/new?module=${module}`} className="btn-primary">Add product</Link>
                )}
            </div>

            <ModuleTabs productOnly />

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
                <input
                    className="input lg:col-span-2"
                    placeholder="Search name, brand or SKU"
                    aria-label="Search products"
                    value={filters.q}
                    onChange={(e) => setFilter({ q: e.target.value })}
                />
                <select className="input" aria-label="Category" value={filters.category} onChange={(e) => setFilter({ category: e.target.value })}>
                    <option value="">All categories</option>
                    {flattenTree(tree).map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                </select>
                <select className="input" aria-label="Status" value={filters.status} onChange={(e) => setFilter({ status: e.target.value })}>
                    <option value="">Active and hidden</option>
                    <option value="active">Active</option>
                    <option value="inactive">Hidden</option>
                </select>
                <select className="input" aria-label="Stock" value={filters.stock} onChange={(e) => setFilter({ stock: e.target.value })}>
                    <option value="">Any stock</option>
                    <option value="in">In stock</option>
                    <option value="low">Low stock</option>
                    <option value="out">Out of stock</option>
                </select>
                <select className="input" aria-label="Seller" value={filters.seller} onChange={(e) => setFilter({ seller: e.target.value })}>
                    <option value="">All sellers</option>
                    <option value="nearmart">Nearmart</option>
                    {sellers?.items.map((s) => <option key={s._id} value={s._id}>{s.businessName}</option>)}
                </select>
            </div>

            <ErrorNote error={error} />

            <div className="card overflow-x-auto p-0">
                <table className="w-full text-sm">
                    <thead className="bg-slate-50 text-left text-slate-500">
                        <tr>
                            <th className="px-4 py-3 font-medium">Product</th>
                            <th className="px-4 py-3 font-medium">Category</th>
                            <th className="px-4 py-3 font-medium">Variants</th>
                            <th className="px-4 py-3 font-medium">
                                <button type="button" className="font-medium" onClick={() => setFilter({ sort: filters.sort === 'price_asc' ? 'price_desc' : 'price_asc' })}>
                                    From price {filters.sort === 'price_asc' ? '↑' : filters.sort === 'price_desc' ? '↓' : ''}
                                </button>
                            </th>
                            <th className="px-4 py-3 font-medium">Stock</th>
                            <th className="px-4 py-3 font-medium">Status</th>
                        </tr>
                    </thead>
                    <tbody>
                        {isLoading && <tr><td colSpan={6} className="px-4 py-6 text-center text-slate-500">Loading…</td></tr>}
                        {data?.items.length === 0 && (
                            <tr><td colSpan={6} className="px-4 py-6 text-center text-slate-500">No products match.</td></tr>
                        )}
                        {data?.items.map((p) => (
                            <tr key={p._id} className="border-t border-slate-100 hover:bg-slate-50">
                                <td className="px-4 py-3">
                                    <Link to={`/products/${p._id}`} className="flex items-center gap-3">
                                        {p.images[0] ? (
                                            <img src={p.images[0]} alt="" className="h-10 w-10 rounded object-cover" />
                                        ) : (
                                            <div className="h-10 w-10 rounded bg-slate-100" />
                                        )}
                                        <span>
                                            <span className="block font-medium text-slate-800">{p.name}</span>
                                            {p.brand && <span className="block text-xs text-slate-500">{p.brand}</span>}
                                            <span className="block text-xs text-slate-500">
                                                {p.seller ? `Sold by ${p.sellerName || 'a seller'}` : 'Sold by Nearmart'}
                                                {p.seller && p.sellerHidden && ' · hidden (seller not live)'}
                                            </span>
                                        </span>
                                    </Link>
                                </td>
                                <td className="px-4 py-3 text-slate-600">{p.category?.name ?? '—'}</td>
                                <td className="px-4 py-3 text-slate-600">{p.variants.map((v) => v.label).join(', ')}</td>
                                <td className="px-4 py-3">{formatPaise(p.minPricePaise)}</td>
                                <td className="px-4 py-3">
                                    {p.inStock ? <Badge tone="green">{p.totalStock}</Badge> : <Badge tone="red">Out</Badge>}
                                </td>
                                <td className="px-4 py-3">
                                    {p.isActive ? <Badge tone="green">Active</Badge> : <Badge>Hidden</Badge>}
                                    {p.isFeatured && <span className="ml-1"><Badge tone="amber">Featured</Badge></span>}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
            <Pager page={page} pages={data?.pages} onChange={setPage} />
        </div>
    );
}
