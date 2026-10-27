import { Leaf, Plug, ShoppingCart, Store } from 'lucide-react';

/** The product shops a seller can sell in (laundry is Nearmart's own service). */
export const SHOPS = {
    grocery: { label: 'Grocery', blurb: 'Packaged food, staples, household items', icon: ShoppingCart, tint: 'text-shop-grocery' },
    produce: { label: 'Fruits & vegetables', blurb: 'Fresh fruits, vegetables and herbs', icon: Leaf, tint: 'text-shop-produce' },
    electronics: { label: 'Electrical & electronics', blurb: 'Appliances, gadgets, wiring and fittings', icon: Plug, tint: 'text-shop-electronics' }
};

export const shopLabel = (key) => SHOPS[key]?.label ?? key;
export const shopIcon = (key) => SHOPS[key]?.icon ?? Store;

export const MODULE_STATUS = {
    pending: { label: 'Waiting for approval', tone: 'amber' },
    approved: { label: 'Approved', tone: 'green' },
    rejected: { label: 'Not approved', tone: 'red' }
};

export const DOCUMENT_TYPES = [
    { key: 'pan', label: 'PAN card' },
    { key: 'gst', label: 'GST certificate' },
    { key: 'fssai', label: 'FSSAI licence' },
    { key: 'shop_license', label: 'Shop licence' },
    { key: 'cancelled_cheque', label: 'Cancelled cheque' },
    { key: 'id_proof', label: 'Owner ID proof' },
    { key: 'other', label: 'Other' }
];
export const documentLabel = (key) => DOCUMENT_TYPES.find((d) => d.key === key)?.label ?? key;

/** Shops the admin has approved for this seller. */
export const approvedShops = (seller) => (seller?.modules ?? []).filter((m) => m.status === 'approved');

/** What the API still needs before an application can be submitted (mirrors missingForSubmit in seller.service.js). */
export const missingForSubmit = (s) => {
    const missing = [];
    if (!s.address?.line1 || !s.address?.city || !s.address?.pincode) missing.push('Shop address');
    if (!s.modules?.length) missing.push('At least one shop to sell in');
    if (!s.legal?.pan) missing.push('PAN');
    if (!(s.bank?.accountNumber && s.bank?.ifsc) && !s.bank?.upiId) missing.push('Bank account or UPI ID');
    if (!s.documents?.length) missing.push('At least one document');
    return missing;
};
