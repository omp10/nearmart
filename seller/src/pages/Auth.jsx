import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { Eye, EyeOff, Info } from 'lucide-react';
import { useAuth } from '../auth/AuthProvider.jsx';
import { api, fieldErrors } from '../lib/api.js';
import { normalizePhone } from '../lib/format.js';
import { asset, ShopStripe } from '../layout/Brand.jsx';
import { ErrorNote, Field } from '../components/ui.jsx';

function AuthCard({ title, subtitle, children, footer }) {
    return (
        <div className="grid min-h-screen place-items-center bg-[radial-gradient(ellipse_at_top,_var(--color-brand-50),_var(--color-neutral-100)_60%)] px-4 py-8">
            <div className="w-full max-w-md">
                <div className="space-y-5 rounded-2xl border border-neutral-200 bg-white p-6 shadow-lg shadow-neutral-900/5 sm:p-7">
                    <div className="flex flex-col items-center gap-3 pt-1 text-center">
                        <img src={asset('brand/logo.png')} alt="Nearmart" className="h-24 w-auto" />
                        <ShopStripe />
                        <p className="text-[11px] font-semibold tracking-[0.18em] text-brand-700 uppercase">Seller dashboard</p>
                        <h1 className="text-xl font-semibold">{title}</h1>
                        {subtitle && <p className="-mt-2 text-sm text-slate-500">{subtitle}</p>}
                    </div>
                    {children}
                </div>
                {footer && <div className="mt-4 text-center text-sm text-slate-600">{footer}</div>}
            </div>
        </div>
    );
}

function PasswordInput({ id, value, onChange, autoComplete, minLength }) {
    const [show, setShow] = useState(false);
    return (
        <div className="relative">
            <input id={id} type={show ? 'text' : 'password'} className="input pr-10" autoComplete={autoComplete} value={value} onChange={onChange} required minLength={minLength} maxLength={200} />
            <button type="button" className="absolute top-1/2 right-2 -translate-y-1/2 rounded p-1 text-slate-500 hover:text-slate-800" aria-label={show ? 'Hide password' : 'Show password'} onClick={() => setShow((s) => !s)}>
                {show ? <EyeOff className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}
            </button>
        </div>
    );
}

/** Test servers return the OTP so the flow can be tried without SMS. */
function DevOtp({ code }) {
    if (!code) return null;
    return (
        <p className="flex items-center gap-2 rounded-lg bg-sky-50 px-3 py-2 text-sm text-sky-800">
            <Info className="h-4 w-4 shrink-0" aria-hidden="true" />
            Test server: your OTP is <strong className="tracking-widest">{code}</strong>
        </p>
    );
}

