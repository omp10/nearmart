import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { AlertTriangle, Check, CheckCircle2, Clock, PartyPopper, RefreshCw } from 'lucide-react';
import { useAuth } from '../auth/AuthProvider.jsx';
import { api, fieldErrors } from '../lib/api.js';
import { formatDateTime } from '../lib/format.js';
import { MODULE_STATUS, documentLabel, missingForSubmit, shopLabel } from '../lib/shops.js';
import { TopBar } from '../layout/AppLayout.jsx';
import { BrandMark } from '../layout/Brand.jsx';
import { AddressForm, BankForm, BusinessForm, DocumentsManager, ShopsForm, TaxForm } from '../components/sellerForms.jsx';
import { Badge, ErrorNote, Notice, useShopOptions } from '../components/ui.jsx';

/** Header-only frame for the screens before approval. */
export function PreApprovalShell({ children }) {
    return (
        <div className="min-h-screen">
            <TopBar>
                <BrandMark subtitle="Seller" />
            </TopBar>
            <main className="mx-auto w-full max-w-4xl space-y-6 p-4 lg:p-8">{children}</main>
        </div>
    );
}

const STEPS = [
    { key: 'business', title: 'Business', done: (s) => Boolean(s.businessName && s.ownerName) },
    { key: 'address', title: 'Shop address', done: (s) => Boolean(s.address?.line1 && s.address?.city && s.address?.pincode) },
    { key: 'shops', title: "Where you'll sell", done: (s) => s.modules?.length > 0 },
    { key: 'tax', title: 'Tax & documents', done: (s) => Boolean(s.legal?.pan && s.documents?.length) },
    { key: 'bank', title: 'Bank', done: (s) => Boolean((s.bank?.accountNumber && s.bank?.ifsc) || s.bank?.upiId) },
    { key: 'review', title: 'Review & submit', done: () => false }
];

const TAX_STEP = STEPS.findIndex((s) => s.key === 'tax');
const BANK_STEP = STEPS.findIndex((s) => s.key === 'bank');

