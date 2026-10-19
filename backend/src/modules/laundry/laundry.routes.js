import { Router } from 'express';
import { z } from 'zod';
import { ForbiddenError } from '../../lib/errors.js';
import { pageQuery } from '../../lib/pagination.js';
import { created, ok } from '../../lib/response.js';
import { validate } from '../../lib/validate.js';
import { allowedModules, authenticate, requireCustomer, requirePermission, requireStaff } from '../../middleware/auth.js';
import { BOOKING_STATUSES } from './booking.flow.js';
import * as laundry from './booking.service.js';

const objectId = z.string().regex(/^[a-f0-9]{24}$/i, 'Invalid id');
const qty = z.number().min(0).max(1000);

// ─── Customer ───

export const customerLaundryRoutes = Router();

/** The price chart. Public, so the app can show it before sign-in. */
customerLaundryRoutes.get('/services', async (_req, res) => {
    const rows = await laundry.listServices({ activeOnly: true });
    ok(res, rows.map(({ _id, name, slug, description, image, pricingUnit, ratePaise, minQty, turnaroundHours }) => ({
        id: String(_id), name, slug, description, image, pricingUnit, ratePaise, minQty, turnaroundHours
    })));
});

const bookingFields = {
    addressId: objectId,
    items: z.array(z.object({ serviceId: objectId, estimatedQty: qty.positive('Enter an estimate') })).min(1, 'Choose at least one service').max(10)
};

customerLaundryRoutes.use('/bookings', authenticate, requireCustomer);

customerLaundryRoutes.post('/bookings/quote', validate(z.object(bookingFields)), async (req, res) => {
    const { lines, pricing, zone } = await laundry.quoteBooking(req.auth.id, req.body);
    ok(res, { lines, pricing, zone: { id: String(zone._id), name: zone.name } });
});

customerLaundryRoutes.post(
    '/bookings',
    validate(
        z.object({
            ...bookingFields,
            pickupSlotId: z.string().min(1, 'Choose a pickup slot').max(60),
            instructions: z.string().trim().max(500).optional(),
            pickupNotes: z.string().trim().max(300).optional(),
            paymentMethod: z.enum(['cod', 'online'])
        })
    ),
    async (req, res) => {
        const result = await laundry.createBooking(req.auth.id, req.body);
        created(res, result, result.payment ? 'Booking created; complete the payment' : 'Pickup booked');
    }
);

customerLaundryRoutes.get(
    '/bookings',
    validate(z.object({ ...pageQuery, status: z.enum(['active', 'past']).optional() }), 'query'),
    async (req, res) => {
        ok(res, await laundry.listCustomerBookings(req.auth.id, req.validatedQuery));
    }
);

customerLaundryRoutes.get('/bookings/:id', async (req, res) => {
    ok(res, await laundry.getCustomerBooking(req.auth.id, req.params.id));
});

customerLaundryRoutes.get('/bookings/:id/payment', async (req, res) => {
    ok(res, await laundry.bookingPaymentDetails(req.auth.id, req.params.id));
});

customerLaundryRoutes.post('/bookings/:id/cancel', validate(z.object({ reason: z.string().trim().max(200).optional() })), async (req, res) => {
    const by = { kind: 'user', id: req.auth.id };
    ok(res, await laundry.cancelBooking(req.params.id, { by, reason: req.body.reason || 'Cancelled by customer', userId: req.auth.id }), 'Booking cancelled');
});

customerLaundryRoutes.post('/bookings/:id/return-slot', validate(z.object({ slotId: z.string().min(1).max(60) })), async (req, res) => {
    const by = { kind: 'user', id: req.auth.id };
    ok(res, await laundry.setReturnSlot(req.params.id, req.body.slotId, { by, userId: req.auth.id }), 'Return slot booked');
});

// ─── Panel ───

export const adminLaundryRoutes = Router();
adminLaundryRoutes.use(authenticate, requireStaff());
const ctx = (req) => ({ allowedModules: allowedModules(req), by: { kind: 'staff', id: req.auth.id } });

