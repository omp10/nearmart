import { Router } from 'express';
import { z } from 'zod';
import { ForbiddenError } from '../../lib/errors.js';
import { pageQuery } from '../../lib/pagination.js';
import { created, ok } from '../../lib/response.js';
import { normalizeIndianPhone, validate } from '../../lib/validate.js';
import { allowedModules, authenticate, requirePermission, requireRider, requireStaff } from '../../middleware/auth.js';
import { BUSINESS_MODULES } from '../staff/permissions.js';
import { VEHICLES } from './rider.model.js';
import { FAIL_REASONS, TASK_KINDS } from './task.model.js';
import * as riders from './rider.service.js';
import * as tasks from './task.service.js';

const objectId = z.string().regex(/^[a-f0-9]{24}$/i, 'Invalid id');
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
/** A YYYY-MM-DD day in India time, as the start (or end) instant of that day. */
const istDay = (d, end = false) => (d ? new Date(`${d}T${end ? '23:59:59.999' : '00:00:00.000'}+05:30`) : undefined);
const point = { lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) };
const photo = z.string().trim().url().max(500).optional();

// ─── Rider app: /rider ───

export const riderAppRoutes = Router();
riderAppRoutes.use(authenticate, requireRider);

riderAppRoutes.get('/me', async (req, res) => {
    ok(res, await riders.getRiderMe(req.auth.id));
});

riderAppRoutes.post('/shift', validate(z.object({ online: z.boolean() })), async (req, res) => {
    ok(res, await riders.setShift(req.auth.id, req.body.online), req.body.online ? "You're online" : "You're offline");
});

riderAppRoutes.post(
    '/location',
    validate(z.object({ ...point, heading: z.number().optional(), speed: z.number().optional(), accuracy: z.number().optional() })),
    async (req, res) => {
        await riders.recordLocation(req.auth.id, req.body);
        ok(res, null);
    }
);

riderAppRoutes.get(
    '/tasks',
    validate(z.object({ ...pageQuery, status: z.enum(['active', 'done']).default('active'), from: date.optional(), to: date.optional() }), 'query'),
    async (req, res) => {
        const { from, to, ...rest } = req.validatedQuery;
        ok(res, await tasks.listRiderTasks(req.auth.id, { ...rest, from: istDay(from), to: istDay(to, true) }));
    }
);

riderAppRoutes.get('/tasks/:id', async (req, res) => {
    ok(res, await tasks.getRiderTask(req.auth.id, objectId.parse(req.params.id)));
});

riderAppRoutes.post('/tasks/:id/accept', async (req, res) => {
    ok(res, await tasks.acceptTask(req.auth.id, objectId.parse(req.params.id)), 'Task accepted');
});

riderAppRoutes.post('/tasks/:id/reject', validate(z.object({ reason: z.string().trim().max(200).optional() })), async (req, res) => {
    ok(res, await tasks.rejectTask(req.auth.id, objectId.parse(req.params.id), req.body), 'Task declined');
});

riderAppRoutes.post('/tasks/:id/arrived', validate(z.object({ lat: point.lat.optional(), lng: point.lng.optional() })), async (req, res) => {
    ok(res, await tasks.markArrived(req.auth.id, objectId.parse(req.params.id), req.body));
});

riderAppRoutes.post('/tasks/:id/picked-up', validate(z.object({ lat: point.lat.optional(), lng: point.lng.optional(), photo })), async (req, res) => {
    ok(res, await tasks.markPickedUp(req.auth.id, objectId.parse(req.params.id), req.body), 'Picked up');
});

riderAppRoutes.post(
    '/tasks/:id/complete',
    validate(
        z.object({
            lat: point.lat.optional(),
            lng: point.lng.optional(),
            otp: z.string().trim().max(8).optional(),
            collectedPaise: z.number().int().min(0).default(0),
            collectionMode: z.enum(['cash', 'upi']).default('cash'),
            photo
        })
    ),
    async (req, res) => {
        ok(res, await tasks.completeTask(req.auth.id, objectId.parse(req.params.id), req.body), 'Completed');
    }
);

riderAppRoutes.post('/tasks/:id/fail', validate(z.object({ reason: z.enum(FAIL_REASONS), note: z.string().trim().max(300).optional() })), async (req, res) => {
    ok(res, await tasks.failTask(req.auth.id, objectId.parse(req.params.id), req.body), 'Reported to the store');
});

riderAppRoutes.get('/earnings', validate(z.object({ from: date.optional(), to: date.optional() }), 'query'), async (req, res) => {
    const { from, to } = req.validatedQuery;
    ok(res, await tasks.riderEarnings(req.auth.id, { from: istDay(from), to: istDay(to, true) }));
});

riderAppRoutes.get('/cash', async (req, res) => {
    ok(res, await tasks.riderCash(req.auth.id));
});

