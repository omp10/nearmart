import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { useModules } from '../components/ui.jsx';

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

    const value = useMemo(() => ({ module, setModule, modules }), [module, setModule, modules]);
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
    const { module, setModule, modules } = useCurrentModule();
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
                    onClick={() => setModule(m.key)}
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
