import { Router } from 'express';
import { z } from 'zod';
import { ok } from '../../lib/response.js';
import { validate } from '../../lib/validate.js';
import { authenticate, requireAdmin, requirePermission, requireSuperAdmin } from '../../middleware/auth.js';
import { clearGateway, describeGateway, saveGateway } from '../payments/gateway.config.js';
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
        operations: z.object({ acceptingOrders: z.boolean(), pausedMessage: z.string().trim().max(200) }).partial(),
        maps: z.object({ googleApiKey: z.union([z.literal(''), z.string().trim().regex(/^AIza[0-9A-Za-z_-]{35}$/, "That doesn't look like a Google API key (it starts with AIza)")]) }).partial()
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

// Payment gateway credentials: super admin only. Secrets go in, never come out.
const secret = z.string().trim().min(8, 'Too short').max(200);
const gatewaySchema = z.object({
    keyId: z.string().trim().regex(/^rzp_(test|live)_[A-Za-z0-9]+$/, 'Key id starts with rzp_test_ or rzp_live_'),
    keySecret: z.union([z.literal(''), secret]).optional(),
    webhookSecret: z.union([z.literal(''), secret]).optional()
});

adminSettingsRoutes.get('/payment-gateway', requireSuperAdmin, async (_req, res) => {
    ok(res, await describeGateway());
});

adminSettingsRoutes.put('/payment-gateway', requireSuperAdmin, validate(gatewaySchema), async (req, res) => {
    ok(res, await saveGateway(req.body, req.auth.id), 'Payment gateway saved');
});

adminSettingsRoutes.delete('/payment-gateway', requireSuperAdmin, async (_req, res) => {
    ok(res, await clearGateway(), 'Using the server environment keys');
});
