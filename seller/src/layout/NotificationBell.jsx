import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlarmClock, Bell, CircleCheck, CircleX, HandCoins, Package, PauseCircle, ShoppingBag, Store, Wallet } from 'lucide-react';
import { Link, useNavigate } from 'react-router';
import { useAuth } from '../auth/AuthProvider.jsx';
import { setBaseTitle } from '../lib/alerts.js';
import { api } from '../lib/api.js';
import { timeAgo } from '../lib/format.js';

export const NOTIFICATIONS_KEY = ['notifications'];

/** Where a notification leads, if anywhere the seller can open. */
export const notificationLink = (n, seller) => {
    const selling = seller?.status === 'approved' || seller?.status === 'suspended';
    if (!selling) return null;
    if (n.data?.orderId) return `/orders/${n.data.orderId}`;
    if (n.data?.payoutId) return `/payouts/${n.data.payoutId}`;
    if (n.type === 'seller.adjustment') return '/earnings#adjustments';
    if (n.type === 'seller.product.review' && n.data?.productId && seller.status === 'approved') return `/products/${n.data.productId}`;
    if (n.type === 'seller.module') return '/shops';
    return null;
};

/** Icon and colour per notification type, so a waiting order stands out from a payout. */
const TYPE_STYLES = {
    'seller.order.new': { icon: ShoppingBag, tone: 'bg-brand-50 text-brand-700', label: 'New order' },
    'seller.order.reminder': { icon: AlarmClock, tone: 'bg-red-50 text-red-600', label: 'Order waiting' },
    'seller.order.cancelled': { icon: CircleX, tone: 'bg-slate-100 text-slate-600', label: 'Order cancelled' },
    'seller.payout.paid': { icon: Wallet, tone: 'bg-brand-50 text-brand-700', label: 'Payout' },
    'seller.adjustment': { icon: HandCoins, tone: 'bg-sky-50 text-sky-700', label: 'Balance adjustment' },
    'seller.product.review': { icon: Package, tone: 'bg-amber-50 text-amber-700', label: 'Product review' },
    'seller.approved': { icon: CircleCheck, tone: 'bg-brand-50 text-brand-700', label: 'Store' },
    'seller.suspended': { icon: PauseCircle, tone: 'bg-red-50 text-red-600', label: 'Store' },
    'seller.module': { icon: Store, tone: 'bg-slate-100 text-slate-600', label: 'Shops' }
};

export function NotificationIcon({ type, small = false }) {
    const style = TYPE_STYLES[type] ?? { icon: Bell, tone: 'bg-slate-100 text-slate-500', label: 'Notification' };
    const Icon = style.icon;
    return (
        <span className={`grid shrink-0 place-items-center rounded-full ${style.tone} ${small ? 'h-7 w-7' : 'h-9 w-9'}`} title={style.label}>
            <Icon className={small ? 'h-3.5 w-3.5' : 'h-4 w-4'} aria-hidden="true" />
        </span>
    );
}

/** A reminder about an order still waiting is urgent: shown in red until read. */
export const isUrgent = (n) => n.type === 'seller.order.reminder' && !n.readAt;

/** The inbox preview, polled every 30 seconds; the unread count also goes in the tab title. */
export function useInbox() {
    return useQuery({
        queryKey: NOTIFICATIONS_KEY,
        queryFn: () => api.get('/notifications', { params: { limit: 15 } }).then((r) => r.data.data),
        refetchInterval: 30_000,
        refetchIntervalInBackground: true
    });
}

export default function NotificationBell() {
    const { seller } = useAuth();
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const [open, setOpen] = useState(false);
    const ref = useRef(null);
    const { data } = useInbox();
    const unread = data?.unread ?? 0;
    const refresh = () => queryClient.invalidateQueries({ queryKey: NOTIFICATIONS_KEY });
    const markAll = useMutation({ mutationFn: () => api.post('/notifications/read-all'), onSuccess: refresh });
    const selling = seller?.status === 'approved' || seller?.status === 'suspended';

    useEffect(() => {
        setBaseTitle(unread ? `(${unread}) Nearmart Seller` : 'Nearmart Seller');
    }, [unread]);

    useEffect(() => {
        if (!open) return undefined;
        const close = (e) => !ref.current?.contains(e.target) && setOpen(false);
        document.addEventListener('mousedown', close);
        return () => document.removeEventListener('mousedown', close);
    }, [open]);

    const openItem = (n) => {
        setOpen(false);
        if (!n.readAt) api.post(`/notifications/${n._id}/read`).then(refresh).catch(() => {});
        const to = notificationLink(n, seller);
        if (to) navigate(to);
    };

    return (
        <div className="relative" ref={ref}>
            <button
                type="button"
                className="relative grid h-10 w-10 place-items-center rounded-full border border-neutral-200 bg-white text-neutral-600 transition hover:bg-neutral-50"
                aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`}
                aria-expanded={open}
                onClick={() => setOpen((o) => !o)}
            >
                <Bell className="h-5 w-5" strokeWidth={1.8} aria-hidden="true" />
                {unread > 0 && (
                    <span className="absolute -right-0.5 -top-0.5 min-w-5 rounded-full bg-red-600 px-1 text-center text-[11px] font-semibold leading-5 text-white">
                        {unread > 99 ? '99+' : unread}
                    </span>
                )}
            </button>
            {open && (
                <div className="absolute right-0 z-30 mt-2 w-80 max-w-[calc(100vw-2rem)] rounded-xl border border-slate-200 bg-white shadow-lg">
                    <div className="flex items-center justify-between border-b border-slate-100 px-4 py-2">
                        <span className="text-sm font-semibold">Notifications</span>
                        {unread > 0 && <button type="button" className="text-xs text-brand-700 hover:underline" onClick={() => markAll.mutate()}>Mark all read</button>}
                    </div>
                    <ul className="max-h-96 overflow-y-auto">
                        {!data?.items.length && <li className="px-4 py-6 text-center text-sm text-slate-500">Nothing yet.</li>}
                        {data?.items.map((n) => (
                            <li key={n._id}>
                                <button type="button" className={`flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-slate-50 ${isUrgent(n) ? 'bg-red-50/70' : n.readAt ? '' : 'bg-brand-50/50'}`} onClick={() => openItem(n)}>
                                    <NotificationIcon type={n.type} small />
                                    <span className="min-w-0 flex-1">
                                        <span className="flex items-start justify-between gap-2">
                                            <span className={`text-sm font-medium ${isUrgent(n) ? 'text-red-700' : ''}`}>{n.title}</span>
                                            {!n.readAt && <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${isUrgent(n) ? 'bg-red-600' : 'bg-brand-600'}`} aria-label="unread" />}
                                        </span>
                                        {n.body && <span className="block text-xs text-slate-600">{n.body}</span>}
                                        <span className="block text-[11px] text-slate-400">{timeAgo(n.createdAt)}</span>
                                    </span>
                                </button>
                            </li>
                        ))}
                    </ul>
                    {selling && (
                        <Link to="/notifications" className="block border-t border-slate-100 px-4 py-2 text-center text-sm text-brand-700 hover:bg-slate-50" onClick={() => setOpen(false)}>
                            See all
                        </Link>
                    )}
                </div>
            )}
        </div>
    );
}
