/** Mirrors backend/src/modules/sellers (seller.model.js). */
export const SELLER_STATUS_LABELS = {
    draft: 'Draft',
    submitted: 'Pending review',
    approved: 'Approved',
    rejected: 'Rejected',
    suspended: 'Suspended'
};

export const SELLER_STATUS_TONES = {
    draft: 'slate',
    submitted: 'amber',
    approved: 'green',
    rejected: 'red',
    suspended: 'red'
};

export const MODULE_REQUEST_LABELS = { pending: 'Waiting', approved: 'Approved', rejected: 'Rejected' };
export const MODULE_REQUEST_TONES = { pending: 'amber', approved: 'green', rejected: 'red' };

export const DOCUMENT_LABELS = {
    gst: 'GST certificate',
    pan: 'PAN card',
    fssai: 'FSSAI licence',
    shop_license: 'Shop licence',
    cancelled_cheque: 'Cancelled cheque',
    id_proof: 'ID proof',
    other: 'Other'
};

/** Shops a seller can sell in (laundry is Nearmart's own service). */
export const SELLER_MODULES = ['grocery', 'produce', 'electronics'];

export const PAYOUT_STATUS_LABELS = { pending: 'To pay', paid: 'Paid', cancelled: 'Cancelled' };
export const PAYOUT_STATUS_TONES = { pending: 'amber', paid: 'green', cancelled: 'slate' };

export const PAYOUT_MODES = [
    { id: 'bank', label: 'Bank transfer' },
    { id: 'upi', label: 'UPI' },
    { id: 'cash', label: 'Cash' },
    { id: 'other', label: 'Other' }
];
export const PAYOUT_MODE_LABELS = Object.fromEntries(PAYOUT_MODES.map((m) => [m.id, m.label]));

/** Seller opening hours use day 0 = Sunday (India time). */
export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** Field paths in the seller's kycWarnings → readable names. */
export const KYC_FIELD_LABELS = {
    'legal.pan': 'PAN',
    'legal.gstin': 'GSTIN',
    'legal.fssai': 'FSSAI licence',
    'bank.ifsc': 'IFSC'
};

export const PRODUCT_REVIEW_LABELS = { pending: 'Waiting', approved: 'Approved', rejected: 'Sent back' };
export const PRODUCT_REVIEW_TONES = { pending: 'amber', approved: 'green', rejected: 'red' };

/** Rows (arrays) → CSV text, quoting every cell that needs it. */
export const toCsv = (rows) =>
    rows
        .map((row) =>
            row
                .map((cell) => {
                    const s = cell == null ? '' : String(cell);
                    return /[",\n\r]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
                })
                .join(',')
        )
        .join('\r\n');

/** Saves text as a file in the browser. */
export const downloadText = (filename, text, type = 'text/csv;charset=utf-8') => {
    const url = URL.createObjectURL(new Blob([`﻿${text}`], { type }));
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
};

/** "10% + ₹5" style summary of a commission; `format` turns paise into money text. */
export const commissionText = ({ percent, fixedFeePaise } = {}, format) =>
    `${percent ?? 0}%${fixedFeePaise ? ` + ${format(fixedFeePaise)}` : ''}`;
