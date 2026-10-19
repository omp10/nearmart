import mongoose from 'mongoose';
import { NotFoundError } from '../../lib/errors.js';
import { escapeRegex } from '../../lib/pagination.js';
import { Category } from './category.model.js';
import { inactiveModuleKeys } from './module.service.js';
import { Product } from './product.model.js';

/**
 * What the customer app sees. Stock counts stay internal: the app gets
 * in/out of stock and the most it may add to the cart.
 */

const effectivePrice = (v) => (v.offerPricePaise != null && v.offerPricePaise < v.pricePaise ? v.offerPricePaise : v.pricePaise);

const publicVariant = (v) => ({
    id: String(v._id),
    sku: v.sku || null,
    label: v.label,
    options: v.options || {},
    unit: v.unit,
    unitQty: v.unitQty,
    pricePaise: v.pricePaise,
    offerPricePaise: v.offerPricePaise != null && v.offerPricePaise < v.pricePaise ? v.offerPricePaise : null,
    effectivePricePaise: effectivePrice(v),
    inStock: v.stockQty > 0,
    maxQty: Math.min(v.stockQty, v.maxPerOrder || Infinity, 99)
});

const publicProduct = (p, { detail = false } = {}) => {
    const variants = p.variants.filter((v) => v.isActive).map(publicVariant);
    const base = {
        id: String(p._id),
        slug: p.slug,
        module: p.module,
        category: p.category,
        name: p.name,
        brand: p.brand,
        image: p.images[0] || null,
        minPricePaise: p.minPricePaise,
        inStock: p.inStock,
        isFeatured: p.isFeatured,
        variants
    };
    if (!detail) return base;
    return {
        ...base,
        images: p.images,
        description: p.description,
        modelNumber: p.modelNumber,
        specifications: p.specifications,
        warranty: p.warranty,
        returnPolicy: p.returnPolicy,
        availabilityNote: p.availabilityNote,
        handlingNote: p.handlingNote,
        tags: p.tags,
        categoryPath: p.categoryPath
    };
};

/** Ids of inactive categories: any product whose path contains one is hidden. */
const hiddenCategoryIds = async () => (await Category.find({ isActive: false }).select('_id').lean()).map((c) => c._id);

const visibilityFilter = async () => {
    const [inactiveModules, hiddenCategories] = await Promise.all([inactiveModuleKeys(), hiddenCategoryIds()]);
    return {
        isActive: true,
        ...(inactiveModules.length ? { module: { $nin: inactiveModules } } : {}),
        ...(hiddenCategories.length ? { categoryPath: { $nin: hiddenCategories } } : {})
    };
};

export const listPublicProducts = async ({ module, category, q, brand, minPrice, maxPrice, inStock, featured, sort, page, limit }) => {
    const filter = await visibilityFilter();
    const and = [];
    if (module) and.push({ module });
    if (category) and.push({ categoryPath: new mongoose.Types.ObjectId(category) });
    if (brand) and.push({ brand: new RegExp(`^${escapeRegex(brand)}$`, 'i') });
    if (minPrice != null || maxPrice != null) {
        and.push({ minPricePaise: { ...(minPrice != null ? { $gte: minPrice } : {}), ...(maxPrice != null ? { $lte: maxPrice } : {}) } });
    }
    if (inStock != null) and.push({ inStock });
    if (featured != null) and.push({ isFeatured: featured });
    if (q) {
        // Word-prefix match, so "tom" finds "Tomato" and "Cherry Tomatoes".
        const rx = new RegExp(`(^|\\s)${escapeRegex(q)}`, 'i');
        and.push({ $or: [{ name: rx }, { brand: rx }, { tags: rx }] });
    }
    if (and.length) filter.$and = and;

    const sorts = {
        // In stock first, then featured, then newest.
        relevance: { inStock: -1, isFeatured: -1, createdAt: -1 },
        price_asc: { minPricePaise: 1 },
        price_desc: { minPricePaise: -1 },
        newest: { createdAt: -1 },
        name: { name: 1 }
    };
    const [rows, total] = await Promise.all([
        Product.find(filter).sort({ ...sorts[sort], _id: 1 }).skip((page - 1) * limit).limit(limit).lean(),
        Product.countDocuments(filter)
    ]);
    return { items: rows.map((p) => publicProduct(p)), page, limit, total, pages: Math.ceil(total / limit) };
};

export const getPublicProduct = async (idOrSlug) => {
    const filter = await visibilityFilter();
    const key = mongoose.isValidObjectId(idOrSlug) ? { _id: idOrSlug } : { slug: String(idOrSlug) };
    const product = await Product.findOne({ ...filter, ...key }).lean();
    if (!product) throw new NotFoundError('Product not found');
    return publicProduct(product, { detail: true });
};

/** Brands available in a module, for the filter sheet. */
export const listBrands = async (module) => {
    const filter = await visibilityFilter();
    const brands = await Product.distinct('brand', { ...filter, ...(module ? { module } : {}), brand: { $ne: '' } });
    return brands.sort((a, b) => a.localeCompare(b));
};
