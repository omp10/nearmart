import { Router } from 'express';
import { z } from 'zod';
import { created, ok } from '../../lib/response.js';
import { validate } from '../../lib/validate.js';
import { authenticate, requireAdmin, requirePermission } from '../../middleware/auth.js';
import { BUSINESS_MODULES } from '../staff/permissions.js';
import * as coupons from './coupon.service.js';

const paise = z.number().int().min(0);
const fields = {
    code: z.string().trim().toUpperCase().regex(/^[A-Z0-9_-]{3,20}$/, '3–20 letters, digits, - or _'),
    description: z.string().trim().max(200).optional(),
    type: z.enum(['percent', 'flat']),
    value: z.number().positive(),
    maxDiscountPaise: paise.nullable().optional(),
    minOrderPaise: paise.optional(),
    modules: z.array(z.enum(BUSINESS_MODULES)).optional(),
    seller: z.string().regex(/^[a-f0-9]{24}$/i, 'Invalid seller').nullable().optional(),
    fundedBy: z.enum(['platform', 'seller']).optional(),
    validFrom: z.coerce.date().nullable().optional(),
    validTo: z.coerce.date().nullable().optional(),
    usageLimit: z.number().int().min(1).nullable().optional(),
    perUserLimit: z.number().int().min(1).optional(),
    firstOrderOnly: z.boolean().optional(),
    isActive: z.boolean().optional()
};

/** Coupons apply across modules, so managing them is for admins. */
const router = Router();
router.use(authenticate, requireAdmin);

router.get('/', requirePermission('coupons', 'view'), async (_req, res) => {
    ok(res, await coupons.listCoupons());
});

router.post('/', requirePermission('coupons', 'create'), validate(z.object(fields).refine((c) => c.fundedBy !== 'seller' || c.seller, { message: 'A seller-funded coupon must be limited to that seller', path: ['seller'] })), async (req, res) => {
    created(res, await coupons.createCoupon(req.body), 'Coupon created');
});

router.patch('/:id', requirePermission('coupons', 'update'), validate(z.object(fields).partial()), async (req, res) => {
    ok(res, await coupons.updateCoupon(req.params.id, req.body), 'Coupon updated');
});

router.delete('/:id', requirePermission('coupons', 'delete'), async (req, res) => {
    await coupons.deleteCoupon(req.params.id);
    ok(res, null, 'Coupon deleted');
});

export default router;
