import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../auth/AuthProvider.jsx';
import { api } from '../lib/api.js';
import { paiseToRupees, rupeesToPaise } from '../lib/money.js';
import { Badge, ErrorNote } from '../components/ui.jsx';

const POLICIES = [
    ['terms', 'Terms of service'],
    ['privacy', 'Privacy policy'],
    ['refund', 'Refund policy'],
    ['cancellation', 'Cancellation policy'],
    ['delivery', 'Delivery policy']
];

/** One card per section; each saves only its own fields. */
function Section({ title, description, children, onSave, saving, error, saved }) {
    const { can } = useAuth();
    return (
        <form
            className="card space-y-4"
            onSubmit={(e) => {
                e.preventDefault();
                onSave();
            }}
        >
            <div>
                <h2 className="font-semibold">{title}</h2>
                {description && <p className="text-sm text-slate-500">{description}</p>}
            </div>
            <ErrorNote error={error} />
            <fieldset disabled={!can('settings', 'update')} className="min-w-0 space-y-4">{children}</fieldset>
            {can('settings', 'update') && (
                <div className="flex items-center justify-end gap-3">
                    {saved && <span className="text-sm text-brand-700" role="status">Saved</span>}
                    <button type="submit" className="btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
                </div>
            )}
        </form>
    );
}

function useSection(section) {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (values) => api.patch('/admin/settings', { [section]: values }),
        onSuccess: (res) => queryClient.setQueryData(['settings'], res.data.data)
    });
}

const SOURCE_LABELS = {
    panel: 'Using the keys saved here',
    environment: "Using the server's environment keys",
    none: 'Not configured: online payment is off'
};

/** Shows a saved secret only as "set · ends in 1234"; the API never returns secrets. */
const secretHint = (s) => (s?.set ? `Saved · ends in ${s.last4}. Leave blank to keep it.` : 'Not set');

/** Razorpay credentials (super admin). Secrets are write-only from here. */
function PaymentGateway() {
    const queryClient = useQueryClient();
    const { data: g, isLoading, error } = useQuery({
        queryKey: ['payment-gateway'],
        queryFn: () => api.get('/admin/settings/payment-gateway').then((r) => r.data.data)
    });
    const [form, setForm] = useState({ keyId: '', keySecret: '', webhookSecret: '' });
    useEffect(() => {
        if (g) setForm({ keyId: g.keyId, keySecret: '', webhookSecret: '' });
    }, [g]);
    const onSaved = (res) => queryClient.setQueryData(['payment-gateway'], res.data.data);
    const save = useMutation({ mutationFn: (body) => api.put('/admin/settings/payment-gateway', body), onSuccess: onSaved });
    const reset = useMutation({ mutationFn: () => api.delete('/admin/settings/payment-gateway'), onSuccess: onSaved });

    if (isLoading) return <p className="text-sm text-slate-500">Loading payment gateway…</p>;
    if (!g) return <ErrorNote error={error} />;
    const webhookUrl = `${window.location.origin}/api/v1/payments/webhook/razorpay`;

    return (
        <form
            className="card space-y-4"
            onSubmit={(e) => {
                e.preventDefault();
                save.mutate(form);
            }}
        >
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                    <h2 className="font-semibold">Payment gateway</h2>
                    <p className="text-sm text-slate-500">Razorpay keys for online payment in every module. Only the super admin sees this.</p>
                </div>
                <div className="flex flex-wrap gap-1.5">
                    <Badge tone={g.enabled ? 'green' : 'red'}>{SOURCE_LABELS[g.source]}</Badge>
                    {g.mode && <Badge tone={g.mode === 'live' ? 'green' : 'amber'}>{g.mode === 'live' ? 'Live mode' : 'Test mode'}</Badge>}
                </div>
            </div>
            <ErrorNote error={save.error || reset.error} />
            {!g.canSave && (
                <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
                    The server needs a SECRETS_KEY before keys can be saved here; until then it uses its environment keys.
                </p>
            )}
            <fieldset disabled={!g.canSave} className="grid min-w-0 gap-4 sm:grid-cols-2">
                <div className="sm:col-span-2">
                    <label className="label" htmlFor="pg-key">Key id</label>
                    <input id="pg-key" className="input font-mono" placeholder="rzp_live_…" value={form.keyId} onChange={(e) => setForm({ ...form, keyId: e.target.value })} required />
                </div>
                <div>
                    <label className="label" htmlFor="pg-secret">Key secret</label>
                    <input id="pg-secret" type="password" autoComplete="new-password" className="input font-mono" value={form.keySecret} onChange={(e) => setForm({ ...form, keySecret: e.target.value })} />
                    <p className="mt-1 text-xs text-slate-500">{secretHint(g.keySecret)}</p>
                </div>
                <div>
                    <label className="label" htmlFor="pg-webhook">Webhook secret</label>
                    <input id="pg-webhook" type="password" autoComplete="new-password" className="input font-mono" value={form.webhookSecret} onChange={(e) => setForm({ ...form, webhookSecret: e.target.value })} />
                    <p className="mt-1 text-xs text-slate-500">{secretHint(g.webhookSecret)}</p>
                </div>
            </fieldset>
            <div className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
                In Razorpay → Settings → Webhooks, point a webhook at <span className="font-mono">{webhookUrl}</span> with the same secret, for the events
                payment.captured, payment.failed, order.paid and refund.processed.
            </div>
            <div className="flex flex-wrap items-center justify-end gap-3">
                {save.isSuccess && <span className="text-sm text-brand-700" role="status">Saved</span>}
                {g.source === 'panel' && (
                    <button type="button" className="btn-ghost" disabled={reset.isPending} onClick={() => window.confirm('Forget these keys and use the server environment keys?') && reset.mutate()}>
                        Use environment keys
                    </button>
                )}
                <button type="submit" className="btn-primary" disabled={!g.canSave || save.isPending}>{save.isPending ? 'Saving…' : 'Save keys'}</button>
            </div>
        </form>
    );
}

