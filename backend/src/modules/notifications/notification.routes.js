import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../../middleware/auth.js';
import { ok } from '../../lib/response.js';
import { validate } from '../../lib/validate.js';
import * as service from './notification.service.js';

const router = Router();
router.use(authenticate);

const owner = (req) => ({ ownerKind: req.auth.kind, ownerId: req.auth.id });

const deviceSchema = z.object({
    token: z.string().min(20).max(4096),
    platform: z.enum(['android', 'ios', 'web'])
});

/** The app calls this after login and whenever FCM rotates the token. */
router.post('/devices', validate(deviceSchema), async (req, res) => {
    await service.registerDevice({ ...owner(req), ...req.body }, { exclusive: req.auth.kind === 'user' });
    ok(res, null, 'Device registered');
});

router.delete('/devices', validate(z.object({ token: z.string().optional() })), async (req, res) => {
    await service.unregisterDevice({ ...owner(req), token: req.body.token });
    ok(res, null, 'Device removed');
});

const pageSchema = z.object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20)
});

router.get('/', validate(pageSchema, 'query'), async (req, res) => {
    ok(res, await service.listInbox(owner(req), req.validatedQuery));
});

router.post('/read-all', async (req, res) => {
    await service.markAllRead(owner(req));
    ok(res, null, 'All marked read');
});

router.post('/:id/read', async (req, res) => {
    await service.markRead(owner(req), req.params.id);
    ok(res, null, 'Marked read');
});

export default router;
