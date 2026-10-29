/** Weekly opening hours: day 0 = Sunday (as the API stores them), shown Monday first. */
export const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];

export const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/** "18:00"–"02:00" runs past midnight; equal times mean open all day. */
export const rangeKind = (open, close) => {
    if (!HHMM.test(open) || !HHMM.test(close)) return 'invalid';
    if (open === close) return 'allDay';
    return close < open ? 'overnight' : 'normal';
};

/** "09:00" → "9:00 AM". */
export const formatTime = (hhmm) => {
    if (!HHMM.test(hhmm ?? '')) return hhmm ?? '';
    const [h, m] = hhmm.split(':').map(Number);
    const suffix = h < 12 ? 'AM' : 'PM';
    return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${suffix}`;
};

export const formatRange = ({ open, close }) => {
    const kind = rangeKind(open, close);
    if (kind === 'allDay') return 'Open 24 hours';
    return `${formatTime(open)} – ${formatTime(close)}${kind === 'overnight' ? ' (next day)' : ''}`;
};

/** API rows → { 0: [{open, close}], 1: [...], ... } with every day present. */
export const groupByDay = (hours = []) => {
    const byDay = Object.fromEntries(DAY_NAMES.map((_, i) => [i, []]));
    hours.forEach((h) => byDay[h.day]?.push({ open: h.open, close: h.close }));
    Object.values(byDay).forEach((ranges) => ranges.sort((a, b) => a.open.localeCompare(b.open)));
    return byDay;
};

/** "12 Nov 2026, Thursday" for a YYYY-MM-DD holiday (read as a calendar date, no time zone shift). */
export const formatHoliday = (iso) => {
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
};
