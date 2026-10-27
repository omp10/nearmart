import { AuthError, ForbiddenError } from '../lib/errors.js';
import { verifyAccessToken } from '../modules/auth/token.service.js';
import { User } from '../modules/users/user.model.js';
import { Staff } from '../modules/staff/staff.model.js';
import { Rider } from '../modules/riders/rider.model.js';
import { STAFF_ROLES } from '../modules/staff/permissions.js';

const readBearer = (req) => {
    const header = req.headers.authorization || '';
    return header.startsWith('Bearer ') ? header.slice(7).trim() : null;
};

/**
 * Verifies the access token and loads the account behind it, rejecting
 * deactivated accounts and tokens from a superseded session. Sets `req.auth`.
 */
export const authenticate = async (req, _res, next) => {
    const token = readBearer(req);
    if (!token) return next(new AuthError('Authentication token missing'));

    const claims = verifyAccessToken(token);
    const isStaff = claims.kind === 'staff';
    const isRider = claims.kind === 'rider';
    const doc = isStaff
        ? await Staff.findById(claims.sub).select('role isSuperAdmin permissions modules isActive tokenVersion').lean()
        : isRider
            ? await Rider.findById(claims.sub).select('isActive tokenVersion modules').lean()
            : await User.findById(claims.sub).select('isActive tokenVersion').lean();

    if (!doc) return next(new AuthError('Account not found'));
    if (!doc.isActive) return next(new AuthError('This account has been deactivated'));
    if (doc.tokenVersion !== claims.tv) return next(new AuthError('Session ended. Please sign in again.'));

    req.auth = isStaff
        ? {
            id: String(doc._id),
            kind: 'staff',
            role: doc.role,
            isSuperAdmin: Boolean(doc.isSuperAdmin),
            permissions: doc.permissions || {},
            modules: doc.modules || []
        }
        : isRider
            ? { id: String(doc._id), kind: 'rider', role: 'rider', modules: doc.modules || [] }
            : { id: String(doc._id), kind: 'user', role: 'customer' };
    return next();
};

export const requireRider = (req, _res, next) =>
    req.auth?.kind === 'rider' ? next() : next(new ForbiddenError('Delivery partner account required'));

export const requireCustomer = (req, _res, next) =>
    req.auth?.kind === 'user' ? next() : next(new ForbiddenError('Customer account required'));

/** Staff of the given roles (any staff role when none are listed). */
export const requireStaff = (...roles) => (req, _res, next) => {
    if (req.auth?.kind !== 'staff') return next(new ForbiddenError('Staff account required'));
    if (roles.length && !roles.includes(req.auth.role)) return next(new ForbiddenError());
    return next();
};

export const requireAdmin = requireStaff(STAFF_ROLES.ADMIN);

/**
 * Grants access when the staff member is a super admin or holds `action` on
 * `section`. Must run after `authenticate`.
 */
export const requirePermission = (section, action = 'view') => (req, _res, next) => {
    const auth = req.auth;
    if (auth?.kind !== 'staff') return next(new ForbiddenError('Staff account required'));
    if (auth.isSuperAdmin) return next();
    const actions = auth.permissions?.[section] || [];
    return actions.includes(action) ? next() : next(new ForbiddenError());
};

/**
 * The business modules this staff member may manage: null means all (admins),
 * otherwise the ops user's assigned modules.
 */
export const allowedModules = (req) => (req.auth?.role === STAFF_ROLES.OPS ? req.auth.modules : null);

export const requireSuperAdmin =(req, _res, next) =>
    req.auth?.kind === 'staff' && req.auth.isSuperAdmin ? next() : next(new ForbiddenError('Super admin only'));
