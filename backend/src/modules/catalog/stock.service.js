import mongoose from 'mongoose';
import { NotFoundError, ValidationError } from '../../lib/errors.js';
import { Product, refreshDerived } from './product.model.js';
import { StockMovement } from './stockMovement.model.js';

const toId = (v) => new mongoose.Types.ObjectId(String(v));

/**
 * Changes one variant's stock by `delta` atomically. A decrease only applies
 * if enough stock is there at that instant, so concurrent orders or edits can
 * never drive stock below zero.
 *
 * Bumps the product's __v so an editor holding a stale copy of the product
 * can't overwrite the new stock when it saves (see product.service).
 *
 * @returns {Promise<{ stockQty: number }>}
 */
export const adjustStock = async ({ productId, variantId, delta, reason, note = '', refId = null, actor }) => {
    if (!Number.isInteger(delta) || delta === 0) throw new ValidationError('Quantity change must be a non-zero whole number');

    const match = { _id: toId(variantId), ...(delta < 0 ? { stockQty: { $gte: -delta } } : {}) };
    const product = await Product.findOneAndUpdate(
        { _id: toId(productId), variants: { $elemMatch: match } },
        { $inc: { 'variants.$.stockQty': delta, __v: 1 } },
        { new: true, projection: { module: 1, variants: 1 } }
    ).lean();

    if (!product) {
        const exists = await Product.exists({ _id: productId, 'variants._id': variantId });
        if (!exists) throw new NotFoundError('Product variant not found');
        throw new ValidationError('Not enough stock for that change');
    }

    const variant = product.variants.find((v) => String(v._id) === String(variantId));
    await Promise.all([
        refreshDerived(product._id),
        StockMovement.create({
            product: product._id,
            variant: variant._id,
            module: product.module,
            sku: variant.sku || '',
            label: variant.label,
            delta,
            after: variant.stockQty,
            reason,
            note,
            refId,
            actor
        })
    ]);
    return { stockQty: variant.stockQty };
};

/**
 * Sets a variant's stock to an exact count (a stock-take). Implemented as a
 * delta against the value just read, retried if stock moved in between.
 */
export const setStock = async ({ productId, variantId, quantity, reason = 'adjustment', note, actor }) => {
    if (!Number.isInteger(quantity) || quantity < 0) throw new ValidationError('Stock must be a whole number, 0 or more');

    for (let attempt = 0; attempt < 3; attempt += 1) {
        const product = await Product.findOne({ _id: productId, 'variants._id': variantId }, { 'variants.$': 1 }).lean();
        if (!product) throw new NotFoundError('Product variant not found');
        const current = product.variants[0].stockQty;
        if (current === quantity) return { stockQty: current };

        try {
            return await adjustStock({ productId, variantId, delta: quantity - current, reason, note, actor });
        } catch (err) {
            // Stock dropped between the read and the write; read again.
            if (!(err instanceof ValidationError) || attempt === 2) throw err;
        }
    }
    throw new ValidationError('Stock is changing too quickly; try again');
};

export const listMovements = ({ productId, variantId, modules, page, limit }) => {
    const filter = {
        ...(productId ? { product: productId } : {}),
        ...(variantId ? { variant: variantId } : {}),
        ...(modules ? { module: { $in: modules } } : {})
    };
    return Promise.all([
        StockMovement.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
        StockMovement.countDocuments(filter)
    ]).then(([items, total]) => ({ items, page, limit, total, pages: Math.ceil(total / limit) }));
};
