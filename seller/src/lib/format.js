export const formatDate = (d) => (d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');

export const formatDateTime = (d) =>
    d ? new Date(d).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—';

export const timeAgo = (d) => {
    const mins = Math.round((Date.now() - new Date(d)) / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins} min ago`;
    const hours = Math.round(mins / 60);
    return hours < 24 ? `${hours} h ago` : new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
};

/** Local calendar date as YYYY-MM-DD (the API reads it as an India date). */
export const isoDay = (date = new Date()) => {
    const d = new Date(date);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export const firstOfMonth = (date = new Date()) => isoDay(new Date(date.getFullYear(), date.getMonth(), 1));

/** "+91 98765 43210" / "098765 43210" → "9876543210"; anything that isn't a phone number is returned trimmed. */
export const normalizePhone = (value) => {
    const raw = String(value ?? '').trim();
    if (!/^[+\d\s-]+$/.test(raw)) return raw;
    const digits = raw.replace(/\D/g, '');
    if (digits.length === 12 && digits.startsWith('91')) return digits.slice(2);
    if (digits.length === 11 && digits.startsWith('0')) return digits.slice(1);
    return digits;
};
