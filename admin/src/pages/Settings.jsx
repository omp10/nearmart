import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../auth/AuthProvider.jsx';
import { api } from '../lib/api.js';
import { paiseToRupees, rupeesToPaise } from '../lib/money.js';
import { ErrorNote } from '../components/ui.jsx';

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

export default function Settings() {
    const { data, isLoading, error } = useQuery({ queryKey: ['settings'], queryFn: () => api.get('/admin/settings').then((r) => r.data.data) });
    const [contact, setContact] = useState(null);
    const [policies, setPolicies] = useState(null);
    const [orders, setOrders] = useState(null);
    const [operations, setOperations] = useState(null);
    const [policyTab, setPolicyTab] = useState('terms');
    const [formError, setFormError] = useState('');

    useEffect(() => {
        if (!data || contact) return;
        setContact(data.contact);
        setPolicies(data.policies);
        setOrders({ ...data.orders, codMax: paiseToRupees(data.orders.codMaxOrderPaise) });
        setOperations(data.operations);
    }, [data, contact]);

    const saveContact = useSection('contact');
    const savePolicies = useSection('policies');
    const saveOrders = useSection('orders');
    const saveOperations = useSection('operations');

    if (error) return <ErrorNote error={error} />;
    if (isLoading || !contact) return <p className="text-sm text-slate-500">Loading…</p>;

    return (
        <div className="space-y-6">
            <div>
                <h1 className="text-2xl font-semibold">Settings</h1>
                <p className="text-sm text-slate-500">Shown in the customer app and applied at checkout.</p>
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
