/** Public files live under the app's base path (/seller/). */
export const asset = (path) => `${import.meta.env.BASE_URL}${path}`;

export function BrandMark({ subtitle = 'Seller' }) {
    return (
        <div className="flex items-center gap-3">
            <img src={asset('brand/mark.png')} alt="" className="h-10 w-10 shrink-0 object-contain" />
            <div className="min-w-0">
                <div className="truncate text-[17px] font-extrabold tracking-tight">
                    <span className="text-[#292e3c]">Near</span>
                    <span className="text-mart">mart</span>
                </div>
                <div className="flex items-center gap-1.5 text-[10px] font-semibold tracking-[0.14em] text-neutral-500 uppercase">
                    <span className="h-1.5 w-1.5 rounded-full bg-brand-700" aria-hidden="true" />
                    {subtitle}
                </div>
            </div>
        </div>
    );
}

/** The logo's four shop colours as a short segmented bar. */
export function ShopStripe() {
    return (
        <div className="flex gap-1" aria-hidden="true">
            <span className="h-1 w-6 rounded-full bg-shop-grocery" />
            <span className="h-1 w-6 rounded-full bg-shop-produce" />
            <span className="h-1 w-6 rounded-full bg-shop-laundry" />
            <span className="h-1 w-6 rounded-full bg-shop-electronics" />
        </div>
    );
}
