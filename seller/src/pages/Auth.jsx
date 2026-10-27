import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { Eye, EyeOff, Info } from 'lucide-react';
import { useAuth } from '../auth/AuthProvider.jsx';
import { api, fieldErrors } from '../lib/api.js';
import { normalizePhone } from '../lib/format.js';
import { asset, ShopStripe } from '../layout/Brand.jsx';
import { ErrorNote, Field } from '../components/ui.jsx';

const PHONE = /^[6-9]\d{9}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Field rules shared by the sign-in, sign-up and reset forms. Each returns a message, or '' when fine. */
const check = {
    phone: (v) => (!v.trim() ? 'Enter your mobile number' : PHONE.test(normalizePhone(v)) ? '' : 'Enter a valid 10-digit mobile number'),
    login: (v) => {
        const t = v.trim();
        if (!t) return 'Enter your mobile number or email';
        if (t.includes('@')) return EMAIL.test(t) ? '' : 'Enter a valid email address';
        return PHONE.test(normalizePhone(t)) ? '' : 'Enter a 10-digit mobile number or an email address';
    },
    password: (v) => (v ? '' : 'Enter your password'),
    newPassword: (v) => (!v ? 'Choose a password' : v.length < 10 ? `Use at least 10 characters (${10 - v.length} more)` : ''),
    otp: (v) => (!v ? 'Enter the OTP we sent you' : /^\d{4,8}$/.test(v) ? '' : 'The OTP is 4 to 8 digits'),
    businessName: (v) => (v.trim().length < 2 ? 'Enter your shop or business name' : ''),
    ownerName: (v) => (v.trim().length < 2 ? 'Enter your name' : ''),
    email: (v) => (!v.trim() ? 'Enter your email' : EMAIL.test(v.trim()) ? '' : 'Enter a valid email address')
};

/**
 * Inline validation: a field's message shows once it has been left (blur) or
 * the form submitted, and the server's own field errors show until the field
 * is edited again.
 */
function useValidation(values, rules, serverErrors) {
    const [touched, setTouched] = useState({});
    const [submitted, setSubmitted] = useState(false);
    const [edited, setEdited] = useState({});
    const local = Object.fromEntries(Object.entries(rules).map(([name, rule]) => [name, rule(values[name] ?? '')]));
    const valid = Object.values(local).every((m) => !m);
    const errors = {};
    for (const name of Object.keys(rules)) {
        if ((touched[name] || submitted) && local[name]) errors[name] = local[name];
        else if (serverErrors[name] && !edited[name]) errors[name] = serverErrors[name];
    }
    return {
        errors,
        valid,
        /** Props for an input: marks it touched on blur, and fresh on edit. */
        bind: (name) => ({
            onBlur: () => setTouched((t) => ({ ...t, [name]: true })),
            onInput: () => setEdited((e) => ({ ...e, [name]: true })),
            'aria-invalid': errors[name] ? true : undefined,
            'aria-describedby': errors[name] ? `${name}-error` : undefined
        }),
        /** Call on submit: shows every message and says whether to go ahead. */
        submit: () => {
            setSubmitted(true);
            setEdited({});
            return valid;
        },
        reset: () => {
            setTouched({});
            setSubmitted(false);
            setEdited({});
        }
    };
}

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

