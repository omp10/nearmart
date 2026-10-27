import { Router } from 'express';
import { z } from 'zod';
import { NotFoundError } from '../../lib/errors.js';
import { created, ok } from '../../lib/response.js';
import { validate } from '../../lib/validate.js';
import { authenticate, requireAdmin, requirePermission } from '../../middleware/auth.js';
import { BANNER_LINK_TYPES, BANNER_PLACEMENTS, Banner } from './banner.model.js';

const fields = {
    title: z.string().trim().min(1).max(100),
    image: z.string().trim().min(1, 'Upload an image').max(500),
    video: z.string().trim().max(500).optional(),
    placement: z.enum(BANNER_PLACEMENTS).optional(),
    link: z.object({ type: z.enum(BANNER_LINK_TYPES), value: z.string().trim().max(500).optional() }).optional(),
    sortOrder: z.number().int().optional(),
    isActive: z.boolean().optional(),
    startsAt: z.coerce.date().nullable().optional(),
    endsAt: z.coerce.date().nullable().optional()
};

/** Public: banners live now for a placement, in display order. */
export const publicBannerRoutes = Router();
publicBannerRoutes.get('/', validate(z.object({ placement: z.enum(BANNER_PLACEMENTS).default('home') }), 'query'), async (req, res) => {
    const now = new Date();
    const rows = await Banner.find({
        placement: req.validatedQuery.placement,
        isActive: true,
        $and: [
            { $or: [{ startsAt: null }, { startsAt: { $lte: now } }] },
            { $or: [{ endsAt: null }, { endsAt: { $gt: now } }] }
        ]
    })
        .sort({ sortOrder: 1, createdAt: -1 })
        .lean();
    ok(res, rows.map(({ _id, title, image, video, link }) => ({ id: String(_id), title, image, video: video || '', link })));
});

export const adminBannerRoutes = Router();
adminBannerRoutes.use(authenticate, requireAdmin);

adminBannerRoutes.get('/', requirePermission('banners', 'view'), async (_req, res) => {
    ok(res, await Banner.find().sort({ placement: 1, sortOrder: 1, createdAt: -1 }).lean());
});

adminBannerRoutes.post('/', requirePermission('banners', 'create'), validate(z.object(fields)), async (req, res) => {
    created(res, await Banner.create(req.body), 'Banner created');
});

adminBannerRoutes.patch('/:id', requirePermission('banners', 'update'), validate(z.object(fields).partial()), async (req, res) => {
    const banner = await Banner.findById(req.params.id);
    if (!banner) throw new NotFoundError('Banner not found');
    Object.assign(banner, req.body);
    ok(res, await banner.save(), 'Banner updated');
});

adminBannerRoutes.delete('/:id', requirePermission('banners', 'delete'), async (req, res) => {
    const result = await Banner.deleteOne({ _id: req.params.id });
    if (!result.deletedCount) throw new NotFoundError('Banner not found');
    ok(res, null, 'Banner deleted');
});
