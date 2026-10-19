import { Router } from 'express';
import { z } from 'zod';
import { ok } from '../../lib/response.js';
import { validate } from '../../lib/validate.js';
import { authenticate, requireCustomer } from '../../middleware/auth.js';
import { BUSINESS_MODULES } from '../staff/permissions.js';
import * as cart from './cart.service.js';

const objectId = z.string().regex(/^[a-f0-9]{24}$/i, 'Invalid id');

const router = Router();
router.use(authenticate, requireCustomer);

router.get('/', async (req, res) => {
    ok(res, await cart.getCart(req.auth.id));
});

/** Sets the quantity of one product variant; 0 removes it. */
router.put(
    '/items',
    validate(z.object({ productId: objectId, variantId: objectId, qty: z.number().int().min(0).max(99) })),
    async (req, res) => {
        ok(res, await cart.setItem(req.auth.id, req.body), 'Cart updated');
    }
);

router.delete('/', validate(z.object({ module: z.enum(BUSINESS_MODULES).optional() }), 'query'), async (req, res) => {
    await cart.clearCart(req.auth.id, req.validatedQuery.module);
    ok(res, await cart.getCart(req.auth.id), 'Cart cleared');
});

export default router;
