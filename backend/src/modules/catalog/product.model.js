import mongoose from 'mongoose';
import { PRODUCT_MODULES } from './module.model.js';

/** Base units for pack sizes / sold quantities (scope §3, §4). */
export const UNITS = Object.freeze(['kg', 'g', 'l', 'ml', 'piece', 'pack', 'bunch', 'dozen', 'box']);
export const GST_RATES = Object.freeze([0, 5, 12, 18, 28]);

const paise = {
    type: Number,
    validate: { validator: (v) => v == null || Number.isInteger(v), message: '{PATH} must be a whole number' }
};

/**
 * One purchasable option of a product: a pack size (1 kg / 500 g), a model or
 * a colour/capacity combination. Price and stock live here, not on the
 * product, because they differ per option.
 */
const variantSchema = new mongoose.Schema(
    {
        sku: { type: String, trim: true, uppercase: true, maxlength: 40 },
        label: { type: String, required: true, trim: true, maxlength: 80 },
        /** Free-form option values, e.g. { colour: 'Black', capacity: '128 GB' }. */
        options: { type: Map, of: String, default: undefined },
        unit: { type: String, enum: UNITS, default: 'piece' },
        unitQty: { type: Number, min: 0, default: 1 },
        /** Selling price (MRP-style list price). */
        pricePaise: { ...paise, required: true, min: 0 },
        /** Promotional price; applies when set and below the selling price. */
        offerPricePaise: { ...paise, min: 0, default: null },
        stockQty: { ...paise, min: 0, default: 0 },
        lowStockThreshold: { type: Number, min: 0, default: 5 },
        maxPerOrder: { type: Number, min: 1, default: null },
        isActive: { type: Boolean, default: true }
    },
    { _id: true }
);

variantSchema.virtual('effectivePricePaise').get(function effectivePrice() {
    return this.offerPricePaise != null && this.offerPricePaise < this.pricePaise ? this.offerPricePaise : this.pricePaise;
});

const productSchema = new mongoose.Schema(
    {
        module: { type: String, enum: PRODUCT_MODULES, required: true },
        /** The marketplace seller who lists this product; null = sold by Nearmart itself. */
        seller: { type: mongoose.Schema.Types.ObjectId, ref: 'Seller', default: null, index: true },
        sellerName: { type: String, default: '' },
        /** Set while the seller is not approved, closed, or not approved for this module. */
        sellerHidden: { type: Boolean, default: false },
        category: { type: mongoose.Schema.Types.ObjectId, ref: 'Category', required: true },
        /** The category and all its ancestors, so filtering by a parent category finds this product. */
        categoryPath: { type: [mongoose.Schema.Types.ObjectId], default: [] },
        name: { type: String, required: true, trim: true, maxlength: 160 },
        slug: { type: String, required: true, unique: true },
        description: { type: String, trim: true, default: '', maxlength: 5000 },
        brand: { type: String, trim: true, default: '', maxlength: 80 },
        /** Electronics: manufacturer model number. */
        modelNumber: { type: String, trim: true, default: '', maxlength: 80 },
        images: { type: [String], default: [], validate: [(v) => v.length <= 10, 'At most 10 images'] },
        specifications: {
            type: [{ _id: false, key: { type: String, trim: true, required: true }, value: { type: String, trim: true, required: true } }],
            default: []
        },
        warranty: { type: String, trim: true, default: '', maxlength: 1000 },
        returnPolicy: { type: String, trim: true, default: '', maxlength: 1000 },
        /** Produce: seasonal availability / handling notes (scope §4, optional). */
        availabilityNote: { type: String, trim: true, default: '', maxlength: 300 },
        handlingNote: { type: String, trim: true, default: '', maxlength: 300 },
        tags: { type: [String], default: [] },
        /** GST %, included in the prices (Indian retail convention); shown as a breakdown on orders. */
        gstRate: { type: Number, enum: GST_RATES, default: 0 },
        isActive: { type: Boolean, default: true },
        isFeatured: { type: Boolean, default: false },
        variants: {
            type: [variantSchema],
            validate: [(v) => v.length >= 1 && v.length <= 50, 'A product needs 1 to 50 variants']
        },

        // Derived from active variants; kept current by refreshDerived().
        minPricePaise: { type: Number, default: 0 },
        totalStock: { type: Number, default: 0 },
        inStock: { type: Boolean, default: false }
    },
    {
        collection: 'products',
        timestamps: true,
        // Stock updates bump __v, so an editor saving a stale copy gets a VersionError instead of overwriting stock.
        optimisticConcurrency: true,
        toJSON: { virtuals: true },
        toObject: { virtuals: true }
    }
);

productSchema.index({ module: 1, isActive: 1, categoryPath: 1 });
productSchema.index({ module: 1, minPricePaise: 1 });
productSchema.index({ 'variants.sku': 1 }, { unique: true, partialFilterExpression: { 'variants.sku': { $type: 'string' } } });

productSchema.pre('validate', function checkVariants() {
    const skus = new Set();
    for (const v of this.variants || []) {
        if (v.sku === '') v.sku = undefined;
        if (v.sku) {
            if (skus.has(v.sku)) this.invalidate('variants', `Duplicate SKU ${v.sku}`);
            skus.add(v.sku);
        }
        if (v.offerPricePaise != null && v.offerPricePaise >= v.pricePaise) {
            this.invalidate('variants', `Offer price for "${v.label}" must be below its selling price`);
        }
    }
});

productSchema.pre('save', function setDerived() {
    const active = this.variants.filter((v) => v.isActive);
    this.minPricePaise = active.length ? Math.min(...active.map((v) => v.effectivePricePaise)) : 0;
    this.totalStock = active.reduce((sum, v) => sum + v.stockQty, 0);
    this.inStock = this.totalStock > 0;
});

export const Product = mongoose.model('Product', productSchema);

/**
 * Recomputes the derived fields in the database itself, for updates that
 * bypass save() (stock $inc). One atomic pipeline update.
 */
export const refreshDerived = (productId) => {
    const active = { $filter: { input: '$variants', as: 'v', cond: '$$v.isActive' } };
    const effective = {
        $map: {
            input: active,
            as: 'v',
            in: {
                $cond: [
                    { $and: [{ $ne: [{ $ifNull: ['$$v.offerPricePaise', null] }, null] }, { $lt: ['$$v.offerPricePaise', '$$v.pricePaise'] }] },
                    '$$v.offerPricePaise',
                    '$$v.pricePaise'
                ]
            }
        }
    };
    return Product.updateOne({ _id: productId }, [
        {
            $set: {
                totalStock: { $sum: { $map: { input: active, as: 'v', in: '$$v.stockQty' } } },
                minPricePaise: { $ifNull: [{ $min: effective }, 0] }
            }
        },
        { $set: { inStock: { $gt: ['$totalStock', 0] } } }
    ]);
};
