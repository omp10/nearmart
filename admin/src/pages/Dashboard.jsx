import { useAuth } from '../auth/AuthProvider.jsx';
import { BUSINESS_MODULES } from '../nav.js';

/** Placeholder until orders and catalogue exist (scope §7: counts and summaries). */
export default function Dashboard() {
    const { user } = useAuth();
    const modules = user.role === 'ops' ? BUSINESS_MODULES.filter((m) => user.modules.includes(m.id)) : BUSINESS_MODULES;

    return (
        <div className="space-y-6">
            <div>
                <h1 className="text-2xl font-semibold">Welcome, {user.name}</h1>
                <p className="text-sm text-slate-500">Order, customer and catalogue summaries appear here as those modules go live.</p>
            </div>

            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                {modules.map((m) => (
                    <div key={m.id} className="card">
                        <div className="text-sm text-slate-500">{m.label}</div>
                        <div className="mt-2 text-2xl font-semibold text-slate-300">—</div>
                        <div className="mt-1 text-xs text-slate-400">Orders today</div>
                    </div>
                ))}
            </div>
        </div>
    );
}