export default function Settings() {
    const { user } = useAuth();
    const { data, isLoading, error } = useQuery({ queryKey: ['settings'], queryFn: () => api.get('/admin/settings').then((r) => r.data.data) });
    const [contact, setContact] = useState(null);
    const [policies, setPolicies] = useState(null);
    const [orders, setOrders] = useState(null);
    const [operations, setOperations] = useState(null);
    const [maps, setMaps] = useState(null);
    const [policyTab, setPolicyTab] = useState('terms');
    const [formError, setFormError] = useState('');

    useEffect(() => {
        if (!data || contact) return;
        setContact(data.contact);
        setPolicies(data.policies);
        setOrders({ ...data.orders, codMax: paiseToRupees(data.orders.codMaxOrderPaise) });
        setOperations(data.operations);
        setMaps({ googleApiKey: data.maps?.googleApiKey ?? '' });
    }, [data, contact]);

    const saveContact = useSection('contact');
    const savePolicies = useSection('policies');
    const saveOrders = useSection('orders');
    const saveOperations = useSection('operations');
    const saveMaps = useSection('maps');

    if (error) return <ErrorNote error={error} />;
    if (isLoading || !contact) return <p className="text-sm text-slate-500">Loading…</p>;

    return (
        <div className="space-y-6">
            <div>
                <h1 className="text-2xl font-semibold">Settings</h1>
                <p className="text-sm text-slate-500">Global: these apply to every module. Shown in the customer app and applied at checkout.</p>
            </div>

            <Section
                title="Taking orders"
                description="Pause new orders and laundry bookings across all modules, for example on a holiday or during a stock-take."
                onSave={() => saveOperations.mutate(operations)}
                saving={saveOperations.isPending}
                error={saveOperations.error}
                saved={saveOperations.isSuccess}
            >
                <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={operations.acceptingOrders} onChange={(e) => setOperations({ ...operations, acceptingOrders: e.target.checked })} />
                    Accepting new orders and bookings
                </label>
                {!operations.acceptingOrders && (
                    <div>
                        <label className="label" htmlFor="s-paused">Message to customers</label>
                        <input id="s-paused" className="input" maxLength={200} placeholder="We are closed for Diwali and back on Monday." value={operations.pausedMessage} onChange={(e) => setOperations({ ...operations, pausedMessage: e.target.value })} />
                    </div>
                )}
            </Section>

            <Section
                title="Payments"
                onSave={() => {
                    const codMaxOrderPaise = rupeesToPaise(orders.codMax);
                    if (Number.isNaN(codMaxOrderPaise)) return setFormError('Cash limit must be a number');
                    setFormError('');
                    return saveOrders.mutate({ codEnabled: orders.codEnabled, onlinePaymentEnabled: orders.onlinePaymentEnabled, codMaxOrderPaise });
                }}
                saving={saveOrders.isPending}
                error={formError || saveOrders.error}
                saved={saveOrders.isSuccess}
            >
                <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={orders.codEnabled} onChange={(e) => setOrders({ ...orders, codEnabled: e.target.checked })} />
                    Cash on delivery
                </label>
                <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={orders.onlinePaymentEnabled} onChange={(e) => setOrders({ ...orders, onlinePaymentEnabled: e.target.checked })} />
                    Online payment (Razorpay)
                </label>
                <div className="max-w-xs">
                    <label className="label" htmlFor="s-codmax">Cash on delivery up to (₹)</label>
                    <input id="s-codmax" type="number" min="0" step="1" className="input" placeholder="No limit" value={orders.codMax} onChange={(e) => setOrders({ ...orders, codMax: e.target.value })} />
                </div>
            </Section>

            {user.isSuperAdmin && <PaymentGateway />}

            <Section
                title="Google Maps"
                description="The customer app uses this key for address search, filling in addresses from a map pin, and map previews. Changes reach the app on its next start; no app update needed."
                onSave={() => saveMaps.mutate({ googleApiKey: maps.googleApiKey.trim() })}
                saving={saveMaps.isPending}
                error={saveMaps.error}
                saved={saveMaps.isSuccess}
            >
                <div>
                    <label className="label" htmlFor="s-mapskey">API key</label>
                    <input id="s-mapskey" className="input font-mono" placeholder="AIza…" value={maps.googleApiKey} onChange={(e) => setMaps({ googleApiKey: e.target.value })} />
                </div>
                <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
                    In Google Cloud, enable <strong>Places API (New)</strong>, <strong>Geocoding API</strong> and <strong>Maps Static API</strong> for this key, and
                    restrict it to those APIs. Leave it empty to turn these features off; the app then asks for the address by hand.
                </p>
            </Section>

            <Section title="Contact details" onSave={() => saveContact.mutate(contact)} saving={saveContact.isPending} error={saveContact.error} saved={saveContact.isSuccess}>
                <div className="grid gap-4 sm:grid-cols-2">
                    {[['phone', 'Phone'], ['whatsapp', 'WhatsApp'], ['email', 'Email'], ['supportHours', 'Support hours']].map(([key, label]) => (
                        <div key={key}>
                            <label className="label" htmlFor={`c-${key}`}>{label}</label>
                            <input id={`c-${key}`} className="input" type={key === 'email' ? 'email' : 'text'} value={contact[key]} onChange={(e) => setContact({ ...contact, [key]: e.target.value })} />
                        </div>
                    ))}
                    <div className="sm:col-span-2">
                        <label className="label" htmlFor="c-address">Address</label>
                        <textarea id="c-address" className="input" rows={2} maxLength={300} value={contact.address} onChange={(e) => setContact({ ...contact, address: e.target.value })} />
                    </div>
                </div>
            </Section>

            <Section title="Policies" description="Plain text. The app shows these on its policy pages." onSave={() => savePolicies.mutate(policies)} saving={savePolicies.isPending} error={savePolicies.error} saved={savePolicies.isSuccess}>
                <div className="flex flex-wrap gap-1" role="tablist" aria-label="Policy">
                    {POLICIES.map(([key, label]) => (
                        <button
                            key={key}
                            type="button"
                            role="tab"
                            aria-selected={policyTab === key}
                            onClick={() => setPolicyTab(key)}
                            className={`rounded-md px-3 py-1.5 text-sm ${policyTab === key ? 'bg-slate-100 font-medium' : 'text-slate-600'}`}
                        >
                            {label}
                        </button>
                    ))}
                </div>
                <textarea
                    className="input font-mono text-sm"
                    rows={12}
                    maxLength={20000}
                    aria-label={POLICIES.find(([k]) => k === policyTab)[1]}
                    value={policies[policyTab]}
                    onChange={(e) => setPolicies({ ...policies, [policyTab]: e.target.value })}
                />
            </Section>
        </div>
    );
}
