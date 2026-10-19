import { useState } from 'react';
import { useAuth } from '../auth/AuthProvider.jsx';
import { errorMessage } from '../lib/api.js';

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
        <div className="grid min-h-screen place-items-center px-4">
            <form onSubmit={onSubmit} className="card w-full max-w-sm space-y-4">
                <div>
                    <h1 className="text-xl font-semibold text-brand-700">Nearmart</h1>
                    <p className="text-sm text-slate-500">Sign in to the admin panel</p>
                </div>

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
