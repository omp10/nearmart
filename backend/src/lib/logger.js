import pino from 'pino';
import { env } from '../config/env.js';

export const logger = pino({
    level: env.isTest ? 'silent' : env.LOG_LEVEL,
    // Never let a token, OTP or password reach the log files.
    redact: {
        paths: [
            'req.headers.authorization',
            'req.headers.cookie',
            'res.headers["set-cookie"]',
            '*.password',
            '*.otp',
            '*.refreshToken',
            '*.accessToken'
        ],
        censor: '[redacted]'
    },
    transport: env.isProduction || env.isTest ? undefined : { target: 'pino-pretty', options: { colorize: true } }
});
