import { StrictMode, Suspense, lazy } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Navigate, Outlet, Route, Routes } from 'react-router';
import { AuthProvider, useAuth } from './auth/AuthProvider.jsx';
import AppLayout from './layout/AppLayout.jsx';
import Login from './pages/Login.jsx';
import NotFound from './pages/NotFound.jsx';
import './index.css';

// Each page loads when first opened, so the first screen stays small.
const Banners = lazy(() => import('./pages/Banners.jsx'));
const BookingDetail = lazy(() => import('./pages/BookingDetail.jsx'));
const Bookings = lazy(() => import('./pages/Bookings.jsx'));
const Categories = lazy(() => import('./pages/Categories.jsx'));
const Coupons = lazy(() => import('./pages/Coupons.jsx'));
const CustomerDetail = lazy(() => import('./pages/Customers.jsx').then((m) => ({ default: m.CustomerDetail })));
const Customers = lazy(() => import('./pages/Customers.jsx').then((m) => ({ default: m.Customers })));
const Dashboard = lazy(() => import('./pages/Dashboard.jsx'));
const Inventory = lazy(() => import('./pages/Inventory.jsx'));
const LaundryServices = lazy(() => import('./pages/LaundryServices.jsx'));
const OrderDetail = lazy(() => import('./pages/OrderDetail.jsx'));
const Orders = lazy(() => import('./pages/Orders.jsx'));
const ProductEditor = lazy(() => import('./pages/ProductEditor.jsx'));
const Products = lazy(() => import('./pages/Products.jsx'));
const Reports = lazy(() => import('./pages/Reports.jsx'));
const RiderDetail = lazy(() => import('./pages/Riders.jsx').then((m) => ({ default: m.RiderDetail })));
const Riders = lazy(() => import('./pages/Riders.jsx').then((m) => ({ default: m.Riders })));
const Settings = lazy(() => import('./pages/Settings.jsx'));
const Slots = lazy(() => import('./pages/Slots.jsx'));
const Staff = lazy(() => import('./pages/Staff.jsx'));
const Zones = lazy(() => import('./pages/Zones.jsx'));

function PageSuspense() {
    return (
        <Suspense fallback={<p className="text-sm text-slate-500" role="status">Loading…</p>}>
            <Outlet />
        </Suspense>
    );
}

const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false, staleTime: 30_000 } }
});

function FullPageSpinner() {
    return (
        <div className="grid min-h-screen place-items-center text-sm text-slate-500" role="status">
            Loading…
        </div>
    );
}

function RequireAuth({ children }) {
    const { user } = useAuth();
    if (user === undefined) return <FullPageSpinner />;
    if (!user) return <Navigate to="/login" replace />;
    return children;
}

function RequirePermission({ section, children }) {
    const { can } = useAuth();
    return can(section) ? children : <NotFound message="You don't have access to this page." />;
}

function GuestOnly({ children }) {
    const { user } = useAuth();
    if (user === undefined) return <FullPageSpinner />;
    if (user) return <Navigate to="/" replace />;
    return children;
}

createRoot(document.getElementById('root')).render(
    <StrictMode>
        <QueryClientProvider client={queryClient}>
            <AuthProvider>
                <BrowserRouter>
                    <Routes>
                        <Route path="/login" element={<GuestOnly><Login /></GuestOnly>} />
                        <Route element={<RequireAuth><AppLayout /></RequireAuth>}>
                          <Route element={<PageSuspense />}>
                            <Route index element={<Dashboard />} />
                            <Route path="categories" element={<RequirePermission section="catalog"><Categories /></RequirePermission>} />
                            <Route path="products" element={<RequirePermission section="catalog"><Products /></RequirePermission>} />
                            <Route path="products/new" element={<RequirePermission section="catalog"><ProductEditor /></RequirePermission>} />
                            <Route path="products/:id" element={<RequirePermission section="catalog"><ProductEditor key="edit" /></RequirePermission>} />
                            <Route path="inventory" element={<RequirePermission section="inventory"><Inventory /></RequirePermission>} />
                            <Route path="orders" element={<RequirePermission section="orders"><Orders /></RequirePermission>} />
                            <Route path="orders/:id" element={<RequirePermission section="orders"><OrderDetail /></RequirePermission>} />
                            <Route path="bookings" element={<RequirePermission section="bookings"><Bookings /></RequirePermission>} />
                            <Route path="bookings/:id" element={<RequirePermission section="bookings"><BookingDetail /></RequirePermission>} />
                            <Route path="riders" element={<RequirePermission section="riders"><Riders /></RequirePermission>} />
                            <Route path="riders/:id" element={<RequirePermission section="riders"><RiderDetail /></RequirePermission>} />
                            <Route path="laundry-services" element={<RequirePermission section="catalog"><LaundryServices /></RequirePermission>} />
                            <Route path="customers" element={<RequirePermission section="customers"><Customers /></RequirePermission>} />
                            <Route path="customers/:id" element={<RequirePermission section="customers"><CustomerDetail /></RequirePermission>} />
                            <Route path="banners" element={<RequirePermission section="banners"><Banners /></RequirePermission>} />
                            <Route path="reports" element={<RequirePermission section="reports"><Reports /></RequirePermission>} />
                            <Route path="settings" element={<RequirePermission section="settings"><Settings /></RequirePermission>} />
                            <Route path="coupons" element={<RequirePermission section="coupons"><Coupons /></RequirePermission>} />
                            <Route path="zones" element={<RequirePermission section="zones"><Zones /></RequirePermission>} />
                            <Route path="slots" element={<RequirePermission section="zones"><Slots /></RequirePermission>} />
                            <Route path="staff" element={<RequirePermission section="staff"><Staff /></RequirePermission>} />
                            <Route path="*" element={<NotFound />} />
                          </Route>
                        </Route>
                    </Routes>
                </BrowserRouter>
            </AuthProvider>
        </QueryClientProvider>
    </StrictMode>
);
