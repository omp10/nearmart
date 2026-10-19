import { Router } from 'express';
import { z } from 'zod';
import { NotFoundError } from '../../lib/errors.js';
import { isValidDate } from '../../lib/istTime.js';
import { created, ok } from '../../lib/response.js';
import { validate } from '../../lib/validate.js';
import { allowedModules, authenticate, requireAdmin, requirePermission } from '../../middleware/auth.js';
import { assertModule } from '../catalog/product.service.js';
import { BUSINESS_MODULES } from '../staff/permissions.js';
import { checkServiceability } from '../zones/zone.service.js';
import { locationQuery } from '../zones/zone.routes.js';
import { SLOT_KINDS, SlotBlackout } from './slot.model.js';
import * as slots from './slot.service.js';

const objectId = z.string().regex(/^[a-f0-9]{24}$/i, 'Invalid id');
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM (24-hour)');
const date = z.string().refine(isValidDate, 'Use YYYY-MM-DD');

/** Public: slots the app can offer at a location. */
export const publicSlotRoutes = Router();

publicSlotRoutes.get(
    '/',
    validate(
        z.intersection(
            locationQuery,
            z.object({
                module: z.enum(BUSINESS_MODULES),
                kind: z.enum(SLOT_KINDS).default('delivery'),
                days: z.coerce.number().int().min(1).max(slots.MAX_DAYS_AHEAD).default(3)
            })
        ),
        'query'
    ),
    async (req, res) => {
        const { module, kind, days, ...where } = req.validatedQuery;
        const { zoneByModule } = await checkServiceability(where);
        const zone = zoneByModule[module];
        if (!zone) throw new NotFoundError('This address is outside our service area for that section');
        const daysList = await slots.generateSlots({ module, kind, zoneId: zone._id, days });
        ok(res, { zone: { id: String(zone._id), name: zone.name }, days: daysList });
    }
);

/** Slot rules and closed dates for the panel. Ops users manage their own modules' rules. */
export const adminSlotRoutes = Router();
adminSlotRoutes.use(authenticate);

const ruleFields = {
    module: z.enum(BUSINESS_MODULES),
    zone: objectId.nullable().optional(),
    kind: z.enum(SLOT_KINDS),
    daysOfWeek: z.array(z.number().int().min(0).max(6)).min(1, 'Pick at least one day'),
    start: hhmm,
    end: hhmm,
    capacity: z.number().int().min(1).max(10000),
    cutoffMinutes: z.number().int().min(0).max(7 * 24 * 60).optional(),
    isActive: z.boolean().optional()
};

adminSlotRoutes.get(
    '/rules',
    requirePermission('zones', 'view'),
    validate(z.object({ module: z.enum(BUSINESS_MODULES).optional() }), 'query'),
    async (req, res) => {
        const scope = allowedModules(req);
        const { module } = req.validatedQuery;
        if (module) assertModule(scope, module);
        ok(res, await slots.listRules(module ? { module } : scope ? { module: { $in: scope } } : {}));
    }
);

adminSlotRoutes.post('/rules', requirePermission('zones', 'create'), validate(z.object(ruleFields)), async (req, res) => {
    assertModule(allowedModules(req), req.body.module);
    created(res, await slots.createRule(req.body), 'Slot rule created');
});

adminSlotRoutes.patch(
    '/rules/:id',
    requirePermission('zones', 'update'),
    validate(z.object(ruleFields).omit({ module: true }).partial()),
    async (req, res) => {
        const rule = await slots.getRule(req.params.id);
        assertModule(allowedModules(req), rule.module);
        ok(res, await slots.updateRule(req.params.id, req.body), 'Slot rule updated');
    }
);

adminSlotRoutes.delete('/rules/:id', requirePermission('zones', 'delete'), async (req, res) => {
    const rule = await slots.getRule(req.params.id);
    assertModule(allowedModules(req), rule.module);
    await slots.deleteRule(req.params.id);
    ok(res, null, 'Slot rule deleted');
});

adminSlotRoutes.get(
    '/preview',
    requirePermission('zones', 'view'),
    validate(
        z.object({
            module: z.enum(BUSINESS_MODULES),
            kind: z.enum(SLOT_KINDS).default('delivery'),
            zone: objectId.optional(),
            days: z.coerce.number().int().min(1).max(slots.MAX_DAYS_AHEAD).default(7)
        }),
        'query'
    ),
    async (req, res) => {
        const { module, kind, zone, days } = req.validatedQuery;
        assertModule(allowedModules(req), module);
        ok(res, await slots.generateSlots({ module, kind, zoneId: zone, days, includeCounts: true }));
    }
);

// Closed dates affect every module's customers, so only admins set them.
adminSlotRoutes.get('/blackouts', requirePermission('zones', 'view'), async (_req, res) => {
    ok(res, await SlotBlackout.find().populate('zone', 'name').sort({ date: 1 }).lean());
});

adminSlotRoutes.post(
    '/blackouts',
    requireAdmin,
    requirePermission('zones', 'create'),
    validate(
        z.object({
            date,
            module: z.enum(BUSINESS_MODULES).nullable().optional(),
            zone: objectId.nullable().optional(),
            reason: z.string().trim().max(120).optional()
        })
    ),
    async (req, res) => {
        created(res, await SlotBlackout.create(req.body), 'Closed date added');
    }
);

adminSlotRoutes.delete('/blackouts/:id', requireAdmin, requirePermission('zones', 'delete'), async (req, res) => {
    const res2 = await SlotBlackout.deleteOne({ _id: objectId.parse(req.params.id) });
    if (!res2.deletedCount) throw new NotFoundError('Closed date not found');
    ok(res, null, 'Closed date removed');
});
