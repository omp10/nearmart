const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 0, maximumFractionDigits: 2 });

/** 12345678 → "₹1,23,456.78". The API sends money as whole paise. */
export const formatPaise = (paise) => (paise == null ? '—' : inr.format(paise / 100));

/** Form value in rupees ("123.45") → whole paise, or null when blank. */
export const rupeesToPaise = (value) => {
    if (value === '' || value == null) return null;
    const n = Number(value);
    return Number.isFinite(n) ? Math.round(n * 100) : NaN;
};

export const paiseToRupees = (paise) => (paise == null ? '' : String(paise / 100));

/** Signed amount for credits and debits: "+₹50", "−₹20". */
export const formatSignedPaise = (paise) => (paise == null ? '—' : `${paise < 0 ? '−' : '+'}${formatPaise(Math.abs(paise))}`);
