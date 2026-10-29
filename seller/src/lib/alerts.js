/**
 * New-order alerts: a chime made with the Web Audio API (no audio file), a
 * browser notification, and a flashing tab title. Browsers only allow sound
 * after a user gesture, so the seller turns alerts on with a click, and the
 * choice is remembered on this device.
 */

const PREF_KEY = 'nm_seller_order_alerts';

/** 'on', 'off', or null when the seller hasn't chosen yet. */
export const readAlertPref = () => {
    try {
        const v = window.localStorage.getItem(PREF_KEY);
        return v === 'on' || v === 'off' ? v : null;
    } catch {
        return null;
    }
};

export const writeAlertPref = (value) => {
    try {
        window.localStorage.setItem(PREF_KEY, value);
    } catch {
        // Private mode or blocked storage: the choice lasts until the page is reloaded.
    }
};

// ─── Sound ───

let audioCtx = null;

const getAudioContext = () => {
    if (audioCtx) return audioCtx;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    try {
        audioCtx = new Ctx();
    } catch {
        audioCtx = null;
    }
    return audioCtx;
};

/** Call from a click or key press: creates or resumes the audio context so later chimes can play. */
export const unlockAudio = () => {
    const ctx = getAudioContext();
    if (ctx?.state === 'suspended') ctx.resume().catch(() => {});
    return Boolean(ctx);
};

/** A short, bright three-note chime, played twice so it is hard to miss. */
export const playChime = () => {
    const ctx = getAudioContext();
    if (!ctx) return;
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    const notes = [880, 1174.66, 1567.98]; // A5, D6, G6
    const start = ctx.currentTime + 0.02;
    [0, 0.75].forEach((offset) => {
        notes.forEach((freq, i) => {
            const t = start + offset + i * 0.14;
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(freq, t);
            gain.gain.setValueAtTime(0.0001, t);
            gain.gain.exponentialRampToValueAtTime(0.35, t + 0.015);
            gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.45);
            osc.connect(gain).connect(ctx.destination);
            osc.start(t);
            osc.stop(t + 0.5);
        });
    });
};

// ─── Browser notifications ───

export const notificationsSupported = () => typeof window !== 'undefined' && 'Notification' in window;

export const notificationPermission = () => (notificationsSupported() ? window.Notification.permission : 'unsupported');

/** Asks for permission (must be called from a click). Resolves to the resulting permission. */
export const requestNotificationPermission = async () => {
    if (!notificationsSupported()) return 'unsupported';
    if (window.Notification.permission !== 'default') return window.Notification.permission;
    try {
        return await window.Notification.requestPermission();
    } catch {
        return window.Notification.permission;
    }
};

/** Shows a browser notification when allowed; clicking it focuses the tab and calls `onClick`. */
export const showBrowserNotification = (title, { body, tag, onClick } = {}) => {
    if (notificationPermission() !== 'granted') return;
    try {
        const n = new window.Notification(title, { body, tag, icon: `${import.meta.env.BASE_URL}brand/favicon.png`, renotify: Boolean(tag) });
        n.onclick = () => {
            window.focus();
            onClick?.();
            n.close();
        };
    } catch {
        // Some mobile browsers only allow notifications from a service worker.
    }
};

// ─── Tab title ───

let baseTitle = 'Nearmart Seller';
let flashTimer = null;
let flashStopTimer = null;

/** The title shown when nothing is flashing (the bell keeps the unread count in it). */
export const setBaseTitle = (title) => {
    baseTitle = title;
    if (!flashTimer) document.title = title;
};

export const stopTitleFlash = () => {
    clearInterval(flashTimer);
    clearTimeout(flashStopTimer);
    flashTimer = null;
    flashStopTimer = null;
    document.title = baseTitle;
};

/**
 * Alternates the tab title with `message`. It stops when the seller comes back
 * to the tab, or after 15 seconds if they were already looking at it.
 */
export const flashTitle = (message) => {
    stopTitleFlash();
    let on = false;
    flashTimer = setInterval(() => {
        on = !on;
        document.title = on ? message : baseTitle;
    }, 1000);
    document.title = message;
    if (!document.hidden) flashStopTimer = setTimeout(stopTitleFlash, 15_000);
};

if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden && flashTimer) flashStopTimer ??= setTimeout(stopTitleFlash, 4_000);
    });
}
