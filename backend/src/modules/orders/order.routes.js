import { Router } from 'express';
import { z } from 'zod';
import { pageQuery } from '../../lib/pagination.js';
import { created, ok } from '../../lib/response.js';
import { validate } from '../../lib/validate.js';
import { allowedModules, authenticate, requireCustomer, requirePermission, requireStaff } from '../../middleware/auth.js';
import { PRODUCT_MODULES } from '../catalog/module.model.js';
import { CANCELLABLE_BY_CUSTOMER, ORDER_STATUSES } from './order.flow.js';
import * as orders from './order.service.js';

const objectId = z.string().regex(/^[a-f0-9]{24}$/i, 'Invalid id');

const checkoutFields = {
    module: z.enum(PRODUCT_MODULES),
    addressId: objectId,
    couponCode: z.string().trim().max(20).optional()
};

// ─── Customer ───

export const checkoutRoutes = Router();
checkoutRoutes.use(authenticate, requireCustomer);

/** Prices one module's part of the cart for the checkout screen. Changes nothing. */
checkoutRoutes.post('/quote', validate(z.object(checkoutFields)), async (req, res) => {
    const { lines, pricing, slotRequired, zone, coupon } = await orders.quote(req.auth.id, req.body);
    ok(res, {
        lines,
        pricing,
        slotRequired,
        zone: { id: String(zone._id), name: zone.name, minOrderPaise: zone.minOrderPaise, freeDeliveryAbovePaise: zone.freeDeliveryAbovePaise },
        coupon: coupon ? { code: coupon.code, description: coupon.description } : null
    });
});

checkoutRoutes.post(
    '/',
    validate(
        z.object({
            ...checkoutFields,
            slotId: z.string().max(60).optional(),
            paymentMethod: z.enum(['cod', 'online']),
            notes: z.string().trim().max(500).optional()
        })
    ),
    async (req, res) => {
        const result = await orders.placeOrder(req.auth.id, req.body);
        created(res, result, result.payment ? 'Order created; complete the payment' : 'Order placed');
    }
);

export const customerOrderRoutes = Router();
customerOrderRoutes.use(authenticate, requireCustomer);

customerOrderRoutes.get(
    '/',
    validate(z.object({ ...pageQuery, status: z.enum(['open', 'past']).optional() }), 'query'),
    async (req, res) => {
        ok(res, await orders.listCustomerOrders(req.auth.id, req.validatedQuery));
    }
);

customerOrderRoutes.get('/:id', async (req, res) => {
    ok(res, await orders.getCustomerOrder(req.auth.id, req.params.id));
});

customerOrderRoutes.get('/:id/payment', async (req, res) => {
    ok(res, await orders.paymentDetails(req.auth.id, req.params.id));
});

customerOrderRoutes.post('/:id/cancel', validate(z.object({ reason: z.string().trim().max(200).optional() })), async (req, res) => {
    const order = await orders.cancelOrder(req.params.id, {
        by: { kind: 'user', id: req.auth.id },
        reason: req.body.reason || 'Cancelled by customer',
        allowed: CANCELLABLE_BY_CUSTOMER,
        userId: req.auth.id
    });
    ok(res, order, 'Order cancelled');
});

customerOrderRoutes.post('/:id/reorder', async (req, res) => {
    ok(res, await orders.reorder(req.auth.id, req.params.id), 'Items added to your cart');
});

// ─── Panel ───

export const adminOrderRoutes = Router();
adminOrderRoutes.use(authenticate, requireStaff());

const ctx = (req) => ({ allowedModules: allowedModules(req), by: { kind: 'staff', id: req.auth.id } });

adminOrderRoutes.get(
    '/',
    requirePermission('orders', 'view'),
    validate(
        z.object({
            ...pageQuery,
            module: z.enum(PRODUCT_MODULES).optional(),
            status: z.enum([...ORDER_STATUSES, 'open']).optional(),
            from: z.coerce.date().optional(),
            to: z.coerce.date().optional(),
            slotDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
            q: z.string().trim().max(60).optional()
        }),
        'query'
    ),
    async (req, res) => {
        ok(res, await orders.listAdminOrders(req.validatedQuery, ctx(req)));
    }
);

adminOrderRoutes.get('/:id', requirePermission('orders', 'view'), async (req, res) => {
    ok(res, await orders.getAdminOrder(req.params.id, ctx(req)));
});

adminOrderRoutes.post(
    '/:id/status',
    requirePermission('orders', 'update'),
    validate(z.object({ status: z.enum(ORDER_STATUSES.filter((s) => s !== 'pending_payment')), note: z.string().trim().max(300).optional() })),
    async (req, res) => {
        ok(res, await orders.advanceStatus(req.params.id, { to: req.body.status, note: req.body.note, ...ctx(req) }), 'Order updated');
    }
);

adminOrderRoutes.post(
    '/:id/cancel',
    requirePermission('orders', 'update'),
    validate(z.object({ reason: z.string().trim().min(3, 'Give a reason').max(300) })),
    async (req, res) => {
        ok(res, await orders.cancelOrder(req.params.id, { reason: req.body.reason, ...ctx(req) }), 'Order cancelled');
    }
);

adminOrderRoutes.post(
    '/:id/items/:lineId/unavailable',
    requirePermission('orders', 'update'),
    validate(z.object({ note: z.string().trim().max(200).optional() })),
    async (req, res) => {
        ok(res, await orders.markItemUnavailable(req.params.id, req.params.lineId, { note: req.body.note, ...ctx(req) }), 'Item marked unavailable');
    }
);

adminOrderRoutes.post('/:id/retry-refund', requirePermission('orders', 'update'), async (req, res) => {
    ok(res, await orders.retryRefund(req.params.id, ctx(req)), 'Refund requested');
});
