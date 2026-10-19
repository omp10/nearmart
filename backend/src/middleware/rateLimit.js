import { rateLimit } from 'express-rate-limit';
import { env } from '../config/env.js';

/**
 * In-memory stores: fine for one API process. When the API runs as several
 * PM2 instances, give these a shared Redis store (rate-limit-redis) so the
 * limits apply across all of them.
 */

const message = (text) => ({ success: false, message: text });

export const apiLimiter = rateLimit({
    windowMs: env.RATE_LIMIT_WINDOW_MINUTES * 60 * 1000,
    limit: env.RATE_LIMIT_MAX,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    skip: () => env.isTest,
    message: message('Too many requests. Please slow down.')
});

export const authLimiter = rateLimit({
    windowMs: env.RATE_LIMIT_WINDOW_MINUTES * 60 * 1000,
    limit: env.AUTH_RATE_LIMIT_MAX,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    skip: () => env.isTest,
    message: message('Too many sign-in attempts. Try again later.')
});

export const uploadLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 100,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    skip: () => env.isTest,
    message: message('Too many uploads. Try again later.')
});
