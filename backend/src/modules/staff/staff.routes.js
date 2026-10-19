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

/**
 * Whether the caller's own access covers `access` (role, modules,
 * permissions). Non-super admins may only create, edit, reset or disable
 * staff within their own access, both before and after the change.
 * Otherwise `staff:update` would be a route to more access: resetting a
 * stronger colleague's password, or an ops user minting an admin.
 *
 * @returns {string|null} why not, or null when covered
 */
const exceedsCaller = (caller, { role, modules = [], permissions = {} }) => {
    if (caller.role === STAFF_ROLES.OPS) {
        if (role === STAFF_ROLES.ADMIN) return 'Operations users cannot manage admins';
        const outside = modules.filter((m) => !caller.modules.includes(m));
        if (outside.length) return `You cannot assign modules you don't have (${outside.join(', ')})`;
    }
    for (const [section, actions] of Object.entries(permissions ?? {})) {
        const held = caller.permissions?.[section] || [];
        if ((actions ?? []).some((a) => !held.includes(a))) return `You cannot grant or manage ${section} permissions you don't have`;
    }
    return null;
};

const assertWithinCaller = (req, access) => {
    if (req.auth.isSuperAdmin) return;
    const reason = exceedsCaller(req.auth, access);
    if (reason) throw new ForbiddenError(reason);
};

/** Loads a staff member the caller is allowed to manage at all. */
const loadEditable = async (req) => {
    const staff = await Staff.findById(req.params.id);
    if (!staff) throw new NotFoundError('Staff member not found');
    if (staff.isSuperAdmin && !req.auth.isSuperAdmin) throw new ForbiddenError();
    assertWithinCaller(req, { role: staff.role, modules: staff.modules, permissions: staff.permissions?.toObject?.() ?? staff.permissions });
    return staff;
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
    assertWithinCaller(req, req.body);
    const staff = await Staff.create({ ...req.body, isSuperAdmin: false, createdBy: req.auth.id });
    created(res, staffProfile(staff), 'Staff member created');
});

router.patch('/:id', requirePermission('staff', 'update'), validate(updateSchema), async (req, res) => {
    if (req.params.id === req.auth.id && req.body.isActive === false) {
        throw new ForbiddenError('You cannot deactivate your own account');
    }
    if (req.params.id === req.auth.id && !req.auth.isSuperAdmin && (req.body.permissions || req.body.role || req.body.modules)) {
        throw new ForbiddenError('You cannot change your own access');
    }
    const staff = await loadEditable(req);
    // The result must stay within the caller's access too.
    assertWithinCaller(req, {
        role: req.body.role ?? staff.role,
        modules: req.body.modules ?? staff.modules,
        permissions: req.body.permissions ?? staff.permissions?.toObject?.() ?? staff.permissions
    });
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
        // A reset is also how an admin unlocks an account locked by wrong passwords.
        staff.failedLogins = 0;
        staff.lockedUntil = null;
        await staff.save();
        await revokeAllForSubject(staff._id, 'staff');
        ok(res, null, 'Password reset; existing sessions were signed out');
    }
);

export default router;