export function Login() {
    const { login } = useAuth();
    const location = useLocation();
    const [form, setForm] = useState({ login: '', password: '' });
    const [error, setError] = useState(null);
    const [submitting, setSubmitting] = useState(false);
    const notice = location.state?.notice;

    const onSubmit = async (e) => {
        e.preventDefault();
        setError(null);
        setSubmitting(true);
        try {
            const raw = form.login.trim();
            await login(raw.includes('@') ? raw.toLowerCase() : normalizePhone(raw), form.password);
        } catch (err) {
            setError(err);
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <AuthCard
            title="Sign in to your store"
            footer={<>New to Nearmart? <Link to="/signup" className="font-medium text-brand-700 hover:underline">Start selling</Link></>}
        >
            <form onSubmit={onSubmit} className="space-y-4">
                {notice && <p className="rounded-lg bg-brand-50 px-3 py-2 text-sm text-brand-800" role="status">{notice}</p>}
                <ErrorNote error={error} />
                <Field label="Mobile number or email" htmlFor="login">
                    <input id="login" className="input" autoComplete="username" value={form.login} onChange={(e) => setForm({ ...form, login: e.target.value })} required />
                </Field>
                <Field label="Password" htmlFor="password">
                    <PasswordInput id="password" autoComplete="current-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
                </Field>
                <div className="text-right">
                    <Link to="/forgot" className="text-sm text-brand-700 hover:underline">Forgot password?</Link>
                </div>
                <button type="submit" className="btn-primary w-full py-2.5" disabled={submitting}>
                    {submitting ? 'Signing in…' : 'Sign in'}
                </button>
            </form>
        </AuthCard>
    );
}

export function Signup() {
    const { signup } = useAuth();
    const [step, setStep] = useState(1);
    const [phone, setPhone] = useState('');
    const [devOtp, setDevOtp] = useState('');
    const [form, setForm] = useState({ otp: '', businessName: '', ownerName: '', email: '', password: '' });
    const [error, setError] = useState(null);
    const [busy, setBusy] = useState(false);
    const errors = fieldErrors(error);
    const set = (patch) => setForm((f) => ({ ...f, ...patch }));

    const requestOtp = async (e) => {
        e?.preventDefault();
        setError(null);
        setBusy(true);
        try {
            const res = await api.post('/auth/seller/signup/request-otp', { phone: normalizePhone(phone) }, { skipAuthRefresh: true });
            setDevOtp(res.data.data?.devOtp ?? '');
            setStep(2);
        } catch (err) {
            setError(err);
        } finally {
            setBusy(false);
        }
    };

    const onSubmit = async (e) => {
        e.preventDefault();
        setError(null);
        setBusy(true);
        try {
            await signup({ phone: normalizePhone(phone), ...form, email: form.email.trim() });
        } catch (err) {
            setError(err);
            setBusy(false);
        }
    };

    if (step === 1) {
        return (
            <AuthCard
                title="Sell on Nearmart"
                subtitle="Reach customers near your shop. Let's start with your mobile number."
                footer={<>Already selling? <Link to="/login" className="font-medium text-brand-700 hover:underline">Sign in</Link></>}
            >
                <form onSubmit={requestOtp} className="space-y-4">
                    <ErrorNote error={error} />
                    <Field label="Mobile number" htmlFor="phone" errors={errors} path="phone" hint="We'll send a one-time code (OTP) to this number.">
                        <input id="phone" type="tel" inputMode="tel" className="input" autoComplete="tel" placeholder="98765 43210" value={phone} onChange={(e) => setPhone(e.target.value)} required />
                    </Field>
                    <button type="submit" className="btn-primary w-full py-2.5" disabled={busy}>{busy ? 'Sending OTP…' : 'Send OTP'}</button>
                </form>
            </AuthCard>
        );
    }

    return (
        <AuthCard
            title="Create your seller account"
            subtitle={`OTP sent to ${normalizePhone(phone)}`}
            footer={<>Already selling? <Link to="/login" className="font-medium text-brand-700 hover:underline">Sign in</Link></>}
        >
            <form onSubmit={onSubmit} className="space-y-4">
                <DevOtp code={devOtp} />
                <ErrorNote error={error} />
                <Field label="OTP" htmlFor="otp" errors={errors} path="otp">
                    <input id="otp" className="input tracking-widest" inputMode="numeric" autoComplete="one-time-code" maxLength={8} value={form.otp} onChange={(e) => set({ otp: e.target.value.replace(/\D/g, '') })} required />
                </Field>
                <div className="flex justify-between text-sm">
                    <button type="button" className="text-brand-700 hover:underline" onClick={() => { setStep(1); setError(null); }}>Change number</button>
                    <button type="button" className="text-brand-700 hover:underline disabled:opacity-60" disabled={busy} onClick={() => requestOtp()}>Resend OTP</button>
                </div>
                <Field label="Business name" htmlFor="businessName" errors={errors} path="businessName" hint="The name customers will see">
                    <input id="businessName" className="input" value={form.businessName} onChange={(e) => set({ businessName: e.target.value })} required minLength={2} maxLength={120} autoComplete="organization" />
                </Field>
                <Field label="Your name" htmlFor="ownerName" errors={errors} path="ownerName">
                    <input id="ownerName" className="input" value={form.ownerName} onChange={(e) => set({ ownerName: e.target.value })} required minLength={2} maxLength={80} autoComplete="name" />
                </Field>
                <Field label="Email" htmlFor="email" errors={errors} path="email">
                    <input id="email" type="email" className="input" value={form.email} onChange={(e) => set({ email: e.target.value })} required autoComplete="email" />
                </Field>
                <Field label="Password" htmlFor="new-password" errors={errors} path="password" hint="At least 10 characters">
                    <PasswordInput id="new-password" autoComplete="new-password" minLength={10} value={form.password} onChange={(e) => set({ password: e.target.value })} />
                </Field>
                <button type="submit" className="btn-primary w-full py-2.5" disabled={busy}>{busy ? 'Creating account…' : 'Create account'}</button>
            </form>
        </AuthCard>
    );
}

export function Forgot() {
    const navigate = useNavigate();
    const [step, setStep] = useState(1);
    const [phone, setPhone] = useState('');
    const [devOtp, setDevOtp] = useState('');
    const [sentMessage, setSentMessage] = useState('');
    const [otp, setOtp] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState(null);
    const [busy, setBusy] = useState(false);
    const errors = fieldErrors(error);

    const requestOtp = async (e) => {
        e?.preventDefault();
        setError(null);
        setBusy(true);
        try {
            const res = await api.post('/auth/seller/forgot/request-otp', { phone: normalizePhone(phone) }, { skipAuthRefresh: true });
            setDevOtp(res.data.data?.devOtp ?? '');
            setSentMessage(res.data.message);
            setStep(2);
        } catch (err) {
            setError(err);
        } finally {
            setBusy(false);
        }
    };

    const onReset = async (e) => {
        e.preventDefault();
        setError(null);
        setBusy(true);
        try {
            const res = await api.post('/auth/seller/forgot/reset', { phone: normalizePhone(phone), otp, password }, { skipAuthRefresh: true });
            navigate('/login', { replace: true, state: { notice: res.data.message || 'Password changed. Please sign in.' } });
        } catch (err) {
            setError(err);
            setBusy(false);
        }
    };

    return (
        <AuthCard
            title="Reset your password"
            subtitle={step === 1 ? 'Enter the mobile number you signed up with.' : sentMessage || undefined}
            footer={<Link to="/login" className="font-medium text-brand-700 hover:underline">Back to sign in</Link>}
        >
            {step === 1 ? (
                <form onSubmit={requestOtp} className="space-y-4">
                    <ErrorNote error={error} />
                    <Field label="Mobile number" htmlFor="phone" errors={errors} path="phone">
                        <input id="phone" type="tel" inputMode="tel" className="input" autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)} required />
                    </Field>
                    <button type="submit" className="btn-primary w-full py-2.5" disabled={busy}>{busy ? 'Sending OTP…' : 'Send OTP'}</button>
                </form>
            ) : (
                <form onSubmit={onReset} className="space-y-4">
                    <DevOtp code={devOtp} />
                    <ErrorNote error={error} />
                    <Field label="OTP" htmlFor="otp" errors={errors} path="otp">
                        <input id="otp" className="input tracking-widest" inputMode="numeric" autoComplete="one-time-code" maxLength={8} value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))} required />
                    </Field>
                    <Field label="New password" htmlFor="new-password" errors={errors} path="password" hint="At least 10 characters">
                        <PasswordInput id="new-password" autoComplete="new-password" minLength={10} value={password} onChange={(e) => setPassword(e.target.value)} />
                    </Field>
                    <div className="flex justify-between text-sm">
                        <button type="button" className="text-brand-700 hover:underline" onClick={() => { setStep(1); setError(null); }}>Change number</button>
                        <button type="button" className="text-brand-700 hover:underline disabled:opacity-60" disabled={busy} onClick={() => requestOtp()}>Resend OTP</button>
                    </div>
                    <button type="submit" className="btn-primary w-full py-2.5" disabled={busy}>{busy ? 'Saving…' : 'Set new password'}</button>
                </form>
            )}
        </AuthCard>
    );
}

