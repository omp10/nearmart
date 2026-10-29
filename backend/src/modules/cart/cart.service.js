import mongoose from 'mongoose';
import { ConflictError, NotFoundError, ValidationError } from '../../lib/errors.js';
import { Category } from '../catalog/category.model.js';
import { inactiveModuleKeys } from '../catalog/module.service.js';
import { Product } from '../catalog/product.model.js';
import { Cart } from './cart.model.js';

export const MAX_CART_LINES = 100;

export const effectivePrice = (v) =>
    v.offerPricePaise != null && v.offerPricePaise < v.pricePaise ? v.offerPricePaise : v.pricePaise;

/** Most a customer may buy of a variant right now. */
export const maxQtyFor = (variant) => Math.min(variant.stockQty, variant.maxPerOrder || Infinity, 99);

/**
 * Turns stored cart items into priced lines, checking each against the live
 * catalogue. A line that can't be bought gets an `issue` instead of being
 * silently dropped, so the app can tell the customer why.
 */
export const resolveLines = async (items) => {
    if (!items.length) return [];
    const ids = [...new Set(items.map((i) => String(i.product)))];
    const [products, inactiveModules, hiddenCategories] = await Promise.all([
        Product.find({ _id: { $in: ids } }).lean(),
        inactiveModuleKeys(),
        Category.find({ isActive: false }).distinct('_id')
    ]);
    const byId = new Map(products.map((p) => [String(p._id), p]));
    const hidden = new Set(hiddenCategories.map(String));

    return items.map((item) => {
        const product = byId.get(String(item.product));
        const variant = product?.variants.find((v) => String(v._id) === String(item.variant));
        const base = { productId: String(item.product), variantId: String(item.variant), qty: item.qty };

        const unavailable =
            !product || !variant || !product.isActive || !variant.isActive || product.sellerHidden || ['pending', 'rejected'].includes(product.review?.status) ||
            inactiveModules.includes(product.module) || product.categoryPath.some((c) => hidden.has(String(c)));
        if (unavailable) return { ...base, module: product?.module ?? null, name: product?.name ?? 'Unavailable item', issue: 'unavailable' };

        const maxQty = maxQtyFor(variant);
        const unitPricePaise = effectivePrice(variant);
        return {
            ...base,
            module: product.module,
            sellerId: product.seller ? String(product.seller) : null,
            sellerName: product.seller ? product.sellerName : 'Nearmart',
            name: product.name,
            brand: product.brand,
            image: product.images[0] || null,
            variantLabel: variant.label,
            sku: variant.sku || '',
            unit: variant.unit,
            unitQty: variant.unitQty,
            mrpPaise: variant.pricePaise,
            unitPricePaise,
            gstRate: product.gstRate ?? 0,
            lineTotalPaise: unitPricePaise * item.qty,
            maxQty,
            issue: maxQty === 0 ? 'out_of_stock' : item.qty > maxQty ? 'quantity_reduced' : null
        };
    });
};

/** The cart grouped by module, each group with its own subtotal; checkout happens per group. */
export const getCart = async (userId) => {
    const cart = await Cart.findOne({ user: userId }).lean();
    const lines = await resolveLines(cart?.items ?? []);
    const groups = {};
    for (const line of lines) {
        const key = line.module ?? 'unavailable';
        groups[key] ??= { module: key, lines: [], subtotalPaise: 0, itemCount: 0, hasIssues: false, sellers: [] };
        const group = groups[key];
        group.lines.push(line);
        if (!line.issue) {
            group.subtotalPaise += line.lineTotalPaise;
            group.itemCount += line.qty;
            // Items from different marketplace sellers are checked out as separate orders.
            let seller = group.sellers.find((s) => s.sellerId === line.sellerId);
            if (!seller) group.sellers.push((seller = { sellerId: line.sellerId, name: line.sellerName, subtotalPaise: 0, itemCount: 0 }));
            seller.subtotalPaise += line.lineTotalPaise;
            seller.itemCount += line.qty;
        } else {
            group.hasIssues = true;
        }
    }
    return { groups: Object.values(groups), itemCount: lines.reduce((n, l) => n + l.qty, 0) };
};

/**
 * Sets a line's quantity (0 removes it). Refuses quantities above what can be
 * bought now, with the limit in the message.
 */
export const setItem = async (userId, { productId, variantId, qty }) => {
    if (qty > 0) {
        const product = await Product.findOne({ _id: productId, 'variants._id': variantId }).lean();
        const variant = product?.variants.find((v) => String(v._id) === String(variantId));
        const [line] = await resolveLines([{ product: productId, variant: variantId, qty }]);
        if (!variant || line.issue === 'unavailable') throw new NotFoundError('This item is not available');
        if (line.maxQty === 0) throw new ValidationError(`${product.name} (${variant.label}) is out of stock`);
        if (qty > line.maxQty) throw new ValidationError(`You can add at most ${line.maxQty} of ${product.name} (${variant.label})`);
    }

    // Single atomic updates rather than read-modify-save, so quick repeated
    // taps (parallel requests) can't lose an item or collide creating the cart.
    const line = { product: new mongoose.Types.ObjectId(String(productId)), variant: new mongoose.Types.ObjectId(String(variantId)) };
    if (qty === 0) {
        await Cart.updateOne({ user: userId }, { $pull: { items: line } });
        return getCart(userId);
    }

    for (let attempt = 0; attempt < 3; attempt += 1) {
        const updated = await Cart.updateOne({ user: userId, items: { $elemMatch: line } }, { $set: { 'items.$.qty': qty } });
        if (updated.matchedCount) return getCart(userId);
        try {
            // Adds the line only if it isn't there yet and the cart has room; creates the cart if needed.
            await Cart.updateOne(
                { user: userId, items: { $not: { $elemMatch: line } }, [`items.${MAX_CART_LINES - 1}`]: { $exists: false } },
                { $push: { items: { ...line, qty } } },
                { upsert: true }
            );
            return getCart(userId);
        } catch (err) {
            if (err?.code !== 11000) throw err;
            // The cart exists but didn't match: the line appeared meanwhile (loop and set it) or the cart is full.
            if (await Cart.exists({ user: userId, [`items.${MAX_CART_LINES - 1}`]: { $exists: true } })) {
                throw new ValidationError('Your cart is full');
            }
        }
    }
    throw new ConflictError('Your cart is being updated elsewhere; please try again');
};

export const clearCart = (userId, module = null) => {
    if (!module) return Cart.updateOne({ user: userId }, { $set: { items: [] } });
    return Product.find({ module }).distinct('_id').then((ids) =>
        Cart.updateOne({ user: userId }, { $pull: { items: { product: { $in: ids } } } })
    );
};

/** Removes specific lines (the ones just ordered), leaving anything added meanwhile. */
export const removeLines = (userId, lines) =>
    Cart.updateOne(
        { user: userId },
        {
            $pull: {
                items: {
                    $or: lines.map((l) => ({
                        product: new mongoose.Types.ObjectId(String(l.productId)),
                        variant: new mongoose.Types.ObjectId(String(l.variantId))
                    }))
                }
            }
        }
    );

/** Cart items of one module, as stored. */
export const cartItemsForModule = async (userId, module) => {
    const cart = await Cart.findOne({ user: userId }).lean();
    const lines = await resolveLines(cart?.items ?? []);
    return lines.filter((l) => l.module === module);
};
