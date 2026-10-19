import mongoose from 'mongoose';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../../lib/errors.js';
import { escapeRegex } from '../../lib/pagination.js';
import { uniqueSlug } from '../../lib/slug.js';
import { Category } from './category.model.js';
import { PRODUCT_MODULES } from './module.model.js';
import { Product } from './product.model.js';
import { StockMovement } from './stockMovement.model.js';

const toId = (v) => new mongoose.Types.ObjectId(String(v));

const resolveCategory = async (categoryId, module) => {
    if (!PRODUCT_MODULES.includes(module)) throw new ValidationError(`Products cannot be added to the ${module} module`);
    const category = await Category.findById(categoryId).select('module ancestors').lean();
    if (!category) throw new ValidationError('Category not found');
    if (category.module !== module) throw new ValidationError('Category belongs to another module');
    return { category: category._id, categoryPath: [...category.ancestors, category._id] };
};

/** Throws unless `module` is one the caller may manage (null = all modules). */
export const assertModule = (allowedModules, module) => {
    if (allowedModules && !allowedModules.includes(module)) throw new ForbiddenError(`No access to the ${module} module`);
};

/** Records opening stock for the given (newly created) variants. */
const logInitialStock = (product, actor) => {
    const rows = product.variants
        .filter((v) => v.stockQty > 0)
        .map((v) => ({
            product: product._id,
            variant: v._id,
            module: product.module,
            sku: v.sku || '',
            label: v.label,
            delta: v.stockQty,
            after: v.stockQty,
            reason: 'initial',
            actor
        }));
    return rows.length ? StockMovement.insertMany(rows) : null;
};

export const createProduct = async (input, { actor, allowedModules }) => {
    assertModule(allowedModules, input.module);
    const placement = await resolveCategory(input.category, input.module);
    const product = new Product({
        ...input,
        ...placement,
        slug: await uniqueSlug(Product, input.name)
    });
    await product.save();
    await logInitialStock(product, actor);
    return product;
};

export const getProduct = async (id, { allowedModules } = {}) => {
    const product = await Product.findById(id);
    if (!product) throw new NotFoundError('Product not found');
    assertModule(allowedModules, product.module);
    return product;
};

/**
 * Applies an edit from the product form. Stock is never taken from the form
 * for variants that already exist (it changes only through the stock
 * endpoints); new variants may carry an opening stock.
 *
 * If stock moves while this runs, the save hits a version conflict and the
 * edit is re-applied to a fresh copy, so an edit can't undo a sale.
 */
export const updateProduct = async (id, input, { actor, allowedModules }) => {
    for (let attempt = 0; attempt < 3; attempt += 1) {
        const product = await getProduct(id, { allowedModules });
        const { variants, category, module, ...fields } = input;

        if (module && module !== product.module) throw new ValidationError('A product cannot change module');
        if (category && String(category) !== String(product.category)) {
            Object.assign(product, await resolveCategory(category, product.module));
        }
        if (fields.name && fields.name !== product.name) {
            product.slug = await uniqueSlug(Product, fields.name, {}, product._id);
        }
        Object.assign(product, fields);

        let added = [];
        if (variants) {
            const existing = new Map(product.variants.map((v) => [String(v._id), v]));
            const next = variants.map((v) => {
                const current = v._id ? existing.get(String(v._id)) : null;
                if (v._id && !current) throw new ValidationError(`Variant ${v._id} does not belong to this product`);
                return current ? { ...v, stockQty: current.stockQty } : { ...v, _id: new mongoose.Types.ObjectId() };
            });
            added = next.filter((v) => !existing.has(String(v._id))).map((v) => String(v._id));
            product.variants = next;
        }

        try {
            await product.save();
        } catch (err) {
            if (err instanceof mongoose.Error.VersionError && attempt < 2) continue;
            if (err instanceof mongoose.Error.VersionError) throw new ConflictError('Product changed while saving; try again');
            throw err;
        }

        if (added.length) {
            const fresh = { ...product.toObject(), variants: product.variants.filter((v) => added.includes(String(v._id))) };
            await logInitialStock(fresh, actor);
        }
        return product;
    }
    throw new ConflictError('Product changed while saving; try again');
};

export const deleteProduct = async (id, { allowedModules }) => {
    const product = await getProduct(id, { allowedModules });
    // Phase 3: refuse when the product appears on orders, and suggest deactivating instead.
    await product.deleteOne();
};

