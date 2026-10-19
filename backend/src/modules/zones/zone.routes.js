import { Router } from 'express';
import { z } from 'zod';
import { created, ok } from '../../lib/response.js';
import { validate } from '../../lib/validate.js';
import { authenticate, requireAdmin, requirePermission } from '../../middleware/auth.js';
import { BUSINESS_MODULES } from '../staff/permissions.js';
import * as zones from './zone.service.js';

const lng = z.number().min(-180).max(180);
const lat = z.number().min(-90).max(90);
const position = z.tuple([lng, lat]);
/** Whether segments p1–p2 and p3–p4 properly cross (shared endpoints don't count). */
const segmentsCross = ([p1, p2], [p3, p4]) => {
    const orient = (a, b, c) => Math.sign((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]));
    const d1 = orient(p3, p4, p1);
    const d2 = orient(p3, p4, p2);
    const d3 = orient(p1, p2, p3);
    const d4 = orient(p1, p2, p4);
    return d1 * d2 < 0 && d3 * d4 < 0;
};

/**
 * MongoDB does not reliably reject a ring whose edges cross (a "bowtie"),
 * and point-in-polygon answers for one are meaningless, so check here.
 * Planar test on lng/lat is fine at city scale.
 */
const ringSelfIntersects = (r) => {
    const edges = r.slice(0, -1).map((p, i) => [p, r[i + 1]]);
    for (let i = 0; i < edges.length; i += 1) {
        for (let j = i + 2; j < edges.length; j += 1) {
            if (i === 0 && j === edges.length - 1) continue; // first and last edges share the closing point
            if (segmentsCross(edges[i], edges[j])) return true;
        }
    }
    return false;
};

const ring = z
    .array(position)
    .min(4, 'A polygon ring needs at least 4 points (first and last equal)')
    .max(5000)
    .refine((r) => r[0][0] === r.at(-1)[0] && r[0][1] === r.at(-1)[1], 'A polygon ring must end where it starts')
    .refine((r) => !ringSelfIntersects(r), 'The map area is not a valid polygon: its edges cross');

const polygonSchema = z.discriminatedUnion('type', [
    z.object({ type: z.literal('Polygon'), coordinates: z.array(ring).min(1) }),
    z.object({ type: z.literal('MultiPolygon'), coordinates: z.array(z.array(ring).min(1)).min(1) })
]);

const paise = z.number().int().min(0).nullable();
const zoneFields = {
    name: z.string().trim().min(1).max(80),
    isActive: z.boolean().optional(),
    modules: z.array(z.enum(BUSINESS_MODULES)).min(1, 'Choose at least one module'),
    pincodes: z.array(z.string().trim().regex(/^\d{6}$/, 'Pincodes are 6 digits')).max(2000).optional(),
    polygon: polygonSchema.nullable().optional(),
    priority: z.number().int().min(0).max(1000).optional(),
    minOrderPaise: paise.optional(),
    deliveryFeePaise: paise.optional(),
    freeDeliveryAbovePaise: paise.optional()
};

export const locationQuery = z
    .object({
        pincode: z.string().trim().regex(/^\d{6}$/, 'Pincodes are 6 digits').optional(),
        lat: z.coerce.number().min(-90).max(90).optional(),
        lng: z.coerce.number().min(-180).max(180).optional()
    })
    .refine((v) => v.pincode || (v.lat != null && v.lng != null), 'Provide a pincode or lat and lng');

/** Service-area management. Zones span modules, so editing them is for admins, not ops. */
export const adminZoneRoutes = Router();
adminZoneRoutes.use(authenticate);

adminZoneRoutes.get('/', requirePermission('zones', 'view'), async (_req, res) => {
    ok(res, await zones.listZones());
});

adminZoneRoutes.post('/check', requirePermission('zones', 'view'), validate(locationQuery), async (req, res) => {
    const matches = await zones.findZones(req.body);
    const result = await zones.checkServiceability(req.body);
    ok(res, { matches: matches.map((zn) => ({ _id: zn._id, name: zn.name, modules: zn.modules })), modules: result.modules });
});

adminZoneRoutes.post('/', requireAdmin, requirePermission('zones', 'create'), validate(z.object(zoneFields)), async (req, res) => {
    created(res, await zones.createZone(req.body), 'Service area created');
});

adminZoneRoutes.patch('/:id', requireAdmin, requirePermission('zones', 'update'), validate(z.object(zoneFields).partial()), async (req, res) => {
    ok(res, await zones.updateZone(req.params.id, req.body), 'Service area updated');
});

adminZoneRoutes.delete('/:id', requireAdmin, requirePermission('zones', 'delete'), async (req, res) => {
    await zones.deleteZone(req.params.id);
    ok(res, null, 'Service area deleted');
});

/** Public: can this location be served, and for which modules? */
export const serviceabilityRoutes = Router();

serviceabilityRoutes.get('/', validate(locationQuery, 'query'), async (req, res) => {
    const { serviceable, modules } = await zones.checkServiceability(req.validatedQuery);
    ok(res, { serviceable, modules });
});
