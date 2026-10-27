import { useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router';
import { ImageOff, Plus, Search } from 'lucide-react';
import { useAuth } from '../auth/AuthProvider.jsx';
import { api } from '../lib/api.js';
import { formatPaise } from '../lib/money.js';
import { approvedShops, shopLabel } from '../lib/shops.js';
import { Badge, ErrorNote, Notice, PageHeader, Pager, useDebounced } from '../components/ui.jsx';

function Thumb({ src }) {
    return src ? (
        <img src={src} alt="" className="h-12 w-12 shrink-0 rounded-lg border border-slate-100 object-cover" />
    ) : (
        <span className="grid h-12 w-12 shrink-0 place-items-center rounded-lg bg-slate-100 text-slate-400"><ImageOff className="h-5 w-5" aria-hidden="true" /></span>
    );
}

function StatusBadges({ p }) {
    return (
        <span className="flex flex-wrap gap-1">
            {p.isActive ? <Badge tone="green">On sale</Badge> : <Badge>Hidden</Badge>}
            {p.totalStock === 0 && <Badge tone="red">Out of stock</Badge>}
            {p.sellerHidden && p.isActive && <Badge tone="amber">Not shown: store closed</Badge>}
        </span>
    );
}

export default function Products() {
    const { seller } = useAuth();
    const navigate = useNavigate();
    const shops = approvedShops(seller);
    const [filters, setFilters] = useState({ q: '', module: '', status: '', stock: '', sort: 'newest' });
    const [page, setPage] = useState(1);
    const q = useDebounced(filters.q.trim());
    const setFilter = (patch) => {
        setFilters((f) => ({ ...f, ...patch }));
        setPage(1);
    };

    const params = { page, limit: 20, q: q || undefined, module: filters.module || undefined, status: filters.status || undefined, stock: filters.stock || undefined, sort: filters.sort };
    const { data, isLoading, error } = useQuery({
        queryKey: ['products', params],
        queryFn: () => api.get('/seller/products', { params }).then((r) => r.data.data),
        placeholderData: keepPreviousData
    });

    return (
        <div className="space-y-5">
            <PageHeader
                title="Products"
                subtitle="Everything you sell on Nearmart."
                actions={shops.length > 0 && (
                    <Link to="/products/new" className="btn-primary">
                        <Plus className="h-4 w-4" aria-hidden="true" />
                        Add product
                    </Link>
                )}
            />

            {shops.length === 0 && (
                <Notice tone="amber" title="You can't add products yet" action={<Link to="/shops" className="btn-outline">Shops & categories</Link>}>
                    Nearmart has not approved a shop for you yet.
                </Notice>
            )}

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                <div className="relative sm:col-span-2">
                    <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
                    <input type="search" className="input pl-9" placeholder="Search name, brand or SKU" aria-label="Search products" value={filters.q} onChange={(e) => setFilter({ q: e.target.value })} />
                </div>
                {shops.length > 1 && (
                    <select className="input" aria-label="Shop" value={filters.module} onChange={(e) => setFilter({ module: e.target.value })}>
                        <option value="">All shops</option>
                        {shops.map((m) => <option key={m.key} value={m.key}>{shopLabel(m.key)}</option>)}
                    </select>
                )}
                <select className="input" aria-label="Visibility" value={filters.status} onChange={(e) => setFilter({ status: e.target.value })}>
                    <option value="">On sale and hidden</option>
                    <option value="active">On sale</option>
                    <option value="inactive">Hidden</option>
                </select>
                <select className="input" aria-label="Stock" value={filters.stock} onChange={(e) => setFilter({ stock: e.target.value })}>
                    <option value="">Any stock</option>
                    <option value="low">Low or out</option>
                    <option value="out">Out of stock</option>
                    <option value="in">In stock</option>
                </select>
                <select className="input" aria-label="Sort" value={filters.sort} onChange={(e) => setFilter({ sort: e.target.value })}>
                    <option value="newest">Newest first</option>
                    <option value="name">Name A–Z</option>
                    <option value="price_asc">Price: low to high</option>
                    <option value="price_desc">Price: high to low</option>
                    <option value="stock_asc">Lowest stock first</option>
                </select>
            </div>

            <ErrorNote error={error} />
            {isLoading && <p className="text-sm text-slate-500">Loading…</p>}
            {data?.items.length === 0 && (
                <div className="card py-10 text-center text-sm text-slate-500">
                    {q || filters.status || filters.stock || filters.module ? 'No products match.' : 'No products yet. Add your first one to start selling.'}
                </div>
            )}

            {data?.items.length > 0 && (
                <>
                    <ul className="space-y-3 md:hidden">
                        {data.items.map((p) => (
                            <li key={p._id}>
                                <Link to={`/products/${p._id}`} className="card flex items-center gap-3 p-3">
                                    <Thumb src={p.images?.[0]} />
                                    <span className="min-w-0 flex-1">
                                        <span className="block truncate font-medium text-slate-900">{p.name}</span>
                                        <span className="block text-xs text-slate-500">
                                            {p.variants?.length > 1 ? 'From ' : ''}{formatPaise(p.minPricePaise)} · {p.totalStock} in stock
                                        </span>
                                        <StatusBadges p={p} />
                                    </span>
                                </Link>
                            </li>
                        ))}
                    </ul>

                    <div className="card hidden overflow-x-auto p-0 md:block">
                        <table className="w-full text-sm">
                            <thead className="text-left">
                                <tr>
                                    <th className="px-4 py-3">Product</th>
                                    <th className="px-4 py-3">Shop</th>
                                    <th className="px-4 py-3">Price</th>
                                    <th className="px-4 py-3">Variants</th>
                                    <th className="px-4 py-3">Stock</th>
                                    <th className="px-4 py-3">Status</th>
                                </tr>
                            </thead>
                            <tbody>
                                {data.items.map((p) => (
                                    <tr key={p._id} className="cursor-pointer border-t border-slate-100" onClick={() => navigate(`/products/${p._id}`)}>
                                        <td className="px-4 py-3">
                                            <span className="flex items-center gap-3">
                                                <Thumb src={p.images?.[0]} />
                                                <span className="min-w-0">
                                                    <Link to={`/products/${p._id}`} className="font-medium text-slate-900 hover:underline" onClick={(e) => e.stopPropagation()}>{p.name}</Link>
                                                    {p.brand && <span className="block text-xs text-slate-500">{p.brand}</span>}
                                                </span>
                                            </span>
                                        </td>
                                        <td className="px-4 py-3 text-slate-600">{shopLabel(p.module)}</td>
                                        <td className="px-4 py-3 tabular-nums">{p.variants?.length > 1 && <span className="text-xs text-slate-500">from </span>}{formatPaise(p.minPricePaise)}</td>
                                        <td className="px-4 py-3 tabular-nums">{p.variants?.length ?? 0}</td>
                                        <td className={`px-4 py-3 font-semibold tabular-nums ${p.totalStock === 0 ? 'text-red-600' : ''}`}>{p.totalStock}</td>
                                        <td className="px-4 py-3"><StatusBadges p={p} /></td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </>
            )}
            <Pager page={page} pages={data?.pages} onChange={setPage} />
        </div>
    );
}