const lowStockExpr = {
    $gt: [
        {
            $size: {
                $filter: {
                    input: '$variants',
                    cond: { $and: ['$$this.isActive', { $lte: ['$$this.stockQty', '$$this.lowStockThreshold'] }] }
                }
            }
        },
        0
    ]
};

/** Admin product list: search by name/brand/SKU, filter by module, category, status and stock. */
export const listProducts = async ({ q, module, category, status, stock, page, limit, sort }, { allowedModules }) => {
    const filter = {};
    if (module) {
        assertModule(allowedModules, module);
        filter.module = module;
    } else if (allowedModules) {
        filter.module = { $in: allowedModules };
    }
    if (category) filter.categoryPath = toId(category);
    if (status) filter.isActive = status === 'active';
    if (stock === 'out') filter.inStock = false;
    if (stock === 'in') filter.inStock = true;
    if (stock === 'low') filter.$expr = lowStockExpr;
    if (q) {
        const rx = new RegExp(escapeRegex(q.trim()), 'i');
        filter.$or = [{ name: rx }, { brand: rx }, { 'variants.sku': rx }];
    }

    const sorts = {
        newest: { createdAt: -1 },
        name: { name: 1 },
        price_asc: { minPricePaise: 1 },
        price_desc: { minPricePaise: -1 },
        stock_asc: { totalStock: 1 }
    };
    const [items, total] = await Promise.all([
        Product.find(filter)
            .select('module category name slug brand images isActive isFeatured minPricePaise totalStock inStock variants createdAt')
            .populate('category', 'name')
            .sort(sorts[sort] || sorts.newest)
            .skip((page - 1) * limit)
            .limit(limit)
            .lean({ virtuals: false }),
        Product.countDocuments(filter)
    ]);
    return { items, page, limit, total, pages: Math.ceil(total / limit) };
};

/**
 * One row per variant for the inventory screen, lowest stock first, so what
 * needs restocking is on top.
 */
export const listInventory = async ({ q, module, category, stock, page, limit }, { allowedModules }) => {
    const match = {};
    if (module) {
        assertModule(allowedModules, module);
        match.module = module;
    } else if (allowedModules) {
        match.module = { $in: allowedModules };
    }
    if (category) match.categoryPath = toId(category);

    const variantMatch = { 'variant.isActive': true };
    if (stock === 'out') variantMatch['variant.stockQty'] = 0;
    if (stock === 'in') variantMatch['variant.stockQty'] = { $gt: 0 };
    if (stock === 'low') variantMatch.$expr = { $lte: ['$variant.stockQty', '$variant.lowStockThreshold'] };
    if (q) {
        const rx = new RegExp(escapeRegex(q.trim()), 'i');
        variantMatch.$or = [{ name: rx }, { brand: rx }, { 'variant.sku': rx }, { 'variant.label': rx }];
    }

    const [result] = await Product.aggregate([
        { $match: match },
        { $project: { name: 1, brand: 1, module: 1, image: { $first: '$images' }, isActive: 1, variant: '$variants' } },
        { $unwind: '$variant' },
        { $match: variantMatch },
        {
            $facet: {
                items: [
                    { $sort: { 'variant.stockQty': 1, name: 1 } },
                    { $skip: (page - 1) * limit },
                    { $limit: limit },
                    {
                        $project: {
                            _id: 0,
                            productId: '$_id',
                            productName: '$name',
                            brand: 1,
                            module: 1,
                            image: 1,
                            productActive: '$isActive',
                            variantId: '$variant._id',
                            sku: '$variant.sku',
                            label: '$variant.label',
                            stockQty: '$variant.stockQty',
                            lowStockThreshold: '$variant.lowStockThreshold'
                        }
                    }
                ],
                total: [{ $count: 'n' }]
            }
        }
    ]);
    const total = result.total[0]?.n ?? 0;
    return { items: result.items, page, limit, total, pages: Math.ceil(total / limit) };
};

/** Updates just the low-stock threshold of a variant (inventory screen). */
export const setLowStockThreshold = async ({ productId, variantId, threshold }, { allowedModules }) => {
    const product = await getProduct(productId, { allowedModules });
    const res = await Product.updateOne(
        { _id: product._id, 'variants._id': variantId },
        { $set: { 'variants.$.lowStockThreshold': threshold } }
    );
    if (res.matchedCount === 0) throw new NotFoundError('Variant not found');
};