function Stepper({ seller, current, onPick }) {
    const listRef = useRef(null);
    // Keep the current step visible when the list scrolls sideways on phones.
    useEffect(() => {
        listRef.current?.querySelector('[aria-current="step"]')?.scrollIntoView({ block: 'nearest', inline: 'center' });
    }, [current]);
    return (
        <ol ref={listRef} className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0">
            {STEPS.map((s, i) => {
                const done = s.done(seller);
                const active = i === current;
                return (
                    <li key={s.key} className="shrink-0">
                        <button
                            type="button"
                            onClick={() => onPick(i)}
                            aria-current={active ? 'step' : undefined}
                            className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-medium transition ${
                                active ? 'border-brand-700 bg-brand-700 text-white' : done ? 'border-brand-200 bg-brand-50 text-brand-800' : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'
                            }`}
                        >
                            <span className={`grid h-5 w-5 place-items-center rounded-full text-[11px] ${active ? 'bg-white/20' : done ? 'bg-brand-700 text-white' : 'bg-slate-100'}`}>
                                {done && !active ? <Check className="h-3 w-3" aria-hidden="true" /> : i + 1}
                            </span>
                            {s.title}
                        </button>
                    </li>
                );
            })}
        </ol>
    );
}

function SummarySection({ title, onEdit, children }) {
    return (
        <section className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="mb-2 flex items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
                {onEdit && <button type="button" className="text-sm text-brand-700 hover:underline" onClick={onEdit}>Edit</button>}
            </div>
            <div className="space-y-1 text-sm text-slate-700">{children}</div>
        </section>
    );
}

function Line({ label, value }) {
    return (
        <p className="flex flex-wrap gap-x-2">
            <span className="text-slate-500">{label}:</span>
            <span className="min-w-0 break-words">{value || <span className="text-slate-400">Not given</span>}</span>
        </p>
    );
}

const maskAccount = (n) => (n ? `•••• ${String(n).slice(-4)}` : '');

/** Everything in the application, read-only. `onEdit(stepIndex)` adds Edit links. */
export function ApplicationSummary({ seller, onEdit }) {
    const { data: shopOptions = [] } = useShopOptions();
    const categoryName = (key, id) => shopOptions.find((s) => s.key === key)?.categories.find((c) => c.id === String(id))?.name ?? 'Category';
    const a = seller.address ?? {};
    const edit = (i) => (onEdit ? () => onEdit(i) : undefined);

    return (
        <div className="grid gap-4 md:grid-cols-2">
            <SummarySection title="Business" onEdit={edit(0)}>
                <div className="flex items-center gap-3">
                    {seller.store?.logo && <img src={seller.store.logo} alt="" className="h-12 w-12 rounded-lg border border-slate-200 object-cover" />}
                    <div>
                        <p className="font-medium text-slate-900">{seller.businessName}</p>
                        <p className="text-slate-500">Owner: {seller.ownerName}</p>
                    </div>
                </div>
                {seller.store?.description && <p className="text-slate-600">{seller.store.description}</p>}
                <Line label="Phone" value={seller.store?.supportPhone || seller.phone} />
                <Line label="Email" value={seller.email} />
            </SummarySection>
            <SummarySection title="Shop address" onEdit={edit(1)}>
                {a.line1 ? (
                    <p>
                        {[a.line1, a.line2].filter(Boolean).join(', ')}
                        {a.landmark && <span className="block text-slate-500">Near {a.landmark}</span>}
                        <span className="block">{[a.city, a.state, a.pincode].filter(Boolean).join(', ')}</span>
                    </p>
                ) : (
                    <p className="text-slate-400">Not given</p>
                )}
                <Line label="Location pin" value={a.lat != null && a.lng != null ? `${a.lat}, ${a.lng}` : ''} />
            </SummarySection>
            <SummarySection title="Where you'll sell" onEdit={edit(2)}>
                {seller.modules?.length ? (
                    <ul className="space-y-2">
                        {seller.modules.map((m) => (
                            <li key={m.key}>
                                <span className="flex flex-wrap items-center gap-2">
                                    <span className="font-medium">{shopLabel(m.key)}</span>
                                    {seller.status !== 'draft' && <Badge tone={MODULE_STATUS[m.status]?.tone}>{MODULE_STATUS[m.status]?.label}</Badge>}
                                </span>
                                <span className="block text-xs text-slate-500">
                                    {m.categories?.length ? m.categories.map((c) => categoryName(m.key, c)).join(', ') : 'All categories'}
                                </span>
                                {m.note && <span className="block text-xs text-slate-600">Note from Nearmart: {m.note}</span>}
                            </li>
                        ))}
                    </ul>
                ) : (
                    <p className="text-slate-400">No shops picked</p>
                )}
            </SummarySection>
            <SummarySection title="Tax & documents" onEdit={edit(3)}>
                <Line label="PAN" value={seller.legal?.pan} />
                <Line label="GSTIN" value={seller.legal?.gstin} />
                <Line label="FSSAI" value={seller.legal?.fssai} />
                <Line label="Documents" value={seller.documents?.map((d) => documentLabel(d.type)).join(', ')} />
            </SummarySection>
            <SummarySection title="Bank" onEdit={edit(4)}>
                <Line label="Account name" value={seller.bank?.accountName} />
                <Line label="Account number" value={maskAccount(seller.bank?.accountNumber)} />
                <Line label="IFSC" value={seller.bank?.ifsc} />
                <Line label="UPI ID" value={seller.bank?.upiId} />
            </SummarySection>
        </div>
    );
}

function ReviewStep({ seller, onEdit }) {
    const { setSeller } = useAuth();
    const missing = missingForSubmit(seller);
    const submit = useMutation({
        mutationFn: () => api.post('/seller/application/submit').then((r) => r.data.data),
        onSuccess: setSeller
    });
    // PAN, GSTIN, FSSAI and IFSC format problems come back as field details.
    const kycErrors = Object.entries(fieldErrors(submit.error)).filter(([path]) => path.startsWith('legal.') || path.startsWith('bank.'));

    return (
        <div className="space-y-5">
            <ApplicationSummary seller={seller} onEdit={onEdit} />
            {missing.length > 0 ? (
                <Notice tone="amber" icon={AlertTriangle} title="A few things are still missing">
                    <ul className="mt-1 list-inside list-disc">
                        {missing.map((m) => <li key={m}>{m}</li>)}
                    </ul>
                </Notice>
            ) : (
                <Notice tone="green" icon={CheckCircle2} title="Everything needed is filled in">
                    Check the details above, then send your application. Nearmart usually reviews it within 2 working days.
                </Notice>
            )}
            {kycErrors.length > 0 ? (
                <Notice tone="red" icon={AlertTriangle} title="Some details need fixing before you can submit">
                    <ul className="mt-1 space-y-1">
                        {kycErrors.map(([path, message]) => (
                            <li key={path} className="flex flex-wrap items-center gap-x-2">
                                <span>{message}</span>
                                <button type="button" className="font-medium underline" onClick={() => onEdit(path.startsWith('bank.') ? BANK_STEP : TAX_STEP)}>
                                    Fix {path.startsWith('bank.') ? 'bank details' : 'tax details'}
                                </button>
                            </li>
                        ))}
                    </ul>
                </Notice>
            ) : (
                <ErrorNote error={submit.error} />
            )}
            <div className="flex justify-end">
                <button type="button" className="btn-primary px-6 py-2.5" onClick={() => submit.mutate()} disabled={submit.isPending}>
                    {submit.isPending ? 'Sending…' : seller.status === 'rejected' ? 'Send application again' : 'Submit application'}
                </button>
            </div>
        </div>
    );
}

export default function Application() {
    const { seller } = useAuth();
    const firstOpen = STEPS.findIndex((s) => !s.done(seller));
    const [step, setStep] = useState(firstOpen === -1 ? STEPS.length - 1 : firstOpen);
    const next = () => {
        setStep((s) => Math.min(s + 1, STEPS.length - 1));
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };
    const current = STEPS[step];
    const continueLabel = 'Save and continue';

    return (
        <PreApprovalShell>
            <div>
                <h1 className="text-2xl font-semibold">{seller.status === 'rejected' ? 'Update your application' : `Welcome, ${seller.ownerName?.split(' ')[0] ?? 'there'}!`}</h1>
                <p className="mt-0.5 text-sm text-slate-500">
                    Tell us about {seller.businessName}. Your answers are saved at every step, so you can finish later.
                </p>
            </div>

            {seller.status === 'rejected' && (
                <Notice tone="red" icon={AlertTriangle} title="Nearmart needs some changes before approving your store">
                    <p className="whitespace-pre-line">{seller.rejectionReason || 'Please check your details and send the application again.'}</p>
                </Notice>
            )}

            <Stepper seller={seller} current={step} onPick={setStep} />

            <section className="card">
                <h2 className="mb-4 text-lg font-semibold">
                    <span className="text-slate-400">Step {step + 1} of {STEPS.length} · </span>
                    {current.title}
                </h2>
                {current.key === 'business' && <BusinessForm seller={seller} submitLabel={continueLabel} onSaved={next} />}
                {current.key === 'address' && <AddressForm seller={seller} submitLabel={continueLabel} onSaved={next} />}
                {current.key === 'shops' && <ShopsForm seller={seller} submitLabel={continueLabel} onSaved={next} />}
                {current.key === 'tax' && (
                    <div className="space-y-6">
                        <TaxForm seller={seller} submitLabel="Save tax details" />
                        <div>
                            <h3 className="font-semibold">Documents</h3>
                            <p className="mb-3 text-sm text-slate-500">Upload at least one: your PAN card, plus GST certificate, FSSAI licence or shop licence if you have them. A cancelled cheque helps us check your bank details.</p>
                            <DocumentsManager seller={seller} canRemove />
                        </div>
                        <div className="flex justify-end border-t border-slate-100 pt-4">
                            <button type="button" className="btn-primary" onClick={next}>Continue</button>
                        </div>
                    </div>
                )}
                {current.key === 'bank' && <BankForm seller={seller} submitLabel={continueLabel} onSaved={next} />}
                {current.key === 'review' && <ReviewStep seller={seller} onEdit={setStep} />}
            </section>

            {step > 0 && (
                <button type="button" className="btn-ghost" onClick={() => setStep(step - 1)}>← Back to {STEPS[step - 1].title}</button>
            )}
        </PreApprovalShell>
    );
}

/** Shown while Nearmart reviews the application; checks for a decision every minute. */
export function UnderReview() {
    const { seller, reloadSeller } = useAuth();
    const check = useQuery({
        queryKey: ['me-check'],
        queryFn: reloadSeller,
        refetchInterval: 60_000,
        refetchOnWindowFocus: true
    });

    return (
        <PreApprovalShell>
            <div className="card flex flex-col items-center gap-3 py-8 text-center">
                <span className="grid h-14 w-14 place-items-center rounded-full bg-amber-50 text-amber-600">
                    <Clock className="h-7 w-7" aria-hidden="true" />
                </span>
                <h1 className="text-2xl font-semibold">Your application is under review</h1>
                <p className="max-w-lg text-sm text-slate-600">
                    Thanks, {seller.ownerName?.split(' ')[0]}! Nearmart is checking your details. We'll send you a notification as soon as your store is approved,
                    usually within 2 working days.
                </p>
                {seller.submittedAt && <p className="text-xs text-slate-500">Sent on {formatDateTime(seller.submittedAt)}</p>}
                <button type="button" className="btn-outline mt-2" onClick={() => check.refetch()} disabled={check.isFetching}>
                    <RefreshCw className={`h-4 w-4 ${check.isFetching ? 'animate-spin' : ''}`} aria-hidden="true" />
                    {check.isFetching ? 'Checking…' : 'Check status'}
                </button>
                {check.isFetched && !check.isFetching && seller.status === 'submitted' && <p className="text-xs text-slate-500">Still under review.</p>}
            </div>
            <Notice tone="blue" icon={PartyPopper} title="While you wait">
                Get your product list, prices and photos ready. Once approved you can add products and open your store straight away.
            </Notice>
            <div>
                <h2 className="mb-3 text-lg font-semibold">What you sent</h2>
                <ApplicationSummary seller={seller} />
            </div>
        </PreApprovalShell>
    );
}
