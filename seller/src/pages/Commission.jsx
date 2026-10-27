import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import { formatPaise } from '../lib/money.js';
import { SHOPS, shopLabel } from '../lib/shops.js';
import { ErrorNote, Loading, PageHeader } from '../components/ui.jsx';

/** A worked example on a ₹1,000 order, so the rate means something. */
function Example({ percent, fixedFeePaise }) {
    const gross = 100000;
    const commission = Math.round((gross * percent) / 100);
    const fee = Math.min(fixedFeePaise, gross - commission);
    return (
        <p className="mt-2 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
            On {formatPaise(gross)} of items you earn <strong className="text-slate-900">{formatPaise(gross - commission - fee)}</strong>
            {' '}({formatPaise(gross)} − {formatPaise(commission)} commission{fee > 0 ? ` − ${formatPaise(fee)} fee` : ''}).
        </p>
    );
}

export default function Commission() {
    const { data, isLoading, error } = useQuery({
        queryKey: ['commission'],
        queryFn: () => api.get('/seller/commission').then((r) => r.data.data)
    });

    return (
        <div className="space-y-6">
            <PageHeader title="Commission" subtitle="What Nearmart charges, and when you get paid." />

            <section className="card space-y-3 text-sm text-slate-700">
                <h2 className="text-base font-semibold text-slate-900">How your earnings work</h2>
                <ul className="list-inside list-disc space-y-1.5">
                    <li>You earn the <strong>value of the items</strong> you supply on each delivered order (the prices customers paid for them).</li>
                    <li>Nearmart keeps a <strong>commission</strong> (a percentage of the item value) and, in some shops, a small <strong>fixed fee</strong> per order.</li>
                    <li>The <strong>delivery fee</strong> customers pay and any <strong>coupon discounts</strong> are Nearmart's. They never reduce your earnings.</li>
                    <li>Items you mark unavailable are not counted. Cancelled orders earn nothing.</li>
                    <li>The rate is fixed when the order is placed, so a later change never affects past orders.</li>
                </ul>
            </section>

            <ErrorNote error={error} />
            {isLoading && <Loading />}

            {data && (
                <>
                    <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                        {data.modules.length === 0 && <p className="text-sm text-slate-500">No approved shops yet.</p>}
                        {data.modules.map((m) => {
                            const Icon = SHOPS[m.key]?.icon;
                            return (
                                <div key={m.key} className="card">
                                    <p className="flex items-center gap-2 font-semibold text-slate-900">
                                        {Icon && <Icon className={`h-5 w-5 ${SHOPS[m.key].tint}`} aria-hidden="true" />}
                                        {shopLabel(m.key)}
                                    </p>
                                    <p className="mt-3 text-3xl font-semibold tabular-nums text-slate-900">{m.percent}%</p>
                                    <p className="text-sm text-slate-500">commission{m.fixedFeePaise > 0 ? ` + ${formatPaise(m.fixedFeePaise)} per order` : ', no fixed fee'}</p>
                                    <Example percent={m.percent} fixedFeePaise={m.fixedFeePaise} />
                                </div>
                            );
                        })}
                    </section>

                    <section className="card text-sm text-slate-700">
                        <h2 className="mb-2 text-base font-semibold text-slate-900">When you get paid</h2>
                        <p>
                            An order's money is held for <strong>{data.payoutHoldDays} day{data.payoutHoldDays === 1 ? '' : 's'}</strong> after delivery, in case of returns or complaints.
                            After that it is ready to be paid, and Nearmart includes it in your next payout to the bank account or UPI ID on your store profile.
                        </p>
                    </section>
                </>
            )}
        </div>
    );
}
