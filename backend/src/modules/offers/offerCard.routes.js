import { Router } from 'express';
import { z } from 'zod';
import { NotFoundError } from '../../lib/errors.js';
import { created, ok } from '../../lib/response.js';
import { validate } from '../../lib/validate.js';
import { authenticate, requireAdmin, requirePermission } from '../../middleware/auth.js';
import { BUSINESS_MODULES } from '../staff/permissions.js';
import { OFFER_CARD_LINK_TYPES, OfferCard } from './offerCard.model.js';

const fields = {
    module: z.enum(BUSINESS_MODULES),
    title: z.string().trim().min(1).max(100),
    label: z.string().trim().max(50).default('UP TO'),
    discountText: z.string().trim().min(1).max(50),
    image: z.string().trim().min(1, 'Upload an image').max(500),
    backgroundColor: z.string().trim().max(30).default('#F3F4F6'),
    link: z.object({
        type: z.enum(OFFER_CARD_LINK_TYPES).default('none'),
        value: z.string().trim().max(500).default('')
    }).default({ type: 'none', value: '' }),
    sortOrder: z.number().int().default(0),
    isActive: z.boolean().default(true),
    startsAt: z.coerce.date().nullable().optional(),
    endsAt: z.coerce.date().nullable().optional()
};

/**
 * Public: Offer cards active now for a module, in sortOrder then newest.
 * GET /api/v1/offer-cards?module=grocery
 */
export const publicOfferCardRoutes = Router();
publicOfferCardRoutes.get(
    '/',
    validate(z.object({ module: z.enum(BUSINESS_MODULES).default('grocery') }), 'query'),
    async (req, res) => {
        const now = new Date();
        const rows = await OfferCard.find({
            module: req.validatedQuery.module,
            isActive: true,
            $and: [
                { $or: [{ startsAt: null }, { startsAt: { $lte: now } }] },
                { $or: [{ endsAt: null }, { endsAt: { $gt: now } }] }
            ]
        })
            .sort({ sortOrder: 1, createdAt: -1 })
            .lean();

        ok(
            res,
            rows.map(({ _id, module, title, label, discountText, image, backgroundColor, link, sortOrder }) => ({
                id: String(_id),
                module,
                title,
                label: label || 'UP TO',
                discountText,
                image,
                backgroundColor: backgroundColor || '#F3F4F6',
                link: link || { type: 'none', value: '' },
                sortOrder
            }))
        );
    }
);

/**
 * Admin: manage offer cards.
 * /api/v1/admin/offer-cards
 */
export const adminOfferCardRoutes = Router();
adminOfferCardRoutes.use(authenticate, requireAdmin);

adminOfferCardRoutes.get(
    '/',
    requirePermission('banners', 'view'),
    validate(z.object({ module: z.enum(BUSINESS_MODULES).optional() }), 'query'),
    async (req, res) => {
        const filter = req.validatedQuery.module ? { module: req.validatedQuery.module } : {};
        const rows = await OfferCard.find(filter)
            .sort({ module: 1, sortOrder: 1, createdAt: -1 })
            .lean();
        ok(res, rows);
    }
);

adminOfferCardRoutes.post(
    '/',
    requirePermission('banners', 'create'),
    validate(z.object(fields)),
    async (req, res) => {
        created(res, await OfferCard.create(req.body), 'Offer card created');
    }
);

adminOfferCardRoutes.put(
    '/reorder',
    requirePermission('banners', 'update'),
    validate(
        z.object({
            items: z.array(z.object({ id: z.string().regex(/^[a-f0-9]{24}$/i, 'Invalid id'), sortOrder: z.number().int() })).max(100)
        })
    ),
    async (req, res) => {
        const ops = req.body.items.map(({ id, sortOrder }) => ({
            updateOne: {
                filter: { _id: id },
                update: { $set: { sortOrder } }
            }
        }));
        if (ops.length > 0) {
            await OfferCard.bulkWrite(ops);
        }
        ok(res, null, 'Order updated');
    }
);

adminOfferCardRoutes.patch(
    '/:id',
    requirePermission('banners', 'update'),
    validate(z.object(fields).partial()),
    async (req, res) => {
        const card = await OfferCard.findById(req.params.id);
        if (!card) throw new NotFoundError('Offer card not found');
        Object.assign(card, req.body);
        ok(res, await card.save(), 'Offer card updated');
    }
);

adminOfferCardRoutes.delete(
    '/:id',
    requirePermission('banners', 'delete'),
    async (req, res) => {
        const result = await OfferCard.deleteOne({ _id: req.params.id });
        if (!result.deletedCount) throw new NotFoundError('Offer card not found');
        ok(res, null, 'Offer card deleted');
    }
);
