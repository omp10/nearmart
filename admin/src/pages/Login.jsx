import { useState } from 'react';
import { useAuth } from '../auth/AuthProvider.jsx';
import { errorMessage } from '../lib/api.js';

/** The logo's four shop colours as a short segmented bar. */
export function ShopStripe() {
    return (
        <div className="flex gap-1" aria-hidden="true">
            <span className="h-1 w-6 rounded-full bg-shop-grocery" />
            <span className="h-1 w-6 rounded-full bg-shop-produce" />
            <span className="h-1 w-6 rounded-full bg-shop-laundry" />
            <span className="h-1 w-6 rounded-full bg-shop-electronics" />
        </div>
    );
}

export default function Login() {
    const { login } = useAuth();
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [submitting, setSubmitting] = useState(false);

    const onSubmit = async (e) => {
        e.preventDefault();
        setError('');
        setSubmitting(true);
        try {
            await login(email, password);
        } catch (err) {
            setError(errorMessage(err, 'Could not sign in'));
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <div className="grid min-h-screen place-items-center bg-[radial-gradient(ellipse_at_top,_var(--color-brand-50),_var(--color-neutral-100)_60%)] px-4">
            <form onSubmit={onSubmit} className="w-full max-w-sm space-y-5 rounded-2xl border border-neutral-200 bg-white p-7 shadow-lg shadow-neutral-900/5">
                <div className="flex flex-col items-center gap-3 pt-1">
                    <img src="/brand/logo.png" alt="Nearmart" className="h-28 w-auto" />
                    <ShopStripe />
                    <h1 className="text-[11px] font-semibold tracking-[0.18em] text-neutral-500 uppercase">Admin panel</h1>
                </div>
                <p className="text-center text-sm text-slate-500">Sign in with your staff email and password.</p>

                {error && (
                    <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
                        {error}
                    </p>
                )}

                <div>
                    <label className="label" htmlFor="email">Email</label>
                    <input
                        id="email"
                        type="email"
                        className="input"
                        autoComplete="username"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        required
                    />
                </div>
                <div>
                    <label className="label" htmlFor="password">Password</label>
                    <input
                        id="password"
                        type="password"
                        className="input"
                        autoComplete="current-password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        required
                    />
                </div>

                <button type="submit" className="btn-primary w-full" disabled={submitting}>
                    {submitting ? 'Signing in…' : 'Sign in'}
                </button>
            </form>
        </div>
    );
}
