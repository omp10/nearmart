import { CalendarCheck, Hourglass, IndianRupee, Wallet } from 'lucide-react';
import { formatPaise } from '../lib/money.js';

function BalanceTile({ icon: Icon, label, value, hint, tone = 'slate' }) {
    const tones = { slate: 'text-slate-500', green: 'text-brand-700', amber: 'text-amber-600', blue: 'text-sky-600' };
    return (
        <div className="rounded-lg border border-slate-100 bg-slate-50 p-3">
            <p className={`flex items-center gap-1.5 text-xs font-medium ${tones[tone]}`}>
                <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                {label}
            </p>
            <p className="mt-1 text-lg font-semibold tabular-nums text-slate-900">{value}</p>
            {hint && <p className="text-xs text-slate-500">{hint}</p>}
        </div>
    );
}

/** Where the seller's money stands (payout.service balanceFor). */
export function BalanceGrid({ balance, className = 'grid gap-3 sm:grid-cols-2' }) {
    return (
        <div className={className}>
            <BalanceTile icon={Wallet} tone="green" label="Ready to be paid" value={formatPaise(balance.payablePaise)} hint={`${balance.payableOrders} delivered order${balance.payableOrders === 1 ? '' : 's'}`} />
            <BalanceTile icon={Hourglass} tone="amber" label="On hold" value={formatPaise(balance.onHoldPaise)} hint="Recently delivered, in the hold period" />
            <BalanceTile icon={CalendarCheck} tone="blue" label="In a payout" value={formatPaise(balance.inPayoutPaise)} hint="Being paid out by Nearmart" />
            <BalanceTile icon={IndianRupee} label="Paid to you" value={formatPaise(balance.paidPaise)} hint="All time" />
        </div>
    );
}

export const PAYOUT_STATUS = {
    pending: { label: 'Being paid', tone: 'amber' },
    paid: { label: 'Paid', tone: 'green' },
    cancelled: { label: 'Cancelled', tone: 'slate' }
};

export const PAYOUT_MODES = { bank: 'Bank transfer', upi: 'UPI', cash: 'Cash', other: 'Other' };
