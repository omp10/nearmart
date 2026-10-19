/**
 * India has one time zone and no daylight saving, so IST is a fixed +05:30
 * offset. Business dates and slot times are IST regardless of server TZ.
 */
const IST_OFFSET_MS = 330 * 60 * 1000;

/** The IST calendar date ("YYYY-MM-DD") of an instant. */
export const istDate = (instant = new Date()) => new Date(instant.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);

/** "YYYY-MM-DD" + n days. */
export const addDays = (date, n) => {
    const [y, m, d] = date.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};

/** 0 = Sunday … 6 = Saturday, for an IST calendar date. */
export const weekday = (date) => {
    const [y, m, d] = date.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
};

/** The instant at IST wall-clock `HH:MM` on `date`. */
export const istInstant = (date, hhmm) => {
    const [y, m, d] = date.split('-').map(Number);
    const [h, min] = hhmm.split(':').map(Number);
    return new Date(Date.UTC(y, m - 1, d, h, min) - IST_OFFSET_MS);
};

export const isValidDate = (date) => /^\d{4}-\d{2}-\d{2}$/.test(date) && addDays(date, 0) === date;
