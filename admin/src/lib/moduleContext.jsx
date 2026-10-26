import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useAuth } from '../auth/AuthProvider.jsx';
import { useModules } from '../components/ui.jsx';
import { MODULE_EQUIVALENT, NAV_GROUPS } from '../nav.js';

const NAV_ITEMS = NAV_GROUPS.flatMap((g) => g.items);
/** List pages whose sub-pages show one module's record (an order, a product, a booking). */
const MODULE_RECORDS = ['/orders', '/products', '/bookings'];

/**
 * The business module the panel is focused on (Grocery, Produce, Laundry,
 * Electronics). Chosen in the header, followed by every module-aware page,
 * and remembered in this browser between visits.
 */
const STORAGE_KEY = 'nearmart.module';
const ModuleContext = createContext(null);

const readStored = () => {
    try {
        return localStorage.getItem(STORAGE_KEY);
    } catch {
        return null;
    }
};

export function ModuleProvider({ children }) {
    // The API already limits an ops user's list to their assigned modules.
    const { data: modules = [] } = useModules();
    const [module, setModuleState] = useState(() => readStored() || 'grocery');

    const setModule = useCallback((key) => {
        setModuleState(key);
        try {
            localStorage.setItem(STORAGE_KEY, key);
        } catch {
            /* private mode: the choice just isn't remembered */
        }
    }, []);

    // If the remembered module isn't one this user can see, fall back to their first.
    useEffect(() => {
        if (modules.length && !modules.some((m) => m.key === module)) setModule(modules[0].key);
    }, [modules, module, setModule]);

    const { can } = useAuth();
    const navigate = useNavigate();

    /**
     * What the module tabs call: switch, then leave pages that don't belong to
     * the new module (Orders → Laundry bookings, an old module's order or
     * product → that list). Detail pages call plain setModule to follow the
     * record they show.
     */
    const chooseModule = useCallback(
        (key) => {
            setModule(key);
            // Read the address bar, not router state: while a lazily loaded page is
            // still arriving, the router's location lags behind the URL.
            const { pathname } = window.location;
            const root = `/${pathname.split('/')[1]}`;
            const item = NAV_ITEMS.find((i) => i.to === root);
            const opens = (i) => i && (!i.modules || i.modules.includes(key)) && can(i.section);
            if (item && !opens(item)) {
                const swap = NAV_ITEMS.find((i) => i.to === MODULE_EQUIVALENT[root]);
                navigate(opens(swap) ? swap.to : '/');
            } else if (MODULE_RECORDS.includes(root) && pathname !== root) {
                navigate(root);
            }
        },
        [setModule, navigate, can]
    );

    const value = useMemo(() => ({ module, setModule, chooseModule, modules }), [module, setModule, chooseModule, modules]);
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
