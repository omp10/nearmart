import { Router } from 'express';
import { z } from 'zod';
import { ok } from '../../lib/response.js';
import { validate } from '../../lib/validate.js';
import { authenticate, requireAdmin, requirePermission } from '../../middleware/auth.js';
import * as settings from './settings.service.js';

const phone = z.string().trim().max(20);
const policy = z.string().max(20000);

const patchSchema = z
    .object({
        contact: z
            .object({
                phone,
                whatsapp: phone,
                email: z.union([z.string().trim().email(), z.literal('')]),
                address: z.string().trim().max(300),
                supportHours: z.string().trim().max(100)
            })
            .partial(),
        policies: z.object({ terms: policy, privacy: policy, refund: policy, cancellation: policy, delivery: policy }).partial(),
        orders: z
            .object({
                codEnabled: z.boolean(),
                onlinePaymentEnabled: z.boolean(),
                codMaxOrderPaise: z.number().int().min(0).nullable()
            })
            .partial(),
        operations: z.object({ acceptingOrders: z.boolean(), pausedMessage: z.string().trim().max(200) }).partial()
    })
    .partial();

export const publicSettingsRoutes = Router();
publicSettingsRoutes.get('/', async (_req, res) => {
    ok(res, await settings.publicSettings());
});

export const adminSettingsRoutes = Router();
adminSettingsRoutes.use(authenticate, requireAdmin);

adminSettingsRoutes.get('/', requirePermission('settings', 'view'), async (_req, res) => {
    ok(res, await settings.getSettings());
});

adminSettingsRoutes.patch('/', requirePermission('settings', 'update'), validate(patchSchema), async (req, res) => {
    ok(res, await settings.updateSettings(req.body), 'Settings saved');
});