function PasswordInput({ id, value, onChange, autoComplete, ...rest }) {
    const [show, setShow] = useState(false);
    return (
        <div className="relative">
            <input id={id} type={show ? 'text' : 'password'} className="input pr-10" autoComplete={autoComplete} value={value} onChange={onChange} maxLength={200} {...rest} />
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
    const v = useValidation(form, { login: check.login, password: check.password }, fieldErrors(error));

    const onSubmit = async (e) => {
        e.preventDefault();
        if (!v.submit()) return;
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
            <form onSubmit={onSubmit} className="space-y-4" noValidate>
                {notice && <p className="rounded-lg bg-brand-50 px-3 py-2 text-sm text-brand-800" role="status">{notice}</p>}
                <ErrorNote error={error} />
                <Field label="Mobile number or email" htmlFor="login" errors={v.errors} path="login">
                    <input id="login" className="input" autoComplete="username" placeholder="98765 43210 or you@shop.com" value={form.login} onChange={(e) => setForm({ ...form, login: e.target.value })} {...v.bind('login')} />
                </Field>
                <Field label="Password" htmlFor="password" errors={v.errors} path="password">
                    <PasswordInput id="password" autoComplete="current-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} {...v.bind('password')} />
                </Field>
                <div className="text-right">
                    <Link to="/forgot" className="text-sm text-brand-700 hover:underline">Forgot password?</Link>
                </div>
                <button type="submit" className="btn-primary w-full py-2.5" disabled={submitting || !v.valid}>
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
    const phoneCheck = useValidation({ phone }, { phone: check.phone }, errors);
    const v = useValidation(
        form,
        { otp: check.otp, businessName: check.businessName, ownerName: check.ownerName, email: check.email, password: check.newPassword },
        errors
    );

    const requestOtp = async (e) => {
        e?.preventDefault();
        if (!phoneCheck.submit()) return;
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
        if (!v.submit()) return;
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
                <form onSubmit={requestOtp} className="space-y-4" noValidate>
                    <ErrorNote error={error} />
                    <Field label="Mobile number" htmlFor="phone" errors={phoneCheck.errors} path="phone" hint="We'll send a one-time code (OTP) to this number.">
                        <input id="phone" type="tel" inputMode="tel" className="input" autoComplete="tel" placeholder="98765 43210" maxLength={16} value={phone} onChange={(e) => setPhone(e.target.value)} {...phoneCheck.bind('phone')} />
                    </Field>
                    <button type="submit" className="btn-primary w-full py-2.5" disabled={busy || !phoneCheck.valid}>{busy ? 'Sending OTP…' : 'Send OTP'}</button>
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
            <form onSubmit={onSubmit} className="space-y-4" noValidate>
                <DevOtp code={devOtp} />
                <ErrorNote error={error} />
                <Field label="OTP" htmlFor="otp" errors={v.errors} path="otp">
                    <input id="otp" className="input tracking-widest" inputMode="numeric" autoComplete="one-time-code" maxLength={8} value={form.otp} onChange={(e) => set({ otp: e.target.value.replace(/\D/g, '') })} {...v.bind('otp')} />
                </Field>
                <div className="flex justify-between text-sm">
                    <button type="button" className="text-brand-700 hover:underline" onClick={() => { setStep(1); setError(null); v.reset(); }}>Change number</button>
                    <button type="button" className="text-brand-700 hover:underline disabled:opacity-60" disabled={busy} onClick={() => requestOtp()}>Resend OTP</button>
                </div>
                <Field label="Business name" htmlFor="businessName" errors={v.errors} path="businessName" hint="The name customers will see">
                    <input id="businessName" className="input" value={form.businessName} onChange={(e) => set({ businessName: e.target.value })} maxLength={120} autoComplete="organization" {...v.bind('businessName')} />
                </Field>
                <Field label="Your name" htmlFor="ownerName" errors={v.errors} path="ownerName">
                    <input id="ownerName" className="input" value={form.ownerName} onChange={(e) => set({ ownerName: e.target.value })} maxLength={80} autoComplete="name" {...v.bind('ownerName')} />
                </Field>
                <Field label="Email" htmlFor="email" errors={v.errors} path="email">
                    <input id="email" type="email" className="input" value={form.email} onChange={(e) => set({ email: e.target.value })} maxLength={120} autoComplete="email" {...v.bind('email')} />
                </Field>
                <Field label="Password" htmlFor="new-password" errors={v.errors} path="password" hint={v.errors.password ? undefined : 'At least 10 characters'}>
                    <PasswordInput id="new-password" autoComplete="new-password" value={form.password} onChange={(e) => set({ password: e.target.value })} {...v.bind('password')} />
                </Field>
                <button type="submit" className="btn-primary w-full py-2.5" disabled={busy || !v.valid}>{busy ? 'Creating account…' : 'Create account'}</button>
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
    const phoneCheck = useValidation({ phone }, { phone: check.phone }, errors);
    const v = useValidation({ otp, password }, { otp: check.otp, password: check.newPassword }, errors);

    const requestOtp = async (e) => {
        e?.preventDefault();
        if (!phoneCheck.submit()) return;
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
        if (!v.submit()) return;
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
                <form onSubmit={requestOtp} className="space-y-4" noValidate>
                    <ErrorNote error={error} />
                    <Field label="Mobile number" htmlFor="phone" errors={phoneCheck.errors} path="phone">
                        <input id="phone" type="tel" inputMode="tel" className="input" autoComplete="tel" placeholder="98765 43210" maxLength={16} value={phone} onChange={(e) => setPhone(e.target.value)} {...phoneCheck.bind('phone')} />
                    </Field>
                    <button type="submit" className="btn-primary w-full py-2.5" disabled={busy || !phoneCheck.valid}>{busy ? 'Sending OTP…' : 'Send OTP'}</button>
                </form>
            ) : (
                <form onSubmit={onReset} className="space-y-4" noValidate>
                    <DevOtp code={devOtp} />
                    <ErrorNote error={error} />
                    <Field label="OTP" htmlFor="otp" errors={v.errors} path="otp">
                        <input id="otp" className="input tracking-widest" inputMode="numeric" autoComplete="one-time-code" maxLength={8} value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))} {...v.bind('otp')} />
                    </Field>
                    <Field label="New password" htmlFor="new-password" errors={v.errors} path="password" hint={v.errors.password ? undefined : 'At least 10 characters'}>
                        <PasswordInput id="new-password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} {...v.bind('password')} />
                    </Field>
                    <div className="flex justify-between text-sm">
                        <button type="button" className="text-brand-700 hover:underline" onClick={() => { setStep(1); setError(null); v.reset(); }}>Change number</button>
                        <button type="button" className="text-brand-700 hover:underline disabled:opacity-60" disabled={busy} onClick={() => requestOtp()}>Resend OTP</button>
                    </div>
                    <button type="submit" className="btn-primary w-full py-2.5" disabled={busy || !v.valid}>{busy ? 'Saving…' : 'Set new password'}</button>
                </form>
            )}
        </AuthCard>
    );
}

