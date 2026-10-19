import { Router } from 'express';
import { z } from 'zod';
import { env } from '../../config/env.js';
import { logger } from '../../lib/logger.js';
import { ok } from '../../lib/response.js';
import { normalizeIndianPhone, validate } from '../../lib/validate.js';
import { authenticate, requireStaff } from '../../middleware/auth.js';
import { authLimiter } from '../../middleware/rateLimit.js';
import { registerDevice } from '../notifications/notification.service.js';
import * as auth from './auth.service.js';

const router = Router();

/**
 * Staff (web panel) refresh tokens live in an httpOnly cookie scoped to the
 * auth routes, out of reach of page scripts. Customers (mobile app) get the
 * token in the body and keep it in secure device storage.
 */
const REFRESH_COOKIE = 'nm_rt';
const cookieOptions = () => ({
    httpOnly: true,
    secure: env.COOKIE_SECURE,
    sameSite: env.COOKIE_SAMESITE,
    path: '/api/v1/auth',
    maxAge: env.JWT_REFRESH_EXPIRES_DAYS * 24 * 60 * 60 * 1000
});

const meta = (req) => ({ userAgent: req.get('user-agent'), ip: req.ip });

const phoneField = z
    .string({ required_error: 'Phone is required' })
    .transform((v, ctx) => {
        const phone = normalizeIndianPhone(v);
        if (!phone) ctx.addIssue({ code: 'custom', message: 'Enter a valid 10-digit mobile number' });
        return phone;
    });

// ─── Customer OTP login ───

router.post(
    '/customer/request-otp',
    authLimiter,
    validate(z.object({ phone: phoneField })),
    async (req, res) => {
        const result = await auth.requestCustomerOtp(req.body.phone);
        ok(res, result, 'OTP sent');
    }
);

router.post(
    '/customer/verify-otp',
    authLimiter,
    validate(
        z.object({
            phone: phoneField,
            otp: z.string().regex(/^\d{4,8}$/, 'Enter the OTP you received'),
            name: z.string().trim().max(80).optional(),
            device: z.object({ token: z.string().min(20).max(4096), platform: z.enum(['android', 'ios', 'web']) }).optional()
        })
    ),
    async (req, res) => {
        const session = await auth.verifyCustomerOtp(req.body, meta(req));
        if (req.body.device) {
            try {
                await registerDevice(
                    { ownerKind: 'user', ownerId: session.user.id, ...req.body.device },
                    { exclusive: true }
                );
            } catch (err) {
                // Sign-in succeeded; the app re-registers via /notifications/devices.
                logger.warn({ err: err.message }, 'Device registration at login failed');
            }
        }
        ok(res, session, 'Signed in');
    }
);

// ─── Staff login (admin / ops panel) ───

router.post(
    '/staff/login',
    authLimiter,
    validate(z.object({ email: z.string().trim().email(), password: z.string().min(1).max(200) })),
    async (req, res) => {
        const { refreshToken, ...session } = await auth.staffLogin(req.body, meta(req));
        res.cookie(REFRESH_COOKIE, refreshToken, cookieOptions());
        ok(res, session, 'Signed in');
    }
);

router.post(
    '/staff/change-password',
    authenticate,
    requireStaff(),
    validate(
        z.object({
            currentPassword: z.string().min(1),
            newPassword: z.string().min(10, 'Use at least 10 characters').max(200)
        })
    ),
    async (req, res) => {
        await auth.changeStaffPassword(req.auth.id, req.body);
        res.clearCookie(REFRESH_COOKIE, { ...cookieOptions(), maxAge: undefined });
        ok(res, null, 'Password changed. Please sign in again.');
    }
);

// ─── Shared ───

router.post('/refresh', validate(z.object({ refreshToken: z.string().optional() })), async (req, res) => {
    const fromCookie = req.cookies?.[REFRESH_COOKIE];
    const { kind, refreshToken, ...session } = await auth.refreshSession(
        req.body.refreshToken || fromCookie,
        meta(req)
    );
    if (kind === 'staff') {
        res.cookie(REFRESH_COOKIE, refreshToken, cookieOptions());
        return ok(res, session, 'Session refreshed');
    }
    return ok(res, { ...session, refreshToken }, 'Session refreshed');
});

router.post('/logout', validate(z.object({ refreshToken: z.string().optional() })), async (req, res) => {
    await auth.logout(req.body.refreshToken || req.cookies?.[REFRESH_COOKIE]);
    res.clearCookie(REFRESH_COOKIE, { ...cookieOptions(), maxAge: undefined });
    ok(res, null, 'Signed out');
});

router.get('/me', authenticate, async (req, res) => {
    ok(res, await auth.getMe(req.auth));
});

export default router;
