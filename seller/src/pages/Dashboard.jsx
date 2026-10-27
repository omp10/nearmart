import { useMutation, useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { AlertTriangle, Boxes, ChevronRight, IndianRupee, Package, PackagePlus, Power, ShoppingBag } from 'lucide-react';
import { useAuth } from '../auth/AuthProvider.jsx';
import { api } from '../lib/api.js';
import { formatPaise } from '../lib/money.js';
import { OPEN_STATUSES, STATUS_LABELS } from '../lib/orders.js';
import { approvedShops } from '../lib/shops.js';
import { ErrorNote, Loading, Notice, PageHeader, StatCard } from '../components/ui.jsx';
import { BalanceGrid } from '../components/money.jsx';

function StoreToggle() {
    const { seller, setSeller } = useAuth();
    const toggle = useMutation({
        mutationFn: (isOpen) => api.post('/seller/store/open', { isOpen }).then((r) => r.data.data),
        onSuccess: setSeller
    });
    const open = seller.isOpen;

    return (
        <section className={`card flex flex-wrap items-center gap-4 ${open ? 'border-brand-200' : 'border-slate-300'}`}>
            <span className={`grid h-12 w-12 shrink-0 place-items-center rounded-full ${open ? 'bg-brand-50 text-brand-700' : 'bg-slate-100 text-slate-500'}`}>
                <Power className="h-6 w-6" aria-hidden="true" />
            </span>
            <div className="min-w-0 flex-1">
                <p className="text-lg font-semibold text-slate-900">Your store is {open ? 'open' : 'closed'}</p>
                <p className="text-sm text-slate-500">
                    {open ? 'Customers can see your products and place orders.' : 'Your products are hidden from customers until you open again.'}
                </p>
                <ErrorNote error={toggle.error} />
            </div>
            <button
                type="button"
                role="switch"
                aria-checked={open}
                aria-label="Store open for orders"
                disabled={toggle.isPending}
                onClick={() => (open && !window.confirm('Close your store? Customers will not be able to order until you open it again.') ? null : toggle.mutate(!open))}
                className={`relative inline-flex h-9 w-16 shrink-0 items-center rounded-full transition disabled:opacity-60 ${open ? 'bg-brand-700' : 'bg-slate-300'}`}
            >
                <span className={`inline-block h-7 w-7 rounded-full bg-white shadow transition ${open ? 'translate-x-8' : 'translate-x-1'}`} />
            </button>
        </section>
    );
}

export default function Dashboard() {
    const { seller } = useAuth();
    const { data, isLoading, error } = useQuery({
        queryKey: ['dashboard'],
        queryFn: () => api.get('/seller/dashboard').then((r) => r.data.data),
        refetchInterval: 60_000
    });
    const firstName = seller.ownerName?.split(' ')[0];
    const hasShops = approvedShops(seller).length > 0;

    return (
        <div className="space-y-6">
            <PageHeader title={`Hello, ${firstName}`} subtitle={`Here's how ${seller.businessName} is doing today.`} />

            <StoreToggle />

            {!hasShops && (
                <Notice tone="amber" icon={AlertTriangle} title="No approved shop yet" action={<Link to="/shops" className="btn-outline">Shops & categories</Link>}>
                    You can add products once Nearmart approves at least one shop for you.
                </Notice>
            )}

            <ErrorNote error={error} />
            {isLoading && <Loading />}

            {data && (
                <>
                    {data.products === 0 && hasShops && (
                        <Notice tone="blue" icon={PackagePlus} title="Add your first product" action={<Link to="/products/new" className="btn-primary">Add product</Link>}>
                            Customers can order from you as soon as you add products with stock.
                        </Notice>
                    )}

                    <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                        <StatCard icon={ShoppingBag} tone="green" label="Orders today" value={data.today.orders} as={Link} to="/orders" />
                        <StatCard icon={IndianRupee} tone="green" label="Sales today" value={formatPaise(data.today.salesPaise)} hint="Value of items ordered" />
                        <StatCard icon={Package} label="Products" value={data.products} as={Link} to="/products" />
                        <StatCard
                            icon={Boxes}
                            tone={data.lowStockVariants ? 'amber' : 'slate'}
                            label="Low on stock"
                            value={data.lowStockVariants}
                            hint={data.lowStockVariants ? 'Items to restock' : 'All stocked up'}
                            as={Link}
                            to="/inventory?stock=low"
                        />
                    </section>

                    <div className="grid gap-6 lg:grid-cols-2">
                        <section className="card">
                            <div className="mb-3 flex items-center justify-between">
                                <h2 className="font-semibold">Open orders</h2>
                                <Link to="/orders" className="text-sm text-brand-700 hover:underline">All orders</Link>
                            </div>
                            <ul className="divide-y divide-slate-100">
                                {OPEN_STATUSES.map((s) => {
                                    const n = data.openOrders[s] ?? 0;
                                    const urgent = s === 'placed' && n > 0;
                                    return (
                                        <li key={s}>
                                            <Link to={`/orders?status=${s}`} className="flex items-center gap-3 rounded-lg px-2 py-2.5 hover:bg-slate-50">
                                                <span className={`flex-1 text-sm ${urgent ? 'font-semibold text-red-700' : 'text-slate-700'}`}>
                                                    {STATUS_LABELS[s]}
                                                    {urgent && <span className="ml-2 text-xs font-normal">needs accepting</span>}
                                                </span>
                                                <span className={`min-w-8 rounded-full px-2 py-0.5 text-center text-sm font-semibold tabular-nums ${urgent ? 'bg-red-600 text-white' : n ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-500'}`}>{n}</span>
                                                <ChevronRight className="h-4 w-4 text-slate-400" aria-hidden="true" />
                                            </Link>
                                        </li>
                                    );
                                })}
                            </ul>
                        </section>

                        <section className="card">
                            <div className="mb-3 flex items-center justify-between">
                                <h2 className="font-semibold">Your money</h2>
                                <Link to="/earnings" className="text-sm text-brand-700 hover:underline">Earnings</Link>
                            </div>
                            <BalanceGrid balance={data.balance} />
                        </section>
                    </div>
                </>
            )}
        </div>
    );
}