const serviceFields = {
    name: z.string().trim().min(1).max(80),
    description: z.string().trim().max(500).optional(),
    image: z.string().trim().max(500).optional(),
    pricingUnit: z.enum(['kg', 'piece']),
    ratePaise: z.number().int().min(1),
    minQty: z.number().min(0).max(100).optional(),
    turnaroundHours: z.number().int().min(1).max(720).optional(),
    gstRate: z.union([0, 5, 12, 18, 28].map((r) => z.literal(r))).optional(),
    sortOrder: z.number().int().optional(),
    isActive: z.boolean().optional()
};

const laundryOnly = (req) => {
    const scope = allowedModules(req);
    if (scope && !scope.includes('laundry')) throw new ForbiddenError('No access to the laundry module');
};

adminLaundryRoutes.get('/services', requirePermission('catalog', 'view'), async (req, res) => {
    laundryOnly(req);
    ok(res, await laundry.listServices());
});
adminLaundryRoutes.post('/services', requirePermission('catalog', 'create'), validate(z.object(serviceFields)), async (req, res) => {
    laundryOnly(req);
    created(res, await laundry.createService(req.body), 'Service created');
});
adminLaundryRoutes.patch('/services/:id', requirePermission('catalog', 'update'), validate(z.object(serviceFields).partial()), async (req, res) => {
    laundryOnly(req);
    ok(res, await laundry.updateService(req.params.id, req.body), 'Service updated');
});
adminLaundryRoutes.delete('/services/:id', requirePermission('catalog', 'delete'), async (req, res) => {
    laundryOnly(req);
    await laundry.deleteService(req.params.id);
    ok(res, null, 'Service deleted');
});

adminLaundryRoutes.get(
    '/bookings',
    requirePermission('bookings', 'view'),
    validate(
        z.object({
            ...pageQuery,
            status: z.enum([...BOOKING_STATUSES, 'active']).optional(),
            pickupDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
            q: z.string().trim().max(60).optional()
        }),
        'query'
    ),
    async (req, res) => {
        ok(res, await laundry.listAdminBookings(req.validatedQuery, ctx(req)));
    }
);

adminLaundryRoutes.get('/bookings/:id', requirePermission('bookings', 'view'), async (req, res) => {
    ok(res, await laundry.getAdminBooking(req.params.id, ctx(req)));
});

adminLaundryRoutes.post(
    '/bookings/:id/status',
    requirePermission('bookings', 'update'),
    validate(z.object({ status: z.enum(BOOKING_STATUSES), note: z.string().trim().max(300).optional() })),
    async (req, res) => {
        ok(res, await laundry.advanceBooking(req.params.id, { to: req.body.status, note: req.body.note, ...ctx(req) }), 'Booking updated');
    }
);

adminLaundryRoutes.post(
    '/bookings/:id/weigh',
    requirePermission('bookings', 'update'),
    validate(z.object({ lines: z.array(z.object({ lineId: objectId, finalQty: qty })).min(1), note: z.string().trim().max(300).optional() })),
    async (req, res) => {
        ok(res, await laundry.weighBooking(req.params.id, { ...req.body, ...ctx(req) }), 'Weight confirmed');
    }
);

adminLaundryRoutes.post('/bookings/:id/return-slot', requirePermission('bookings', 'update'), validate(z.object({ slotId: z.string().min(1).max(60) })), async (req, res) => {
    ok(res, await laundry.setReturnSlot(req.params.id, req.body.slotId, ctx(req)), 'Return slot booked');
});

adminLaundryRoutes.post(
    '/bookings/:id/cancel',
    requirePermission('bookings', 'update'),
    validate(z.object({ reason: z.string().trim().min(3, 'Give a reason').max(300) })),
    async (req, res) => {
        ok(res, await laundry.cancelBooking(req.params.id, { reason: req.body.reason, ...ctx(req) }), 'Booking cancelled');
    }
);

adminLaundryRoutes.post('/bookings/:id/retry-refund', requirePermission('bookings', 'update'), async (req, res) => {
    ok(res, await laundry.retryBookingRefund(req.params.id, ctx(req)), 'Refund requested');
});
