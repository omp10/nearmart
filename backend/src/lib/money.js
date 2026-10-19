/** 12345 → "₹123.45" for messages; amounts are whole paise everywhere else. */
export const formatRupees = (paise) =>
    `₹${(paise / 100).toLocaleString('en-IN', { minimumFractionDigits: paise % 100 ? 2 : 0, maximumFractionDigits: 2 })}`;

/** GST already included in a GST-inclusive amount. */
export const includedTax = (amountPaise, ratePercent) =>
    ratePercent ? Math.round((amountPaise * ratePercent) / (100 + ratePercent)) : 0;
