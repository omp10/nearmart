import { Router } from 'express';
import { z } from 'zod';
import { ForbiddenError, NotFoundError } from '../../lib/errors.js';
import { created, ok } from '../../lib/response.js';
import { validate } from '../../lib/validate.js';
import { authenticate, requirePermission } from '../../middleware/auth.js';
import { revokeAllForSubject } from '../auth/token.service.js';
import { staffProfile } from '../auth/auth.service.js';
import { BUSINESS_MODULES, sanitizePermissions, STAFF_ROLES } from './permissions.js';
import { Staff } from './staff.model.js';

const router = Router();
router.use(authenticate);

const permissionsField = z.record(z.array(z.string())).transform(sanitizePermissions);
const passwordField = z.string().min(10, 'Use at least 10 characters').max(200);

const createSchema = z.object({
    name: z.string().trim().min(1).max(80),
    email: z.string().trim().toLowerCase().email(),
    phone: z.string().trim().max(20).optional(),
    password: passwordField,
    role: z.enum([STAFF_ROLES.ADMIN, STAFF_ROLES.OPS]),
    permissions: permissionsField.optional(),
    modules: z.array(z.enum(BUSINESS_MODULES)).optional()
});

const updateSchema = createSchema.omit({ email: true, password: true }).partial().extend({
    isActive: z.boolean().optional()
});

/** Only a super admin can create, edit or disable another super admin. */
const loadEditable = async (req) => {
    const staff = await Staff.findById(req.params.id);
    if (!staff) throw new NotFoundError('Staff member not found');
    if (staff.isSuperAdmin && !req.auth.isSuperAdmin) throw new ForbiddenError();
    return staff;
};

/**
 * A sub-admin may only hand out permissions they hold themselves, and may not
 * change their own role, permissions or modules; otherwise `staff:update`
 * would be a route to full access.
 */
const assertCanGrant = (req, targetId) => {
    if (req.auth.isSuperAdmin) return;
    const { permissions, role, modules } = req.body;
    if (targetId === req.auth.id && (permissions || role || modules)) {
        throw new ForbiddenError('You cannot change your own access');
    }
    for (const [section, actions] of Object.entries(permissions || {})) {
        const held = req.auth.permissions?.[section] || [];
        if (actions.some((a) => !held.includes(a))) {
            throw new ForbiddenError(`You cannot grant ${section} permissions you do not have`);
        }
    }
};

router.get(
    '/',
    requirePermission('staff', 'view'),
    validate(z.object({ role: z.enum([STAFF_ROLES.ADMIN, STAFF_ROLES.OPS]).optional() }), 'query'),
    async (req, res) => {
        const filter = req.validatedQuery.role ? { role: req.validatedQuery.role } : {};
        const rows = await Staff.find(filter).sort({ createdAt: -1 }).lean();
        ok(res, rows.map((s) => ({ ...staffProfile(s), isActive: s.isActive, lastLoginAt: s.lastLoginAt })));
    }
);

router.post('/', requirePermission('staff', 'create'), validate(createSchema), async (req, res) => {
    assertCanGrant(req, null);
    const staff = await Staff.create({ ...req.body, isSuperAdmin: false, createdBy: req.auth.id });
    created(res, staffProfile(staff), 'Staff member created');
});

router.patch('/:id', requirePermission('staff', 'update'), validate(updateSchema), async (req, res) => {
    if (req.params.id === req.auth.id && req.body.isActive === false) {
        throw new ForbiddenError('You cannot deactivate your own account');
    }
    assertCanGrant(req, req.params.id);
    const staff = await loadEditable(req);
    const wasActive = staff.isActive;
    Object.assign(staff, req.body);
    // Permission or status changes take effect on the next request, not at token expiry.
    if (req.body.permissions || req.body.role || req.body.modules || (wasActive && staff.isActive === false)) {
        staff.tokenVersion += 1;
    }
    await staff.save();
    if (!staff.isActive) await revokeAllForSubject(staff._id, 'staff');
    ok(res, { ...staffProfile(staff), isActive: staff.isActive }, 'Staff member updated');
});

router.post(
    '/:id/reset-password',
    requirePermission('staff', 'update'),
    validate(z.object({ password: passwordField })),
    async (req, res) => {
        const staff = await loadEditable(req);
        staff.password = req.body.password;
        staff.tokenVersion += 1;
        await staff.save();
        await revokeAllForSubject(staff._id, 'staff');
        ok(res, null, 'Password reset; existing sessions were signed out');
    }
);

export default router;
