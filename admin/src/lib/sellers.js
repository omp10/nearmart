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

/** "10% + ₹5" style summary of a commission; `format` turns paise into money text. */
export const commissionText = ({ percent, fixedFeePaise } = {}, format) =>
    `${percent ?? 0}%${fixedFeePaise ? ` + ${format(fixedFeePaise)}` : ''}`;
