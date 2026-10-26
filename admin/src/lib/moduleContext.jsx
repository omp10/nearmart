import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { useAuth } from '../auth/AuthProvider.jsx';
import { useModules } from '../components/ui.jsx';
import { GLOBAL, MODULE_EQUIVALENT, NAV_GROUPS } from '../nav.js';

const NAV_ITEMS = NAV_GROUPS.flatMap((g) => g.items);
/** List pages whose sub-pages show one module's record (an order, a product, a booking). */
const MODULE_RECORDS = ['/orders', '/products', '/bookings'];
const navItemFor = (pathname) => NAV_ITEMS.find((i) => i.to === `/${pathname.split('/')[1]}`);

/**
 * What the panel is focused on: the Global view (customers, settings, staff,
 * everything across modules) or one business module (Grocery, Produce,
 * Laundry, Electronics). Chosen with the sidebar tabs and remembered in this
 * browser between visits.
 *
 * `view` is 'global' or a module key; `module` is always a real module (the
 * last one chosen), so module pages keep working whatever the view.
 */
const STORAGE_KEY = 'nearmart.module';
/** The last real module, kept apart so a visit to Global doesn't forget it. */
const LAST_MODULE_KEY = 'nearmart.lastModule';
const ModuleContext = createContext(null);

const readStored = (key = STORAGE_KEY) => {
    try {
        return localStorage.getItem(key);
    } catch {
        return null;
    }
};

const store = (value, key = STORAGE_KEY) => {
    try {
        localStorage.setItem(key, value);
    } catch {
        /* private mode: the choice just isn't remembered */
    }
};

export function ModuleProvider({ children }) {
    // The API already limits an ops user's list to their assigned modules.
    const { data: modules = [] } = useModules();
    const { user, can } = useAuth();
    const canGlobal = user.role === 'admin';
    const [view, setViewState] = useState(() => readStored() || (canGlobal ? GLOBAL : 'grocery'));
    const [module, setModuleState] = useState(() => readStored(LAST_MODULE_KEY) || (readStored() && readStored() !== GLOBAL ? readStored() : 'grocery'));
    const isGlobal = view === GLOBAL;

    /** Focus one module (detail pages call this to follow the record they show). */
    const setModule = useCallback((key) => {
        setViewState(key);
        setModuleState(key);
        store(key);
        store(key, LAST_MODULE_KEY);
    }, []);

    const setGlobal = useCallback(() => {
        setViewState(GLOBAL);
        store(GLOBAL);
    }, []);

    // If the remembered module isn't one this user can see, fall back to their first;
    // ops users have no Global view.
    useEffect(() => {
        if (!modules.length) return;
        if (!modules.some((m) => m.key === module)) setModuleState(modules[0].key);
        if (isGlobal && !canGlobal) setModule(modules.some((m) => m.key === module) ? module : modules[0].key);
    }, [modules, module, isGlobal, canGlobal, setModule]);

    const navigate = useNavigate();
    const opensIn = useCallback((item, key) => item && item.views.includes(key) && (item.to === '/' || can(item.section)), [can]);

    /**
     * What the tabs call: switch, then leave pages that don't belong to the new
     * view (Orders → Laundry bookings, an old module's order or product → that
     * list, a module-only page → the dashboard when going Global).
     */
    const chooseModule = useCallback(
        (key) => {
            if (key === GLOBAL) setGlobal();
            else setModule(key);
            // Read the address bar, not router state: while a lazily loaded page is
            // still arriving, the router's location lags behind the URL.
            const { pathname } = window.location;
            const item = navItemFor(pathname);
            if (item && !opensIn(item, key)) {
                const swap = NAV_ITEMS.find((i) => i.to === MODULE_EQUIVALENT[item.to]);
                navigate(opensIn(swap, key) ? swap.to : '/');
            } else if (item && MODULE_RECORDS.includes(item.to) && pathname !== item.to) {
                navigate(item.to);
            }
        },
        [setGlobal, setModule, navigate, opensIn]
    );

    // Arriving on a page from a link, a notification or the address bar: show the
    // view that page belongs to (Customers → Global, Orders → a module).
    const { pathname } = useLocation();
    const viewRef = useRef(view);
    viewRef.current = view;
    useEffect(() => {
        const item = navItemFor(pathname);
        if (!item || item.views.includes(viewRef.current)) return;
        if (item.views.includes(GLOBAL) && canGlobal) setGlobal();
        else if (item.views.includes(module)) setModule(module);
        else {
            const first = modules.find((m) => item.views.includes(m.key));
            if (first) setModule(first.key);
        }
        // Only on navigation: the tabs handle view changes themselves.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [pathname]);

    const value = useMemo(
        () => ({ view, isGlobal, canGlobal, module, setModule, chooseModule, modules }),
        [view, isGlobal, canGlobal, module, setModule, chooseModule, modules]
    );
    return <ModuleContext.Provider value={value}>{children}</ModuleContext.Provider>;
}

export const useCurrentModule = () => {
    const ctx = useContext(ModuleContext);
    if (!ctx) throw new Error('useCurrentModule must be used inside ModuleProvider');
    return ctx;
};

export const PRODUCT_MODULES = ['grocery', 'produce', 'electronics'];

/**
 * In-page tabs over the same modules, kept in step with the header switcher.
 * `productOnly` hides Laundry for pages about products.
 */
export function ModuleTabs({ productOnly = false }) {
    const { module, chooseModule, modules } = useCurrentModule();
    const list = productOnly ? modules.filter((m) => m.key !== 'laundry') : modules;
    if (list.length < 2) return null;
    return (
        <div className="flex flex-wrap gap-1 rounded-lg bg-slate-100 p-1" role="tablist" aria-label="Module">
            {list.map((m) => (
                <button
                    key={m.key}
                    type="button"
                    role="tab"
                    aria-selected={module === m.key}
                    onClick={() => chooseModule(m.key)}
                    className={`rounded-md px-3 py-1.5 text-sm font-medium ${module === m.key ? 'bg-white shadow-sm' : 'text-slate-600'}`}
                >
                    {m.name}
                    {!m.isActive && <span className="ml-1 text-xs text-slate-400">(off)</span>}
                </button>
            ))}
        </div>
    );
}

/** Shown on product pages while Laundry is the selected module. */
export function LaundryHasItsOwnPages({ what }) {
    return (
        <div className="card text-sm text-slate-600">
            Laundry has no {what}; it works with services and bookings. Open{' '}
            <Link to="/laundry-services" className="font-medium text-brand-700 hover:underline">Laundry services</Link> or{' '}
            <Link to="/bookings" className="font-medium text-brand-700 hover:underline">Laundry bookings</Link>, or pick another module above.
        </div>
    );
}
