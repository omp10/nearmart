import 'dotenv/config';
import { z } from 'zod';

/**
 * Every environment variable the API reads, validated once at startup.
 *
 * Code imports `env` from here and never touches process.env directly, so a
 * missing or malformed value fails the boot with a clear message instead of
 * surfacing later as an undefined secret inside a request.
 */

const bool = (fallback) =>
    z
        .enum(['true', 'false'])
        .default(fallback ? 'true' : 'false')
        .transform((v) => v === 'true');

const csv = z
    .string()
    .default('')
    .transform((v) => v.split(',').map((s) => s.trim()).filter(Boolean));

const schema = z
    .object({
        NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
        PORT: z.coerce.number().int().positive().default(5000),
        HOST: z.string().default('0.0.0.0'),
        LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

        /** Origins allowed to call the API with credentials (the admin panel). */
        CORS_ORIGINS: csv,
        /** Set when running behind nginx so req.ip is the client, not the proxy. */
        TRUST_PROXY: bool(false),

        MONGO_URI: z.string().min(1, 'MONGO_URI is required'),

        JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
        JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET must be at least 32 characters'),
        JWT_ACCESS_EXPIRES_SECONDS: z.coerce.number().int().positive().default(15 * 60),
        JWT_REFRESH_EXPIRES_DAYS: z.coerce.number().int().positive().default(30),

        /**
         * Admin refresh tokens travel in an httpOnly cookie. Use `none` (with
         * HTTPS) when the panel and API are on different sites.
         */
        COOKIE_SAMESITE: z.enum(['strict', 'lax', 'none']).default('strict'),
        COOKIE_SECURE: bool(false),

        OTP_LENGTH: z.coerce.number().int().min(4).max(8).default(6),
        OTP_TTL_SECONDS: z.coerce.number().int().positive().default(300),
        OTP_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
        OTP_MAX_REQUESTS_PER_WINDOW: z.coerce.number().int().positive().default(3),
        OTP_REQUEST_WINDOW_SECONDS: z.coerce.number().int().positive().default(600),
        /** Dev/test only: every OTP is DEFAULT_OTP_CODE and nothing is sent. */
        USE_DEFAULT_OTP: bool(false),
        DEFAULT_OTP_CODE: z.string().regex(/^\d{4,8}$/).default('123456'),

        SMS_PROVIDER: z.enum(['console', 'smsindiahub']).default('console'),
        SMS_INDIA_HUB_API_KEY: z.string().optional(),
        SMS_INDIA_HUB_SENDER_ID: z.string().optional(),
        SMS_INDIA_HUB_USERNAME: z.string().optional(),
        SMS_INDIA_HUB_DLT_TEMPLATE_ID: z.string().optional(),
        /** Must match the DLT-registered template exactly; `{otp}` is replaced. */
        SMS_OTP_TEMPLATE: z.string().default('Your Nearmart OTP is {otp}. It is valid for 5 minutes.'),

        RATE_LIMIT_WINDOW_MINUTES: z.coerce.number().positive().default(15),
        RATE_LIMIT_MAX: z.coerce.number().int().positive().default(1000),
        AUTH_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(30),

        UPLOAD_STORAGE_ROOT: z.string().default('uploads'),
        /** Public URL prefix the stored path is served under (nginx in production). */
        UPLOAD_BASE_URL: z.string().default('/uploads'),
        UPLOAD_MAX_IMAGE_MB: z.coerce.number().positive().default(5),
        UPLOAD_WEBP_QUALITY: z.coerce.number().int().min(1).max(100).default(90),
        UPLOAD_WEBP_MAX_WIDTH: z.coerce.number().int().positive().default(2560),

        /** Service account JSON (inline) or a path to the file. Push is off without one. */
        FIREBASE_SERVICE_ACCOUNT: z.string().optional(),
        FIREBASE_SERVICE_ACCOUNT_PATH: z.string().optional(),

        /** 64 hex chars; encrypts secrets saved from the panel (payment gateway keys). */
        SECRETS_KEY: z
            .union([z.literal(''), z.string().regex(/^[0-9a-fA-F]{64}$/, 'SECRETS_KEY must be 64 hex characters (32 random bytes)')])
            .optional(),

        RAZORPAY_KEY_ID: z.string().optional(),
        RAZORPAY_KEY_SECRET: z.string().optional(),
        RAZORPAY_WEBHOOK_SECRET: z.string().optional()
    })
    .superRefine((v, ctx) => {
        if (v.NODE_ENV === 'production' && v.USE_DEFAULT_OTP) {
            ctx.addIssue({ code: 'custom', path: ['USE_DEFAULT_OTP'], message: 'must be false in production' });
        }
        if (v.SMS_PROVIDER === 'smsindiahub' && (!v.SMS_INDIA_HUB_API_KEY || !v.SMS_INDIA_HUB_SENDER_ID)) {
            ctx.addIssue({
                code: 'custom',
                path: ['SMS_INDIA_HUB_API_KEY'],
                message: 'SMS_INDIA_HUB_API_KEY and SMS_INDIA_HUB_SENDER_ID are required for smsindiahub'
            });
        }
        if (v.NODE_ENV === 'production' && v.SMS_PROVIDER === 'console' && !v.USE_DEFAULT_OTP) {
            ctx.addIssue({ code: 'custom', path: ['SMS_PROVIDER'], message: 'console cannot deliver OTPs in production' });
        }
        if (v.NODE_ENV === 'production' && !v.TRUST_PROXY) {
            // Behind nginx every client would look like 127.0.0.1 and share one rate-limit bucket.
            ctx.addIssue({ code: 'custom', path: ['TRUST_PROXY'], message: 'must be true in production (the API runs behind nginx)' });
        }
        if (v.NODE_ENV === 'production' && !v.COOKIE_SECURE) {
            ctx.addIssue({ code: 'custom', path: ['COOKIE_SECURE'], message: 'must be true in production (serve over HTTPS)' });
        }
        if (v.NODE_ENV === 'production' && v.JWT_ACCESS_SECRET === v.JWT_REFRESH_SECRET) {
            ctx.addIssue({ code: 'custom', path: ['JWT_REFRESH_SECRET'], message: 'must differ from JWT_ACCESS_SECRET' });
        }
        if (v.NODE_ENV === 'production' && Boolean(v.RAZORPAY_KEY_ID) && !v.RAZORPAY_WEBHOOK_SECRET) {
            ctx.addIssue({ code: 'custom', path: ['RAZORPAY_WEBHOOK_SECRET'], message: 'required when Razorpay is enabled; without it no payment is ever confirmed' });
        }
        if (v.COOKIE_SAMESITE === 'none' && !v.COOKIE_SECURE) {
            ctx.addIssue({ code: 'custom', path: ['COOKIE_SECURE'], message: 'must be true when COOKIE_SAMESITE=none' });
        }
        if (Boolean(v.RAZORPAY_KEY_ID) !== Boolean(v.RAZORPAY_KEY_SECRET)) {
            ctx.addIssue({
                code: 'custom',
                path: ['RAZORPAY_KEY_ID'],
                message: 'RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET must be set together'
            });
        }
    });

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`);
    // The logger depends on env, so this one goes straight to stderr.
    console.error(`Invalid environment configuration:\n${lines.join('\n')}`);
    process.exit(1);
}

export const env = Object.freeze({
    ...parsed.data,
    isProduction: parsed.data.NODE_ENV === 'production',
    isTest: parsed.data.NODE_ENV === 'test',
    razorpayEnabled: Boolean(parsed.data.RAZORPAY_KEY_ID && parsed.data.RAZORPAY_KEY_SECRET),
    pushEnabled: Boolean(parsed.data.FIREBASE_SERVICE_ACCOUNT || parsed.data.FIREBASE_SERVICE_ACCOUNT_PATH)
});
