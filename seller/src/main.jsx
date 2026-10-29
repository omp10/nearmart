import { StrictMode, Suspense, lazy } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Link, Navigate, Outlet, Route, Routes } from 'react-router';
import { PauseCircle } from 'lucide-react';
import { AuthProvider, useAuth } from './auth/AuthProvider.jsx';
import AppLayout from './layout/AppLayout.jsx';
import { Forgot, Login, Signup } from './pages/Auth.jsx';
import { Loading } from './components/ui.jsx';
import './index.css';

// Each page loads when first opened, so the first screen stays small on phones.
const Application = lazy(() => import('./pages/Application.jsx'));
const UnderReview = lazy(() => import('./pages/Application.jsx').then((m) => ({ default: m.UnderReview })));
const Dashboard = lazy(() => import('./pages/Dashboard.jsx'));
const Orders = lazy(() => import('./pages/Orders.jsx'));
const OrderDetail = lazy(() => import('./pages/OrderDetail.jsx'));
const Products = lazy(() => import('./pages/Products.jsx'));
const ProductEditor = lazy(() => import('./pages/ProductEditor.jsx'));
const Inventory = lazy(() => import('./pages/Inventory.jsx'));
const Earnings = lazy(() => import('./pages/Earnings.jsx'));
const Payouts = lazy(() => import('./pages/Payouts.jsx').then((m) => ({ default: m.Payouts })));
const PayoutDetail = lazy(() => import('./pages/Payouts.jsx').then((m) => ({ default: m.PayoutDetail })));
const Commission = lazy(() => import('./pages/Commission.jsx'));
const StoreProfile = lazy(() => import('./pages/Store.jsx').then((m) => ({ default: m.StoreProfile })));
const OpeningHours = lazy(() => import('./pages/OpeningHours.jsx'));
const Shops = lazy(() => import('./pages/Store.jsx').then((m) => ({ default: m.Shops })));
const Notifications = lazy(() => import('./pages/Account.jsx').then((m) => ({ default: m.Notifications })));
const Documents = lazy(() => import('./pages/Account.jsx').then((m) => ({ default: m.Documents })));
const Account = lazy(() => import('./pages/Account.jsx').then((m) => ({ default: m.Account })));

const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false, staleTime: 30_000 } }
});

function FullPageSpinner() {
    return (
        <div className="grid min-h-screen place-items-center">
            <Loading />
        </div>
    );
}

function PageSuspense() {
    return (
        <Suspense fallback={<Loading />}>
            <Outlet />
        </Suspense>
    );
}

function NotFound() {
    return (
        <div className="card py-10 text-center">
            <h1 className="text-xl font-semibold">Page not found</h1>
            <p className="mt-1 text-sm text-slate-500">This page doesn't exist or has moved.</p>
            <Link to="/" className="btn-primary mt-4">Go to dashboard</Link>
        </div>
    );
}

/**
 * Catalogue pages need an approved store; while paused they explain why instead
 * of failing. Orders and money stay open to paused stores (the API allows it),
 * so orders already received can still be finished.
 */
function CatalogueOnly() {
    const { seller } = useAuth();
    if (seller.status === 'approved') return <Outlet />;
    return (
        <div className="card flex flex-col items-center gap-3 py-10 text-center">
            <PauseCircle className="h-10 w-10 text-red-500" aria-hidden="true" />
            <h1 className="text-xl font-semibold">This page is unavailable while your store is paused</h1>
            <p className="max-w-md text-sm text-slate-600">Products and stock open again once Nearmart resumes your store. You can still finish the orders you've already received.</p>
            <div className="flex flex-wrap justify-center gap-2">
                <Link to="/orders" className="btn-primary">Go to orders</Link>
                <Link to="/store" className="btn-outline">Store profile</Link>
            </div>
        </div>
    );
}

function GuestOnly({ children }) {
    const { seller } = useAuth();
    if (seller === undefined) return <FullPageSpinner />;
    if (seller) return <Navigate to="/" replace />;
    return children;
}

/** Signed-in seller: the screen depends on where the application stands. */
function SellerApp() {
    const { seller } = useAuth();
    if (seller === undefined) return <FullPageSpinner />;
    if (!seller) return <Navigate to="/login" replace />;

    if (seller.status === 'draft' || seller.status === 'rejected') {
        return (
            <Suspense fallback={<FullPageSpinner />}>
                <Application />
            </Suspense>
        );
    }
    if (seller.status === 'submitted') {
        return (
            <Suspense fallback={<FullPageSpinner />}>
                <UnderReview />
            </Suspense>
        );
    }

    // approved or suspended
    return (
        <Routes>
            <Route element={<AppLayout />}>
                <Route element={<PageSuspense />}>
                    <Route index element={<Dashboard />} />
                    <Route path="orders" element={<Orders />} />
                    <Route path="orders/:id" element={<OrderDetail />} />
                    <Route element={<CatalogueOnly />}>
                        <Route path="products" element={<Products />} />
                        <Route path="products/new" element={<ProductEditor key="new" />} />
                        <Route path="products/:id" element={<ProductEditor key="edit" />} />
                        <Route path="inventory" element={<Inventory />} />
                    </Route>
                    <Route path="earnings" element={<Earnings />} />
                    <Route path="payouts" element={<Payouts />} />
                    <Route path="payouts/:id" element={<PayoutDetail />} />
                    <Route path="commission" element={<Commission />} />
                    <Route path="store" element={<StoreProfile />} />
                    <Route path="store/hours" element={<OpeningHours />} />
                    <Route path="shops" element={<Shops />} />
                    <Route path="notifications" element={<Notifications />} />
                    <Route path="documents" element={<Documents />} />
                    <Route path="account" element={<Account />} />
                    <Route path="*" element={<NotFound />} />
                </Route>
            </Route>
        </Routes>
    );
}

createRoot(document.getElementById('root')).render(
    <StrictMode>
        <QueryClientProvider client={queryClient}>
            <AuthProvider>
                <BrowserRouter basename="/seller">
                    <Routes>
                        <Route path="/login" element={<GuestOnly><Login /></GuestOnly>} />
                        <Route path="/signup" element={<GuestOnly><Signup /></GuestOnly>} />
                        <Route path="/forgot" element={<GuestOnly><Forgot /></GuestOnly>} />
                        <Route path="/*" element={<SellerApp />} />
                    </Routes>
                </BrowserRouter>
            </AuthProvider>
        </QueryClientProvider>
    </StrictMode>
);