riderAppRoutes.post(
    '/cash/deposit',
    validate(z.object({ amountPaise: z.number().int().min(100), mode: z.enum(['upi', 'store']), reference: z.string().trim().max(120).optional() })),
    async (req, res) => {
        created(res, await tasks.requestDeposit(req.auth.id, req.body), 'Deposit sent for confirmation');
    }
);

// ─── Admin panel: /admin/riders ───

export const adminRiderRoutes = Router();
adminRiderRoutes.use(authenticate, requireStaff());

const ctx = (req) => ({ allowedModules: allowedModules(req), by: req.auth.id });

const phone = z.string().transform((v, c) => {
    const p = normalizeIndianPhone(v);
    if (!p) c.addIssue({ code: 'custom', message: 'Enter a valid 10-digit mobile number' });
    return p;
});

const riderFields = {
    name: z.string().trim().min(2).max(80),
    phone,
    vehicle: z.enum(VEHICLES).default('bike'),
    modules: z.array(z.enum(BUSINESS_MODULES)).default([]),
    payoutPerTaskPaise: z.number().int().min(0).max(100000).default(3000),
    isActive: z.boolean().default(true)
};

// Tasks and deposits first, so "/tasks" isn't read as a rider id.

adminRiderRoutes.get(
    '/tasks',
    validate(z.object({ ...pageQuery, status: z.enum(['active', 'done', 'all']).default('active'), riderId: objectId.optional(), refId: objectId.optional() }), 'query'),
    async (req, res) => {
        const auth = req.auth;
        const canSee = auth.isSuperAdmin || ['riders', 'orders', 'bookings'].some((s) => (auth.permissions?.[s] || []).includes('view'));
        if (!canSee) throw new ForbiddenError();
        ok(res, await tasks.listTasks(req.validatedQuery, ctx(req)));
    }
);

adminRiderRoutes.post(
    '/tasks',
    validate(z.object({ kind: z.enum(TASK_KINDS), refId: objectId, riderId: objectId, payoutPaise: z.number().int().min(0).max(100000).optional() })),
    (req, _res, next) => requirePermission(req.body.kind === 'order_delivery' ? 'orders' : 'bookings', 'update')(req, _res, next),
    async (req, res) => {
        created(res, await tasks.createTask(req.body, ctx(req)), 'Delivery partner assigned');
    }
);

adminRiderRoutes.post('/tasks/:id/cancel', validate(z.object({ reason: z.string().trim().max(200).optional() })), async (req, res) => {
    const auth = req.auth;
    const canUpdate = auth.isSuperAdmin || ['riders', 'orders', 'bookings'].some((s) => (auth.permissions?.[s] || []).includes('update'));
    if (!canUpdate) throw new ForbiddenError();
    ok(res, await tasks.cancelTask(objectId.parse(req.params.id), { reason: req.body.reason || 'Reassigned by the store', ...ctx(req) }), 'Assignment cancelled');
});

adminRiderRoutes.get(
    '/deposits',
    requirePermission('riders', 'view'),
    validate(z.object({ ...pageQuery, status: z.enum(['pending', 'confirmed', 'rejected']).optional() }), 'query'),
    async (req, res) => {
        ok(res, await tasks.listDeposits(req.validatedQuery));
    }
);

adminRiderRoutes.post('/deposits/:id/confirm', requirePermission('riders', 'update'), async (req, res) => {
    ok(res, await tasks.decideDeposit(objectId.parse(req.params.id), { confirm: true, by: req.auth.id }), 'Deposit confirmed');
});

adminRiderRoutes.post('/deposits/:id/reject', requirePermission('riders', 'update'), async (req, res) => {
    ok(res, await tasks.decideDeposit(objectId.parse(req.params.id), { confirm: false, by: req.auth.id }), 'Deposit rejected');
});

adminRiderRoutes.get(
    '/',
    // Anyone who can assign deliveries needs the partner list.
    (req, _res, next) => {
        const auth = req.auth;
        const ok = auth.isSuperAdmin || ['riders', 'orders', 'bookings'].some((s) => (auth.permissions?.[s] || []).includes('view'));
        return ok ? next() : next(new ForbiddenError());
    },
    validate(z.object({ ...pageQuery, q: z.string().trim().max(60).optional(), status: z.enum(['online', 'active', 'inactive']).optional() }), 'query'),
    async (req, res) => {
        ok(res, await riders.listRiders(req.validatedQuery));
    }
);

adminRiderRoutes.post('/', requirePermission('riders', 'create'), validate(z.object(riderFields)), async (req, res) => {
    created(res, await riders.createRider(req.body, ctx(req)), 'Delivery partner added');
});

adminRiderRoutes.get('/:id', requirePermission('riders', 'view'), async (req, res) => {
    ok(res, await riders.getRider(objectId.parse(req.params.id)));
});

adminRiderRoutes.patch('/:id', requirePermission('riders', 'update'), validate(z.object(riderFields).partial()), async (req, res) => {
    ok(res, await riders.updateRider(objectId.parse(req.params.id), req.body), 'Delivery partner updated');
});
