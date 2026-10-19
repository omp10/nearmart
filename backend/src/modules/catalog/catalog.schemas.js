import { z } from 'zod';
import { pageQuery } from '../../lib/pagination.js';
import { BUSINESS_MODULES } from '../staff/permissions.js';
import { PRODUCT_MODULES } from './module.model.js';
import { UNITS } from './product.model.js';
import { STOCK_REASONS } from './stockMovement.model.js';

export const objectId = z.string().regex(/^[a-f0-9]{24}$/i, 'Invalid id');
const paise = z.number().int('Amounts are whole paise').min(0);
const imageUrl = z.string().trim().max(500);

export const moduleKey = z.enum(BUSINESS_MODULES);

export const moduleUpdateSchema = z
    .object({
        name: z.string().trim().min(1).max(60),
        description: z.string().trim().max(300),
        image: imageUrl,
        isActive: z.boolean(),
        sortOrder: z.number().int()
    })
    .partial();

const categoryFields = {
    name: z.string().trim().min(1).max(80),
    description: z.string().trim().max(500).optional(),
    image: imageUrl.optional(),
    sortOrder: z.number().int().optional(),
    isActive: z.boolean().optional()
};

export const categoryCreateSchema = z.object({
    module: moduleKey,
    parent: objectId.nullable().optional(),
    ...categoryFields
});

export const categoryUpdateSchema = z
    .object({ parent: objectId.nullable(), ...categoryFields, name: categoryFields.name.optional() })
    .partial();

const variantSchema = z.object({
    _id: objectId.optional(),
    sku: z.string().trim().max(40).optional(),
    label: z.string().trim().min(1, 'Each variant needs a label, e.g. "1 kg"').max(80),
    options: z.record(z.string().trim().max(60)).optional(),
    unit: z.enum(UNITS).default('piece'),
    unitQty: z.number().min(0).default(1),
    pricePaise: paise,
    offerPricePaise: paise.nullable().optional(),
    stockQty: z.number().int().min(0).default(0),
    lowStockThreshold: z.number().int().min(0).default(5),
    maxPerOrder: z.number().int().min(1).nullable().optional(),
    isActive: z.boolean().default(true)
});

const productFields = {
    category: objectId,
    name: z.string().trim().min(1).max(160),
    description: z.string().trim().max(5000).optional(),
    brand: z.string().trim().max(80).optional(),
    modelNumber: z.string().trim().max(80).optional(),
    images: z.array(imageUrl).max(10).optional(),
    specifications: z.array(z.object({ key: z.string().trim().min(1).max(60), value: z.string().trim().min(1).max(300) })).max(50).optional(),
    warranty: z.string().trim().max(1000).optional(),
    returnPolicy: z.string().trim().max(1000).optional(),
    availabilityNote: z.string().trim().max(300).optional(),
    handlingNote: z.string().trim().max(300).optional(),
    tags: z.array(z.string().trim().toLowerCase().min(1).max(40)).max(20).optional(),
    isActive: z.boolean().optional(),
    isFeatured: z.boolean().optional(),
    variants: z.array(variantSchema).min(1, 'Add at least one variant').max(50)
};

export const productCreateSchema = z.object({ module: z.enum(PRODUCT_MODULES), ...productFields });
export const productUpdateSchema = z.object(productFields).partial();

export const productListQuery = z.object({
    ...pageQuery,
    q: z.string().trim().max(100).optional(),
    module: moduleKey.optional(),
    category: objectId.optional(),
    status: z.enum(['active', 'inactive']).optional(),
    stock: z.enum(['in', 'out', 'low']).optional(),
    sort: z.enum(['newest', 'name', 'price_asc', 'price_desc', 'stock_asc']).optional()
});

export const inventoryListQuery = productListQuery.omit({ status: true, sort: true });

export const stockAdjustSchema = z.object({
    delta: z.number().int().refine((n) => n !== 0, 'Enter a quantity other than 0'),
    reason: z.enum(STOCK_REASONS.filter((r) => ['restock', 'adjustment'].includes(r))),
    note: z.string().trim().max(300).optional()
});

export const stockSetSchema = z.object({
    quantity: z.number().int().min(0),
    note: z.string().trim().max(300).optional()
});

export const thresholdSchema = z.object({ threshold: z.number().int().min(0).max(100000) });

export const movementQuery = z.object({
    ...pageQuery,
    productId: objectId.optional(),
    variantId: objectId.optional()
});

export const publicProductQuery = z.object({
    ...pageQuery,
    module: z.enum(PRODUCT_MODULES).optional(),
    category: objectId.optional(),
    q: z.string().trim().max(100).optional(),
    brand: z.string().trim().max(80).optional(),
    minPrice: z.coerce.number().int().min(0).optional(),
    maxPrice: z.coerce.number().int().min(0).optional(),
    inStock: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
    featured: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
    sort: z.enum(['relevance', 'price_asc', 'price_desc', 'newest', 'name']).default('relevance')
});
