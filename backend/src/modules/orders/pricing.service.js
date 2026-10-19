import { includedTax } from '../../lib/money.js';
import { discountFor } from '../coupons/coupon.service.js';

/**
 * The one place an order total is worked out. Prices are GST-inclusive, so
 * tax is reported but not added.
 *
 * @param {Array<{ unitPricePaise: number, mrpPaise: number, qty: number, gstRate: number, status?: string }>} lines
 * @param {{ zone?: object, coupon?: object|null, fixedDeliveryFeePaise?: number, fixedDiscountPaise?: number }} opts
 *   The fixed values are for re-pricing an existing order after items drop out:
 *   it keeps its checkout delivery fee and a discount no larger than before.
 */
export const priceLines = (lines, { zone, coupon = null, fixedDeliveryFeePaise, fixedDiscountPaise }) => {
    const live = lines.filter((l) => l.status !== 'unavailable');
    const subtotalPaise = live.reduce((sum, l) => sum + l.unitPricePaise * l.qty, 0);
    const mrpTotal = live.reduce((sum, l) => sum + l.mrpPaise * l.qty, 0);
    const discountPaise = Math.min(subtotalPaise, fixedDiscountPaise ?? (coupon ? discountFor(coupon, subtotalPaise) : 0));
    const afterDiscount = subtotalPaise - discountPaise;

    const freeAbove = zone?.freeDeliveryAbovePaise;
    const deliveryFeePaise =
        fixedDeliveryFeePaise ?? (freeAbove != null && afterDiscount >= freeAbove ? 0 : zone?.deliveryFeePaise ?? 0);

    // Spread the discount over lines by value so each line's tax reflects what was actually charged.
    const taxPaise = live.reduce((sum, l) => {
        const lineTotal = l.unitPricePaise * l.qty;
        const share = subtotalPaise ? Math.round((discountPaise * lineTotal) / subtotalPaise) : 0;
        return sum + includedTax(lineTotal - share, l.gstRate);
    }, 0);

    return {
        subtotalPaise,
        discountPaise,
        deliveryFeePaise,
        taxPaise,
        totalPaise: afterDiscount + deliveryFeePaise,
        savingsPaise: mrpTotal - subtotalPaise + discountPaise
    };
};
