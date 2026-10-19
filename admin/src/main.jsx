import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router';
import { AuthProvider, useAuth } from './auth/AuthProvider.jsx';
import AppLayout from './layout/AppLayout.jsx';
import Categories from './pages/Categories.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Inventory from './pages/Inventory.jsx';
import ProductEditor from './pages/ProductEditor.jsx';
import Products from './pages/Products.jsx';
import Login from './pages/Login.jsx';
import NotFound from './pages/NotFound.jsx';
import Staff from './pages/Staff.jsx';
import './index.css';

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
                            <Route index element={<Dashboard />} />
                            <Route path="categories" element={<RequirePermission section="catalog"><Categories /></RequirePermission>} />
                            <Route path="products" element={<RequirePermission section="catalog"><Products /></RequirePermission>} />
                            <Route path="products/new" element={<RequirePermission section="catalog"><ProductEditor /></RequirePermission>} />
                            <Route path="products/:id" element={<RequirePermission section="catalog"><ProductEditor key="edit" /></RequirePermission>} />
                            <Route path="inventory" element={<RequirePermission section="inventory"><Inventory /></RequirePermission>} />
                            <Route path="staff" element={<RequirePermission section="staff"><Staff /></RequirePermission>} />
                            <Route path="*" element={<NotFound />} />
                        </Route>
                    </Routes>
                </BrowserRouter>
            </AuthProvider>
        </QueryClientProvider>
    </StrictMode>
);
