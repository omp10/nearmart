import { useEffect, useRef, useSyncExternalStore } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import { BellRing, Volume2, VolumeX } from 'lucide-react';
import { api } from '../lib/api.js';
import {
    flashTitle, notificationPermission, notificationsSupported, playChime, readAlertPref, requestNotificationPermission,
    showBrowserNotification, unlockAudio, writeAlertPref
} from '../lib/alerts.js';
import { useInbox } from './NotificationBell.jsx';

// ─── The seller's choice, shared by the prompt and the header button ───

const listeners = new Set();
let pref = readAlertPref();

const setPref = (value) => {
    pref = value;
    writeAlertPref(value);
    listeners.forEach((fn) => fn());
};

const subscribe = (fn) => {
    listeners.add(fn);
    return () => listeners.delete(fn);
};

export const useAlertPref = () => useSyncExternalStore(subscribe, () => pref, () => pref);

/** Turns alerts on from a click: unlocks sound, asks for notification permission, plays the chime once. */
export const enableAlerts = async () => {
    unlockAudio();
    setPref('on');
    playChime();
    await requestNotificationPermission();
    listeners.forEach((fn) => fn());
};

export const disableAlerts = () => setPref('off');

// ─── New orders ───

/** Orders waiting to be accepted (newest first), polled every 20 seconds, also in a background tab. */
export function useNewOrders(enabled) {
    return useQuery({
        queryKey: ['orders', 'new-count'],
        queryFn: () =>
            api.get('/seller/orders', { params: { status: 'placed', limit: 20 } }).then((r) => ({
                total: r.data.data.total,
                items: r.data.data.items.map((o) => ({ _id: o._id, orderNumber: o.orderNumber, totalPaise: o.pricing?.totalPaise }))
            })),
        refetchInterval: 20_000,
        refetchIntervalInBackground: true,
        enabled
    });
}

/**
 * Watches for orders that weren't there on the last poll, and for "order is
 * waiting" reminders, and raises the alarm: title flash always; chime and
 * browser notification when the seller turned alerts on.
 */
export function useOrderAlerts(enabled) {
    const navigate = useNavigate();
    const alertPref = useAlertPref();
    const { data: orders } = useNewOrders(enabled);
    const { data: inbox } = useInbox();
    const seenOrders = useRef(null);
    const seenReminders = useRef(null);
    const prefRef = useRef(alertPref);
    prefRef.current = alertPref;

    // After a reload the audio context needs a gesture again; the first click or key press unlocks it.
    useEffect(() => {
        if (alertPref !== 'on') return undefined;
        const unlock = () => unlockAudio();
        window.addEventListener('pointerdown', unlock, { once: true });
        window.addEventListener('keydown', unlock, { once: true });
        return () => {
            window.removeEventListener('pointerdown', unlock);
            window.removeEventListener('keydown', unlock);
        };
    }, [alertPref]);

    useEffect(() => {
        if (!orders) return;
        const ids = orders.items.map((o) => o._id);
        if (!seenOrders.current) {
            // First load: these were already waiting; the badge and dashboard show them.
            seenOrders.current = new Set(ids);
            return;
        }
        const fresh = orders.items.filter((o) => !seenOrders.current.has(o._id));
        ids.forEach((id) => seenOrders.current.add(id));
        if (!fresh.length) return;

        const title = fresh.length === 1 ? `New order #${fresh[0].orderNumber}` : `${fresh.length} new orders`;
        flashTitle(`● ${title}`);
        if (prefRef.current !== 'on') return;
        playChime();
        showBrowserNotification(title, {
            body: fresh.length === 1 ? 'Accept it in the Nearmart seller dashboard.' : fresh.map((o) => `#${o.orderNumber}`).join(', '),
            tag: fresh.length === 1 ? `order-${fresh[0]._id}` : 'new-orders',
            onClick: () => navigate(fresh.length === 1 ? `/orders/${fresh[0]._id}` : '/orders?status=placed')
        });
    }, [orders, navigate]);

    useEffect(() => {
        if (!inbox?.items) return;
        const reminders = inbox.items.filter((n) => n.type === 'seller.order.reminder' && !n.readAt);
        if (!seenReminders.current) {
            seenReminders.current = new Set(inbox.items.map((n) => n._id));
            return;
        }
        const fresh = reminders.filter((n) => !seenReminders.current.has(n._id));
        inbox.items.forEach((n) => seenReminders.current.add(n._id));
        if (!fresh.length) return;

        const first = fresh[0];
        flashTitle(`● ${first.title}`);
        if (prefRef.current !== 'on') return;
        playChime();
        showBrowserNotification(first.title, {
            body: first.body,
            tag: `reminder-${first.data?.orderId ?? first._id}`,
            onClick: () => navigate(first.data?.orderId ? `/orders/${first.data.orderId}` : '/orders?status=placed')
        });
    }, [inbox, navigate]);
}

// ─── UI ───

/** One-time card asking the seller to turn on alerts (needs their click for sound and permission). */
export function OrderAlertsPrompt() {
    const alertPref = useAlertPref();
    if (alertPref !== null) return null;
    return (
        <div className="flex flex-wrap items-start gap-3 rounded-xl border border-brand-200 bg-brand-50 px-4 py-3 text-sm text-brand-800" role="status">
            <BellRing className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
            <div className="min-w-0 flex-1">
                <p className="font-semibold">Don't miss an order</p>
                <p className="mt-0.5">Turn on order alerts to hear a chime and get a notification on this device whenever a new order comes in, even when this tab is in the background.</p>
            </div>
            <div className="flex flex-wrap gap-2">
                <button type="button" className="btn-ghost" onClick={disableAlerts}>Not now</button>
                <button type="button" className="btn-primary" onClick={enableAlerts}>Enable order alerts</button>
            </div>
        </div>
    );
}

/** Header button: shows whether order alerts are on and switches them. */
export function OrderAlertsToggle() {
    const alertPref = useAlertPref();
    const on = alertPref === 'on';
    const blocked = on && notificationsSupported() && notificationPermission() === 'denied';
    const label = on
        ? blocked
            ? 'Order alerts on (sound only: notifications are blocked in this browser). Turn off'
            : 'Order alerts on. Turn off'
        : 'Order alerts off. Turn on';
    return (
        <button
            type="button"
            className={`relative grid h-10 w-10 place-items-center rounded-full border transition ${on ? 'border-brand-200 bg-brand-50 text-brand-700 hover:bg-brand-100' : 'border-neutral-200 bg-white text-neutral-500 hover:bg-neutral-50'}`}
            aria-label={label}
            aria-pressed={on}
            title={label}
            onClick={() => (on ? disableAlerts() : enableAlerts())}
        >
            {on ? <Volume2 className="h-5 w-5" strokeWidth={1.8} aria-hidden="true" /> : <VolumeX className="h-5 w-5" strokeWidth={1.8} aria-hidden="true" />}
            {blocked && <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-amber-500" aria-hidden="true" />}
        </button>
    );
}
